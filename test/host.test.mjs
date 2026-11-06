import assert from 'node:assert/strict'
import test from 'node:test'

import { applyToAllPresets, readEffective, restorePresetDefaults } from '../lib/host.js'
import { planFor } from '../lib/core.js'

/**
 * 用假的 ctx 驱动真实的 host.js。
 *
 * 这里不 mock host.js 的任何内部函数 —— 只伪造它从 ctx 上拿到的那三样：
 * loader.entries()、ctx.get('llm')、ctx.get('configEditor')。
 * 这样测到的是真实的写入路径，包括它对 preset 结构的假设。
 */

const PRESET_PLUGIN = '@deepseek-ai/dsh-agent-preset'

function makePreset(id, engineConfig) {
  return {
    options: {
      id: 'preset-' + id,
      name: PRESET_PLUGIN,
      config: {
        id,
        plugins: [
          { id: 'persona', name: 'x', config: { prefix: 'p' } },
          {
            id: 'compaction',
            name: 'cordis:group',
            config: [
              { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: engineConfig },
              { id: 'command-compact', name: 'y', config: { keep: 'sibling' } },
            ],
          },
        ],
      },
    },
  }
}

/**
 * 假 configEditor：edit(entry, fn) 用 entry 当前的 config 调 fn，
 * 再把结果写回 entry —— 与宿主真实行为同构（change 收到的是当前值）。
 */
function makeEditor() {
  return {
    edits: [],
    async edit(entry, change) {
      this.edits.push(entry.options.id)
      entry.options.config = change(structuredClone(entry.options.config))
    },
  }
}

function makeCtx(presets, editor, models) {
  return {
    loader: { entries: () => presets },
    get(name) {
      if (name === 'configEditor') return editor
      if (name === 'llm') {
        return {
          listProviders: () => ['fake'],
          listModels: async () => models.map(m => ({ id: m.model })),
          resolveModelInfo: async (provider, id) => {
            const m = models.find(x => x.model === id)
            return { context: { contextWindow: m.contextWindow } }
          },
        }
      }
      return undefined
    },
    logger: { info() {} },
  }
}

const PLAN = planFor(256000, 65536, [{ provider: 'fake', model: 'm', contextWindow: 1048576 }])

test('applyToAllPresets: 每个预设都被写入', async () => {
  const presets = [makePreset('standard', {}), makePreset('ptc', {})]
  const editor = makeEditor()
  const result = await applyToAllPresets(makeCtx(presets, editor, []), PLAN)

  assert.equal(result.ok, true)
  assert.equal(result.changed.length, 2)
  assert.deepEqual(editor.edits.sort(), ['preset-ptc', 'preset-standard'])
})

test('applyToAllPresets: 写入的压缩线符合计划', async () => {
  const presets = [makePreset('ptc', {})]
  await applyToAllPresets(makeCtx(presets, makeEditor(), []), PLAN)

  const engine = presets[0].options.config.plugins[1].config[0]
  assert.equal(engine.config.thresholdRatio, 0.244140625)
  assert.equal(engine.config.headroomTokens, 0)
  assert.equal(engine.config.maxTokens, 65536)
})

test('applyToAllPresets: 旧版遗留的 retain 字段被清掉', async () => {
  const presets = [makePreset('ptc', { retainTokens: 48000, retainRatio: 0.16, thresholdRatio: 0.25 })]
  await applyToAllPresets(makeCtx(presets, makeEditor(), []), PLAN)

  const engine = presets[0].options.config.plugins[1].config[0]
  assert.equal('retainTokens' in engine.config, false)
  assert.equal('retainRatio' in engine.config, false)
})

test('applyToAllPresets: 同组兄弟插件不被冲掉', async () => {
  const presets = [makePreset('ptc', {})]
  await applyToAllPresets(makeCtx(presets, makeEditor(), []), PLAN)

  const sibling = presets[0].options.config.plugins[1].config[1]
  assert.equal(sibling.id, 'command-compact')
  assert.equal(sibling.config.keep, 'sibling')
})

test('applyToAllPresets: 没有 compaction 组的预设被跳过并说明原因', async () => {
  const broken = { options: { id: 'preset-x', name: PRESET_PLUGIN, config: { id: 'x', plugins: [] } } }
  const result = await applyToAllPresets(makeCtx([broken], makeEditor(), []), PLAN)

  assert.equal(result.ok, false)
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /没有 compaction 组/)
})

test('applyToAllPresets: configEditor 缺失时如实报告而不是抛错', async () => {
  const ctx = { loader: { entries: () => [makePreset('ptc', {})] }, get: () => undefined, logger: { info() {} } }
  const result = await applyToAllPresets(ctx, PLAN)
  assert.equal(result.ok, false)
  assert.match(result.reason, /configEditor 不可用/)
})

test('applyToAllPresets: 禁用的预设不被触碰', async () => {
  const p = makePreset('off', {})
  p.options.disabled = true
  const editor = makeEditor()
  const result = await applyToAllPresets(makeCtx([p], editor, []), PLAN)
  assert.equal(result.ok, false)
  assert.equal(editor.edits.length, 0)
})

test('readEffective: 读回磁盘上的真实值而不是缓存', async () => {
  const presets = [makePreset('ptc', { thresholdRatio: 0.3, maxTokens: 8000, auto: false })]
  const { presets: rows } = readEffective(makeCtx(presets, makeEditor(), []))

  assert.equal(rows.length, 1)
  assert.equal(rows[0].presetId, 'ptc')
  assert.equal(rows[0].present, true)
  assert.equal(rows[0].thresholdRatio, 0.3)
  assert.equal(rows[0].maxTokens, 8000)
  assert.equal(rows[0].auto, false)
})

test('readEffective: 手改过来的 retain 值如实显示', () => {
  const presets = [makePreset('ptc', { thresholdRatio: 0.25, retainRatio: 0.1, retainTokens: 20000 })]
  const { presets: rows } = readEffective(makeCtx(presets, makeEditor(), []))
  assert.equal(rows[0].retainRatio, 0.1)
  assert.equal(rows[0].retainTokens, 20000)
})

test('readEffective: 没有 compaction 组的预设标记 present=false', () => {
  const broken = { options: { id: 'preset-x', name: PRESET_PLUGIN, config: { id: 'x', plugins: [] } } }
  const { presets: rows } = readEffective(makeCtx([broken], makeEditor(), []))
  assert.equal(rows[0].present, false)
})

test('restorePresetDefaults: 用 inherited 覆盖回宿主默认', async () => {
  const preset = makePreset('ptc', { thresholdRatio: 0.3 })
  const inheritedConfig = structuredClone(makePreset('ptc', {}).options.config)
  const editor = {
    configuration: () => [{ entry: preset, inherited: inheritedConfig }],
    async edit(entry, change) {
      entry.options.config = change(entry.options.config)
    },
  }
  const result = await restorePresetDefaults(makeCtx([preset], editor, []))

  assert.equal(result.ok, true)
  assert.deepEqual(result.restored, ['ptc'])
  // inherited 是宿主层原始 config：compaction 组在 plugins[1]，引擎在它的 config[0]
  const group = preset.options.config.plugins.find(p => p.id === 'compaction')
  assert.ok(group, '恢复后仍应有 compaction 组')
  assert.equal(group.config[0].id, 'compaction-basic')
  assert.equal(JSON.stringify(group.config[0].config), '{}', '应回到宿主默认的空 config')
})

test('restorePresetDefaults: 缺 configuration() 时拒绝而不是瞎猜', async () => {
  const ctx = {
    loader: { entries: () => [makePreset('ptc', {})] },
    get: () => ({ edit: async () => {} }),
    logger: { info() {} },
  }
  const result = await restorePresetDefaults(ctx)
  assert.equal(result.ok, false)
  assert.match(result.reason, /configuration/)
})
