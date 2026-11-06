import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * 面板的控件形态是一条设计决定，不是随手写出来的：
 * 用户要的是「填多少就是多少」，那么一个只有五个候选的选择器就是个谎言。
 * 这条测试守住那个决定，防止有人日后又把下拉框加回来。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')

// 注释里会提到这些名字（解释为什么不再用），所以只在代码正文里断言。
const CODE = SOURCE
  .split('\n')
  .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
  .join('\n')

test('没有档位表：不出现预设阈值的下拉候选', () => {
  assert.doesNotMatch(CODE, /THRESHOLD_CHOICES/, '不应该有档位表常量')
  assert.doesNotMatch(CODE, /RETAIN_CHOICES/, '保留量的档位表已移除')
})

test('不使用 select 元素', () => {
  assert.doesNotMatch(SOURCE, /createElement\(\s*["']select["']/, '面板不应有下拉框')
})

test('压缩线用数字输入框', () => {
  assert.match(SOURCE, /type\s*:\s*["']number["']/, '压缩线必须是 number 输入')
})

test('保留量不再出现在界面文案里', () => {
  // 注释里可以提到 retain（解释为什么不做），但界面上不应有输入项
  assert.doesNotMatch(CODE, /保留量/, '界面文案不应再出现「保留量」')
})

test('两个路由路径都指向本插件的命名空间', () => {
  assert.match(SOURCE, /\/plugins\/dsh-compact-line\/state/)
  assert.match(SOURCE, /\/plugins\/dsh-compact-line\/apply/)
  assert.match(SOURCE, /\/plugins\/dsh-compact-line\/reset/)
})

test('读数胶囊有一个万级格式化的函数', () => {
  assert.match(SOURCE, /function\s+formatTokens|formatTokens\s*=/, '应有 token 格式化逻辑')
})
