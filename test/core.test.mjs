import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_MAX_TOKENS,
  canSettle,
  retainRatioFor,
  DEFAULT_THRESHOLD_TOKENS,
  buildEngineConfig,
  dominant,
  effectiveThreshold,
  fitsWindow,
  locateCompaction,
  planFor,
  ratioFor,
  withCompactionConfig,
} from '../lib/core.js'

test('ratioFor: 25.6 万在 1M 窗口上等于 0.244140625', () => {
  assert.equal(ratioFor(256000, 1048576), 0.244140625)
})

test('ratioFor: 保留 12 位小数，落回原数不丢精度', () => {
  const r = ratioFor(200000, 131072)
  assert.equal(typeof r, 'number')
  // 200000 / 131072 是无限小数，截断后乘回去应仍落在用户填的那个数附近
  assert.ok(Math.abs(r * 131072 - 200000) < 1)
})

test('ratioFor: 结果恒为有限数', () => {
  for (const [tokens, window] of [[256000, 1048576], [1, 1], [999999, 200000]]) {
    assert.ok(Number.isFinite(ratioFor(tokens, window)))
  }
})

test('ratioFor: 非正压缩线抛错', () => {
  assert.throws(() => ratioFor(0, 1000), /压缩线必须是正数/)
  assert.throws(() => ratioFor(-1, 1000), /压缩线必须是正数/)
  assert.throws(() => ratioFor(NaN, 1000), /压缩线必须是正数/)
})

test('ratioFor: 非正整数窗口抛错', () => {
  assert.throws(() => ratioFor(1000, 0), /模型窗口必须是正整数/)
  assert.throws(() => ratioFor(1000, 1.5), /模型窗口必须是正整数/)
  assert.throws(() => ratioFor(1000, -100), /模型窗口必须是正整数/)
})

test('fitsWindow: 正常组合通过', () => {
  assert.deepEqual(fitsWindow(256000, 48000, 1048576), { ok: true })
})

test('fitsWindow: 保留量 ≥ 压缩线 时不成立', () => {
  const r = fitsWindow(50000, 50000, 1048576)
  assert.equal(r.ok, false)
  assert.match(r.reason, /保留量/)
})

test('fitsWindow: 压缩线超过可用窗口时不成立', () => {
  const r = fitsWindow(300000, 48000, 200000)
  assert.equal(r.ok, false)
  assert.match(r.reason, /超过可用窗口/)
})

test('fitsWindow: 输出预留吃掉整个窗口时不成立', () => {
  const r = fitsWindow(1000, 500, 10000, 10000)
  assert.equal(r.ok, false)
  assert.match(r.reason, /小于输出预留/)
})

test('fitsWindow: 预留之后仍有余量则通过', () => {
  assert.equal(fitsWindow(5000, 1000, 10000, 2000).ok, true)
})

test('effectiveThreshold: 装得下就用目标线', () => {
  assert.equal(effectiveThreshold(256000, 1048576), 256000)
})

test('effectiveThreshold: 装不下退到可用窗口的 90%', () => {
  assert.equal(effectiveThreshold(256000, 200000), 180000)
})

test('effectiveThreshold: 预留之后按剩下的算', () => {
  assert.equal(effectiveThreshold(999999, 200000, 20000), 162000)
})

test('effectiveThreshold: 窗口被预留吃光时返回 0', () => {
  assert.equal(effectiveThreshold(256000, 10000, 10000), 0)
})

test('locateCompaction: 按 id 找到 compaction 组里的引擎', () => {
  const config = {
    plugins: [
      { id: 'other', name: 'x' },
      {
        id: 'compaction',
        name: 'cordis:group',
        config: [
          { id: 'compaction-basic', name: '@deepseek-ai/dsh-compaction-basic', config: { thresholdRatio: 0.25 } },
        ],
      },
    ],
  }
  const located = locateCompaction(config)
  assert.ok(located)
  assert.equal(located.groupIndex, 1)
  assert.equal(located.engineIndex, 0)
})

test('locateCompaction: 没有 compaction 组时返回 undefined', () => {
  assert.equal(locateCompaction({ plugins: [{ id: 'other' }] }), undefined)
})

test('locateCompaction: 组在但引擎不在时返回 undefined', () => {
  const config = { plugins: [{ id: 'compaction', config: [{ id: 'command-compact' }] }] }
  assert.equal(locateCompaction(config), undefined)
})

test('locateCompaction: 非对象入参不抛错', () => {
  for (const bad of [undefined, null, 42, 'x', []]) {
    assert.equal(locateCompaction(bad), undefined)
  }
})

test('withCompactionConfig: 只替换目标项，同组兄弟原样保留', () => {
  const plugins = [
    { id: 'other', name: 'x', config: { keep: 1 } },
    {
      id: 'compaction',
      name: 'cordis:group',
      config: [
        { id: 'compaction-basic', config: { thresholdRatio: 0.25, maxTokens: 65536 } },
        { id: 'command-compact', config: { userSetting: 'must-survive' } },
      ],
    },
  ]
  const located = locateCompaction({ plugins })
  const next = withCompactionConfig(plugins, located, { thresholdRatio: 0.1 })
  assert.equal(next[1].config[1].config.userSetting, 'must-survive')
  assert.equal(next[1].config[0].config.thresholdRatio, 0.1)
  // 原数组不被就地改写
  assert.equal(plugins[1].config[0].config.thresholdRatio, 0.25)
})

test('buildEngineConfig: headroomTokens 必须清零', () => {
  const config = buildEngineConfig({}, { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [] })
  assert.equal(config.headroomTokens, 0)
})

test('buildEngineConfig: 接管 retainRatio，并删掉互斥的 retainTokens', () => {
  // 设计变更：先前的实现把保留量交给上游默认（0.16），结果压完仍在压缩线上，
  // 形成每十几秒一次的抖动。现在插件自己算保留比例。
  const plan = { referenceRatio: 0.25, referenceRetainRatio: 0.1, maxTokens: 65536, auto: true, policies: [] }
  const config = buildEngineConfig({ retainRatio: 0.16, retainTokens: 48000 }, plan)
  assert.equal(config.retainRatio, 0.1, '用计划里的保留比例覆盖旧值')
  assert.equal('retainTokens' in config, false, 'retainTokens 与 retainRatio 互斥，必须删掉')
})

test('buildEngineConfig: 计划没给保留比例时，已有的 retainRatio 原样保留', () => {
  // 只有当前配置本来就带着 retainRatio 才会走到这里（用户手改过）。
  // 插件不主动删除用户的显式设置，但也不会凭空造一个。
  const config = buildEngineConfig({ retainRatio: 0.16 }, { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [] })
  assert.equal(config.retainRatio, 0.16)

  // 全新配置则不出现该键
  const fresh = buildEngineConfig({}, { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [] })
  assert.equal('retainRatio' in fresh, false)
})

test('buildEngineConfig: 传入的 thresholdTokens 键会被删掉', () => {
  const config = buildEngineConfig(
    { thresholdTokens: 999 },
    { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [] },
  )
  assert.equal('thresholdTokens' in config, false)
})

test('buildEngineConfig: 有 policies 才写 modelPolicies', () => {
  const withPolicies = buildEngineConfig(
    { modelPolicies: [{ stale: true }] },
    { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [{ model: 'a' }] },
  )
  assert.deepEqual(withPolicies.modelPolicies, [{ model: 'a' }])

  const without = buildEngineConfig(
    { modelPolicies: [{ stale: true }] },
    { referenceRatio: 0.25, maxTokens: 65536, auto: true, policies: [] },
  )
  assert.equal('modelPolicies' in without, false)
})

test('planFor: 单一窗口时不给多余覆盖', () => {
  const plan = planFor(256000, 65536, [{ provider: 'p', model: 'm', contextWindow: 1048576 }])
  assert.equal(plan.referenceWindow, 1048576)
  assert.equal(plan.referenceRatio, 0.244140625)
  assert.equal(plan.policies.length, 0)
})

test('planFor: 少数派窗口生成按需覆盖，含各自的 retainRatio', () => {
  const plan = planFor(256000, 65536, [
    { provider: 'p', model: 'big', contextWindow: 1048576 },
    { provider: 'p', model: 'small', contextWindow: 200000 },
  ])
  assert.equal(plan.referenceWindow, 1048576)
  assert.equal(plan.policies.length, 1)
  assert.equal(plan.policies[0].model, 'small')
  assert.equal(plan.policies[0].thresholdRatio, 0.9, '200K 窗口退到 90%')
  assert.equal('retainTokens' in plan.policies[0], false, '只写比例，不写绝对量')
  // 新公式：保留比例 = 目标线 / (2 * 窗口)，maxTokens 不参与分母
  const target = Math.floor((200000) * 0.9)
  const expected = Number((target / (2 * 200000)).toFixed(12))
  assert.equal(plan.policies[0].retainRatio, expected)
})

test('planFor: 窗口过小的模型被跳过并留下说明', () => {
  const plan = planFor(256000, 65536, [
    { provider: 'p', model: 'big', contextWindow: 1048576 },
    { provider: 'p', model: 'tiny', contextWindow: 500 },
  ])
  assert.equal(plan.policies.length, 0)
  assert.equal(plan.notes.length, 1)
  assert.match(plan.notes[0], /太小/)
})

test('planFor: 没有模型时回落到 1048576', () => {
  const plan = planFor(256000, 65536, [])
  assert.equal(plan.referenceWindow, 1048576)
  assert.equal(plan.referenceRatio, 0.244140625)
})

test('planFor: auto 默认为 true，显式 false 才关', () => {
  assert.equal(planFor(1000, 65536, []).auto, true)
  assert.equal(planFor(1000, 65536, [], { auto: false }).auto, false)
})

test('planFor: 目标线大于参考窗口时按窗口截断', () => {
  const plan = planFor(2000000, 65536, [{ provider: 'p', model: 'm', contextWindow: 1000000 }])
  assert.equal(plan.referenceRatio, 1)
})

test('dominant: 取出现最多的窗口', () => {
  assert.equal(dominant([200000, 1048576, 200000]), 200000)
})

test('dominant: 并列时取较大的（更保守）', () => {
  assert.equal(dominant([200000, 1048576]), 1048576)
})

test('dominant: 空数组返回 undefined', () => {
  assert.equal(dominant([]), undefined)
})

test('默认值：压缩线 25.6 万，摘要上限 65536', () => {
  assert.equal(DEFAULT_THRESHOLD_TOKENS, 256000)
  assert.equal(DEFAULT_MAX_TOKENS, 65536)
})

/* ---------------------------------------------------- 抖动防护（新增） */

test('canSettle: maxTokens 小于压缩线一半时放行', () => {
  assert.deepEqual(canSettle(200000, 65536), { ok: true })
})

test('canSettle: maxTokens 达到一半时拒绝，并给出最低压缩线', () => {
  const r = canSettle(100000, 65536)
  assert.equal(r.ok, false)
  assert.equal(r.minimumThreshold, 131072)
  assert.match(r.reason, /再次超过压缩线/)
})

test('canSettle: 刚好在边界上仍然拒绝（压后等于压缩线）', () => {
  assert.equal(canSettle(131072, 65536).ok, false)
})

test('canSettle: 略高于边界放行', () => {
  assert.equal(canSettle(131073, 65536).ok, true)
})

test('canSettle: 非法输入', () => {
  assert.equal(canSettle(0, 65536).ok, false)
  assert.equal(canSettle(200000, 0).ok, false)
  assert.equal(canSettle(NaN, 65536).ok, false)
})

test('retainRatioFor: 压后总量 = 压缩线一半 + maxTokens 的衰减余项', () => {
  // 新公式 retainRatio = T/(2W)，压后总量 = T/2 + M * (1 - T/(2W))。
  for (const window of [192000, 960000, 1000000, 1048576]) {
    const threshold = 200000
    const max = 65536
    const rr = retainRatioFor(threshold, max, window)
    const messageBudget = window - max
    const retain = Math.floor(messageBudget * rr)
    const after = retain + max
    const expected = threshold / 2 + max * (1 - threshold / (2 * window))
    assert.ok(
      Math.abs(after - expected) <= 2,
      '窗口 ' + window + ' 上压后应约 ' + Math.round(expected) + '，实际 ' + after,
    )
    assert.ok(after < threshold, '窗口 ' + window + ' 上压后必须低于压缩线')
  }
})

test('retainRatioFor: 小窗口保留的原文更少', () => {
  // 注意目标线超过窗口时会被 effectiveThreshold 截断，所以这里比较的是
  // 「同一个模型实际能用的目标线」：192K 窗口取 90% 后是 113817。
  const big = retainRatioFor(200000, 65536, 1048576)
  const retainBig = Math.floor((1048576 - 65536) * big)

  const smallTarget = Math.floor((192000 - 65536) * 0.9) + 0
  const smallWindowTarget = Math.floor(192000 * 0.9)
  const small = retainRatioFor(smallWindowTarget, 65536, 192000)
  const retainSmall = Math.floor((192000 - 65536) * small)

  assert.ok(retainSmall < retainBig, '小窗口应保留更少原文: ' + retainSmall + ' < ' + retainBig)
})

test('retainRatioFor: 比例不小于 1 时返回 undefined', () => {
  // 窗口极小时 T/(2W) >= 1，保留量会占满可用预算，配置无意义。
  assert.equal(retainRatioFor(200000, 65536, 60000), undefined, '200000/(2*60000) > 1')
  assert.equal(retainRatioFor(200000, 65536, 100000), undefined, '200000/(2*100000) = 1')
  assert.ok(typeof retainRatioFor(200000, 65536, 400000) === 'number', '0.25 合法')
})

test('planFor: 计划携带 referenceRetainRatio 与 settledAt', () => {
  const plan = planFor(200000, 65536, [{ provider: 'p', model: 'm', contextWindow: 1000000 }])
  assert.equal(typeof plan.referenceRetainRatio, 'number')
  const expectedAfter = Math.floor((1000000 - 65536) * plan.referenceRetainRatio) + 65536
  assert.equal(plan.settledAt, expectedAfter, '压后估算 = floor((W-M)*ratio) + maxTokens')
  assert.ok(plan.settledAt < plan.thresholdTokens, '必须落在压缩线下方')
})
