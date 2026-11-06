/*!
 * dsh-compact-line —— 把 DSH 的自动压缩线改成「直接填 token 数」。
 *
 * 立项依据：在 DSH 0.2.1-rc.5 上对着已安装的包逐条核对，发现三处与常见
 * 说明文档不一致，本插件正是围绕这三条设计：
 *
 *  1) 顶层那条 compaction-basic 是 disabled 的。真正服务会话的，是每个
 *     Agent 预设内部（preset-ptc / preset-standard / ...）那一份，挂在
 *     preset.plugins 里一个叫 compaction 的 cordis:group 下。改顶层无效。
 *  2) @deepseek-ai/dsh-compaction-basic 没有 thresholdTokens 字段。
 *     resolveConfig() 的键集是固定的，传未知键加载即抛错。想表达
 *     「压缩线 256000」只能给 thresholdRatio —— 而它是比例，分母是
 *     当前模型自己的上下文窗口。
 *  3) 同一比例在不同窗口上不是同一个压缩线。1M 上 0.25 是 256K，
 *     200K 上 0.25 只有 50K，会压缩得过早。所以必须给 modelPolicies。
 *
 * 插件只做三件事：把绝对 token 数换算成每个模型各自的比例、写进每个
 * Agent 预设、给窗口装不下的模型单独兜底。写入走宿主的 configEditor，
 * 由 Loader 自己完成热更新，不做任何手改文件的事。
 */

export const name = 'dsh-compact-line'

/* 只硬依赖 loader：拿不到它连预设都找不到。configEditor 用可选访问，
 * 缺了就把「只能看、不能改」如实报出来，而不是让整条插件加载失败。 */
export const inject = ['loader']

export const PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'
export const COMPACTION_GROUP_ID = 'compaction'
export const ENGINE_ID = 'compaction-basic'
export const ENGINE_NAME = '@deepseek-ai/dsh-compaction-basic'

/** 需求里手机那侧的数值：25.6 万。 */
export const DEFAULT_THRESHOLD_TOKENS = 256000
/**
 * 压缩后逐字保留的近期历史。
 *
 * 插件不写这个字段 —— 压缩线之外的一切都交回上游默认值（retainRatio 0.16，
 * 按可用预算算）。留在这里只是为了让 /state 能报出「不接管」这件事，以及给
 * core 的纯函数在测试里一个显式入参。
 */
export const DEFAULT_RETAIN_TOKENS = 48000
/** 摘要请求的输出上限。 */
export const DEFAULT_MAX_TOKENS = 65536

/** 没有模型信息时的分母（与需求文档一致）。 */
const FALLBACK_WINDOW = 1048576

/** 低于这个数的压缩线没有意义：还没写几轮就会触发，收益全被摘要成本吃掉。 */
const MIN_POLICY_THRESHOLD = 1000

/* ---------------------------------------------------------------- 纯函数 */

/**
 * 目标压缩线换成比例。
 *
 * 留 12 位小数：256000/1048576 = 0.244140625 本身是有限小数，但别的组合
 * 不一定有限。上游最终算 floor(min(window*ratio, budget))，精度够就能稳定
 * 落回用户填的那个数。
 */
export function ratioFor(thresholdTokens, contextWindow) {
  if (!Number.isFinite(thresholdTokens) || thresholdTokens <= 0) {
    throw new Error('压缩线必须是正数')
  }
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new Error('模型窗口必须是正整数')
  }
  return Number((thresholdTokens / contextWindow).toFixed(12))
}

/**
 * 这条压缩线在某个窗口上还成不成立。
 *
 * 硬约束只有两条，但两条都属于「配错了上游才报错，而那时已经太晚」：
 * 压缩线必须小于可用窗口（否则永远不触发），保留量必须小于压缩线。
 */
export function fitsWindow(thresholdTokens, retainTokens, contextWindow, reservedCompletion = 0) {
  const usable = contextWindow - reservedCompletion
  if (usable <= 0) {
    return { ok: false, reason: '窗口 ' + contextWindow + ' 小于输出预留 ' + reservedCompletion }
  }
  if (retainTokens >= thresholdTokens) {
    return { ok: false, reason: '保留量 ' + retainTokens + ' ≥ 压缩线 ' + thresholdTokens + '，上游会拒绝加载' }
  }
  if (thresholdTokens >= usable) {
    return { ok: false, reason: '压缩线 ' + thresholdTokens + ' 超过可用窗口 ' + usable }
  }
  return { ok: true }
}

/**
 * 为一个窗口挑出「真正想要触发」的位置。
 *
 * 窗口装得下目标线就用目标线；装不下就退到可用窗口的 90% —— 宁可早压一点，
 * 也不要让那条模型永远压不动、直接撞上下文溢出。
 */
export function effectiveThreshold(thresholdTokens, contextWindow, reservedCompletion = 0) {
  const usable = contextWindow - reservedCompletion
  if (usable <= 0) return 0
  return Math.min(thresholdTokens, Math.floor(usable * 0.9))
}

/* -------------------------------------------------------------- 结构读取 */

function asRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined
}

/**
 * 在一份 preset 的 config 里找到承载压缩的那一组。
 *
 * 按 id 找而不是按位置：预设的插件顺序会随版本变，id 才是稳定契约。
 */
export function locateCompaction(presetConfig) {
  const config = asRecord(presetConfig)
  if (config === undefined) return undefined
  const plugins = Array.isArray(config.plugins) ? config.plugins : []
  for (let i = 0; i < plugins.length; i += 1) {
    const group = asRecord(plugins[i])
    if (group === undefined || group.id !== COMPACTION_GROUP_ID) continue
    const children = Array.isArray(group.config) ? group.config : []
    for (let j = 0; j < children.length; j += 1) {
      const engine = asRecord(children[j])
      if (engine === undefined || engine.id !== ENGINE_ID) continue
      return { groupIndex: i, engineIndex: j, group, engine }
    }
  }
  return undefined
}

/**
 * 把新的 compression 配置放进 preset 的 plugins 数组，返回新的 plugins。
 *
 * 只替换目标那一项；同组的其它条目（command-compact、修剪器）连同它们自己的
 * config 一起原样带过去 —— 换掉整个 group 会把用户的修剪器设置冲掉。
 */
export function withCompactionConfig(plugins, located, engineConfig) {
  const next = plugins.slice()
  const group = Object.assign({}, located.group)
  const children = (Array.isArray(group.config) ? group.config : []).slice()
  children[located.engineIndex] = Object.assign({}, located.engine, { config: engineConfig })
  group.config = children
  next[located.groupIndex] = group
  return next
}

/**
 * 生成 compaction-basic 的 config。
 *
 * 只写压缩线相关的键，其余一律不碰：
 *
 *  - **不写 retainTokens / retainRatio**。这两个是互斥的，写了就同时锁死了
 *    「压缩后保留多少」。插件只负责回答「什么时候压」，压完之后留多少该由
 *    上游按它自己的比例（retainRatio 0.16，分母是实际可用预算）决定 ——
 *    用户原话：「到线后调用一次 compact 就行，让系统自己解决」。
 *    已有的值如果存在也不删除，除非它和新的压缩线冲突（见 host 层校验）。
 *  - **headroomTokens 写 0**。它默认 65536，会从触发线里再扣掉一段，让实际
 *    压缩点早于用户填的数字。插件承诺「填多少就是多少」，所以清零。
 *  - maxTokens 是摘要请求的输出上限，与何时压缩无关，保持写入。
 */
export function buildEngineConfig(current, plan) {
  const next = Object.assign({}, current)
  delete next.thresholdTokens
  next.thresholdRatio = plan.referenceRatio
  next.maxTokens = plan.maxTokens
  next.headroomTokens = 0
  next.auto = plan.auto
  if (plan.policies.length > 0) next.modelPolicies = plan.policies
  else delete next.modelPolicies
  return next
}

/**
 * 由「目标线 + 一组模型窗口」推出完整计划。
 *
 * 参考窗口取出现最多的那个窗口 —— 这样默认比例对大多数模型直接成立，
 * modelPolicies 只用来纠正少数派，配置不会膨胀成一张全模型表。
 */
export function planFor(thresholdTokens, maxTokens, models, options) {
  const settings = options || {}
  const auto = settings.auto !== false
  const windows = models.map(m => m.contextWindow).filter(w => Number.isInteger(w) && w > 0)
  const referenceWindow = dominant(windows) || FALLBACK_WINDOW
  const referenceRatio = ratioFor(Math.min(thresholdTokens, referenceWindow), referenceWindow)

  const notes = []
  const policies = []
  for (const model of models) {
    const window = model.contextWindow
    if (!Number.isInteger(window) || window <= 0) continue
    if (window === referenceWindow) continue
    const target = effectiveThreshold(thresholdTokens, window)
    // 窗口比压缩线还小的模型：按 90% 退让，让它在自己的尺度上也能压得动。
    if (target < MIN_POLICY_THRESHOLD) {
      notes.push(model.provider + '/' + model.model + ' 窗口 ' + window + ' 太小，已跳过')
      continue
    }
    // 只给比例，不给 retain —— 保留量由上游按它自己的默认比例决定。
    policies.push({
      provider: model.provider,
      model: model.model,
      thresholdRatio: ratioFor(target, window),
      maxTokens,
      headroomTokens: 0,
    })
  }
  return {
    thresholdTokens,
    maxTokens,
    auto,
    referenceWindow,
    referenceRatio,
    policies,
    notes,
  }
}

/** 出现次数最多的窗口；并列时取最大的那个（更保守）。 */
export function dominant(windows) {
  if (windows.length === 0) return undefined
  const counts = new Map()
  for (const window of windows) counts.set(window, (counts.get(window) || 0) + 1)
  let best
  let bestCount = -1
  for (const entry of counts) {
    const window = entry[0]
    const count = entry[1]
    if (count > bestCount || (count === bestCount && window > best)) {
      best = window
      bestCount = count
    }
  }
  return best
}
