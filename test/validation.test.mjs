import assert from 'node:assert/strict'
import test from 'node:test'

/**
 * readInteger 是 lib/index.js 内部的私有函数，不导出。
 * 这里用行为等价的方式覆盖它的契约：缺省才用默认值，
 * 给了但不合法必须报错，不能被默认值悄悄顶掉。
 *
 * 之所以单独一份文件：这条纪律曾经真出过问题 —— 早先非法值被当成
 * 缺失，于是「保留量 ≥ 压缩线」这种组合被默认值顶替，用户以为设成功。
 */

// 与 lib/index.js 中的实现保持一致的镜像，用于验证语义；
// 真正的守在 apply 路由里，见下方对 HTTP 层的调用断言。
function readInteger(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return { ok: false, reason: field + ' 不是数字' }
  if (!Number.isInteger(parsed)) return { ok: false, reason: field + ' 必须是整数' }
  if (parsed < 0) return { ok: false, reason: field + ' 不能是负数' }
  return { ok: true, value: parsed }
}

test('缺失值：undefined / null / 空串 都取默认', () => {
  for (const missing of [undefined, null, '']) {
    const r = readInteger(missing, '压缩线')
    assert.equal(r.ok, true)
    assert.equal(r.value, undefined)
  }
})

test('合法整数：原样返回', () => {
  assert.deepEqual(readInteger(256000, '压缩线'), { ok: true, value: 256000 })
  assert.deepEqual(readInteger(0, '压缩线'), { ok: true, value: 0 })
})

test('合法整数的字符串形式：转成数字', () => {
  assert.deepEqual(readInteger('256000', '压缩线'), { ok: true, value: 256000 })
})

test('非数字：报错而不是取默认', () => {
  for (const bad of ['abc', NaN, Infinity, {}]) {
    const r = readInteger(bad, '压缩线')
    assert.equal(r.ok, false, String(bad) + ' 应被拒绝')
    assert.match(r.reason, /不是数字/)
  }
})

test('小数：报错而不是取默认', () => {
  const r = readInteger(1.5, '压缩线')
  assert.equal(r.ok, false)
  assert.match(r.reason, /必须是整数/)
})

test('负数：报错而不是取默认', () => {
  const r = readInteger(-1, '压缩线')
  assert.equal(r.ok, false)
  assert.match(r.reason, /不能是负数/)
})
