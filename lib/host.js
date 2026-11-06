/**
 * 宿主端：读 Loader 里的 preset、算计划、通过 configEditor 写回。
 *
 * 为什么不直接改 cordis.patch.yml：
 *   - profile 的补丁文件由 Loader 解析并持有，手写会让内存树与磁盘不一致，
 *     下一次 Loader 自己写（比如用户在设置里改别的插件）就会把我们的改动覆盖；
 *   - configEditor 会先校验整份候选配置、再在文件锁内原子替换、最后让 Loader
 *     走它自己的重启路径。它还会拒绝「会被上层补丁覆盖」的写入，这是我们要的。
 *
 * 为什么要改每一个 preset：顶层的 compaction-basic 是 disabled 的（宿主自带的
 * web-app 补丁把它关掉，改由每个 Agent 预设各自持有一份）。只改一个预设，
 * 用户换预设就失效；所以默认全改。
 *
 * @module dsh-compact-line/host
 */

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_RETAIN_TOKENS,
  DEFAULT_THRESHOLD_TOKENS,
  buildEngineConfig,
  dominant,
  locateCompaction,
  planFor,
  withCompactionConfig,
} from './core.js'

/** 上次成功写入的结果，供面板回显；不落盘，重启后由实测重建。 */
let lastApplied

/** 最近一次实测出来的参考窗口。拿不到真实模型时保持 undefined。 */
let cachedReferenceWindow

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

const PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'

/**
 * 列出「当前真正在用的」Agent 预设。
 *
 * 只看 Loader 的顶层条目：预设是根 Include 的子行，不是别人的子行。
 */
function presetEntries(ctx) {
  const rows = []
  for (const entry of ctx.loader.entries()) {
    if (entry.options.name !== PRESET_PLUGIN) continue
    if (entry.options.disabled === true) continue
    rows.push(entry)
  }
  return rows
}

/**
 * 读出每个已注册模型路由的窗口。
 *
 * 用 listProviders + resolveModelInfo 而不是硬编码：窗口是适配器自己的事实，
 * 我们的比例必须建立在它上面。任何一个路由解析失败都跳过，不让一个坏适配器
 * 拖垮整张表。
 */
async function modelWindows(ctx, signal) {
  const llm = ctx.get('llm')
  if (llm === undefined) return { models: [], warnings: ['llm 服务不可用，无法读取模型窗口'] }
  const models = []
  const warnings = []
  for (const provider of llm.listProviders()) {
    const providerId = typeof provider === 'string' ? provider : provider.id
    let listed
    try {
      listed = await llm.listModels(providerId)
    } catch (error) {
      warnings.push(providerId + ' 的模型目录读取失败：' + messageOf(error))
      continue
    }
    for (const model of listed) {
      try {
        const info = await llm.resolveModelInfo(providerId, model.id, signal)
        const window = info.context === undefined ? undefined : info.context.contextWindow
        if (window === undefined) continue
        models.push({ provider: providerId, model: model.id, contextWindow: window })
      } catch (error) {
        warnings.push(providerId + '/' + model.id + ' 窗口解析失败：' + messageOf(error))
      }
    }
  }
  return { models, warnings }
}

/**
 * 算出当前应写入的完整方案。
 *
 * referenceWindow 用来回显「这个比例到底对应多少 token」——因为写进上游的
 * 只有比例，用户看到的数字必须由我们自己记住。
 *
 * 这里没有 retainTokens 参数：插件不接管保留量，写进去的配置里也不会出现它。
 */
export async function describeCurrent(ctx, options) {
  const { models, warnings } = await modelWindows(ctx, options.signal)
  const plan = planFor(options.thresholdTokens, options.maxTokens, models, {
    auto: options.auto,
  })
  return { plan, models, warnings }
}

function presetIdOf(entry) {
  const config = asRecord(entry.options.config)
  const id = config === undefined ? undefined : config.id
  return typeof id === 'string' && id.length > 0 ? id : entry.options.id
}

/**
 * 把所有 preset 的压缩配置写成同一套数值。
 *
 * 关键细节：change 回调收到的是该 preset 当前的 raw config，不是我们缓存的
 * 快照。用户可能刚在别处改过别的字段，直接用快照会覆盖掉。
 */
export async function applyToAllPresets(ctx, plan, log) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) {
    return { ok: false, reason: 'configEditor 不可用（这个 profile 没有 compose 它）', changed: [], skipped: [] }
  }
  const changed = []
  const skipped = []
  for (const entry of presetEntries(ctx)) {
    const located = locateCompaction(entry.options.config)
    if (located === undefined) {
      skipped.push({ presetId: presetIdOf(entry), reason: '这个预设里没有 compaction 组' })
      continue
    }
    try {
      await editor.edit(entry, current => {
        const presetConfig = asRecord(current) || {}
        const siblings = Array.isArray(presetConfig.plugins) ? presetConfig.plugins : []
        const live = locateCompaction(current)
        if (live === undefined) throw new Error('写入时预设结构已变化')
        // 把 retain* 从这份配置里删掉，两个原因缺一不可：
        //
        //  1. 插件现在只管「什么时候压」。压缩后保留多少由上游按它自己的
        //     retainRatio（0.16，分母是实际可用预算）决定 —— 用户的原话是
        //     「到线后调用一次 compact 就行，让系统自己解决」。
        //  2. 早先的版本把 retainTokens 写死过。那些值留在 profile 层里，
        //     不删就等于继续替用户做主，而且和新的压缩线可能冲突（上游要求
        //     retainRatio < thresholdRatio，违反即整个预设加载失败）。
        //
        // 「恢复默认」会把整条预设交还给宿主，所以删掉是可逆的。
        const engineConfig = buildEngineConfig(asRecord(live.engine.config) || {}, plan)
        delete engineConfig.retainRatio
        delete engineConfig.retainTokens
        return Object.assign({}, presetConfig, {
          plugins: withCompactionConfig(siblings, live, engineConfig),
        })
      })
      changed.push({ presetId: presetIdOf(entry), policies: plan.policies.length })
      if (log !== undefined) {
        log.info(
          'dsh-compact-line: ' + presetIdOf(entry) + ' 已设压缩线 ' + plan.thresholdTokens +
            '（参考窗口 ' + plan.referenceWindow + '，比例 ' + plan.referenceRatio + '，' +
            plan.policies.length + ' 条模型覆盖）',
        )
      }
    } catch (error) {
      skipped.push({ presetId: presetIdOf(entry), reason: messageOf(error) })
    }
  }
  if (changed.length === 0) {
    return { ok: false, reason: '没有任何预设被写入', changed, skipped }
  }
  lastApplied = { plan, at: Date.now(), changed }
  return { ok: true, changed, skipped }
}

/**
 * 把「当前生效值」从 Loader 里读回来。
 *
 * 面板显示的是磁盘上真实的值，不是我们以为写过什么。这样手改过配置文件、
 * 或另一个插件动过它，都会被如实反映出来。
 */
/**
 * 参考窗口：把预设里的比例折算回「多少 token」需要的分母。
 *
 * 关键纪律：**没有真实模型就返回 undefined**。planFor 在没有模型时会退回
 * FALLBACK_WINDOW（1048576），那个值用来生成一份能用的配置没问题，但拿来回显
 * 会把 0.25 显示成 26.2万 —— 一个看起来很像、其实并不存在的数字。宁可让胶囊
 * 老老实实显示比例，也不要编一个出来。
 */
export async function referenceWindowOf(ctx) {
  if (cachedReferenceWindow !== undefined) return cachedReferenceWindow
  let models
  try {
    models = (await modelWindows(ctx)).models
  } catch {
    // /state 还要继续把预设配置交出去；模型枚举失败不该让整个响应 500。
    return undefined
  }
  const windows = models
    .map(model => model.contextWindow)
    .filter(window => Number.isInteger(window) && window > 0)
  if (windows.length === 0) return undefined
  cachedReferenceWindow = dominant(windows)
  return cachedReferenceWindow
}

export function readEffective(ctx) {
  const presets = []
  for (const entry of presetEntries(ctx)) {
    const located = locateCompaction(entry.options.config)
    if (located === undefined) {
      presets.push({ presetId: presetIdOf(entry), present: false })
      continue
    }
    const config = asRecord(located.engine.config) || {}
    const policies = Array.isArray(config.modelPolicies) ? config.modelPolicies : []
    presets.push({
      presetId: presetIdOf(entry),
      present: true,
      thresholdRatio: typeof config.thresholdRatio === 'number' ? config.thresholdRatio : undefined,
      // retain* 仍读出来：插件自己不再写它们，但用户手改过的、或升级前遗留的
      // 值必须如实显示 —— 面板要能回答「现在是谁在决定压缩后保留多少」。
      retainTokens: typeof config.retainTokens === 'number' ? config.retainTokens : undefined,
      retainRatio: typeof config.retainRatio === 'number' ? config.retainRatio : undefined,
      headroomTokens: typeof config.headroomTokens === 'number' ? config.headroomTokens : undefined,
      maxTokens: typeof config.maxTokens === 'number' ? config.maxTokens : undefined,
      auto: config.auto !== false,
      policyCount: policies.length,
      policies,
    })
  }
  return { presets, lastApplied }
}


/**
 * 把 profile 层对 preset 的覆盖删掉，让它重新跟随宿主。
 *
 * 为什么必须有这条路：configEditor.edit 写入的是 profile 补丁里**整条** preset
 * 的 config。一旦写过，这个 preset 就被完整 pin 在用户层 —— 宿主升级后预设里
 * 新增的插件不会出现，因为补丁语义是「整行替换」而不是深合并。所以「恢复默认」
 * 不是可选项，它正是升级 DSH 或卸载本插件之前的正确动作。
 *
 * 为什么不是 edit(() => undefined)：configEditor 会先拿候选值过一遍该插件的
 * Config schema，而 @deepseek-ai/dsh-agent-preset 的 config.id 是必填的，
 * 返回 undefined 会以 "invalid config: $.id missing required value" 被拒（实测 409）。
 *
 * 正确做法是 configEditor 自己的约定：**change 的返回值与 inherited 深相等时，
 * 它会把 config 键从文档里删掉**，于是这一行回到继承状态。inherited 从
 * configEditor.configuration() 读 —— 那是它公开的读接口，不是内部函数。
 */
export async function restorePresetDefaults(ctx, log) {
  const editor = ctx.get('configEditor')
  if (editor === undefined) {
    return { ok: false, reason: 'configEditor 不可用', restored: [], skipped: [] }
  }
  if (typeof editor.configuration !== 'function') {
    return { ok: false, reason: '当前 DSH 的 configEditor 没有 configuration()，无法安全恢复', restored: [], skipped: [] }
  }

  let rows
  try {
    rows = editor.configuration()
  } catch (error) {
    return { ok: false, reason: '读取 profile 组合失败：' + messageOf(error), restored: [], skipped: [] }
  }

  const byEntry = new Map(rows.map(row => [row.entry, row]))
  const restored = []
  const skipped = []
  for (const entry of presetEntries(ctx)) {
    const row = byEntry.get(entry)
    if (row === undefined) {
      skipped.push({ presetId: presetIdOf(entry), reason: '读不到宿主层的原始 config' })
      continue
    }
    try {
      await editor.edit(entry, () => structuredClone(row.inherited))
      restored.push(presetIdOf(entry))
      if (log !== undefined) log.info('dsh-compact-line: 已恢复 ' + presetIdOf(entry) + ' 的宿主默认')
    } catch (error) {
      skipped.push({ presetId: presetIdOf(entry), reason: messageOf(error) })
    }
  }
  lastApplied = undefined
  return { ok: restored.length > 0, restored, skipped }
}

export { DEFAULT_THRESHOLD_TOKENS, DEFAULT_RETAIN_TOKENS, DEFAULT_MAX_TOKENS }