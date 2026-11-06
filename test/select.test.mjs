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

/**
 * 设计变量名写错不会报错 —— 它会静默落到 var() 的回退值上，
 * 于是界面看起来"能用但就是不对劲"，还特别难查。
 *
 * 之前真实踩过：--dsw-alias-border-default、--dsw-alias-border-subtle、
 * --dsw-alias-status-danger、--dsw-alias-status-success 这四个名字在
 * @deepseek-ai/dsh-client-ui-theme 里根本不存在，全部落到了硬编码灰，
 * 在 liquid-glass 主题下尤其突兀。
 */

/** 只取 CSS 规则字符串（形如 ".dcl-x{...}",），跳过注释与组件代码。 */
function cssRulesOnly(source) {
  return (source.match(/^\s*"\.[^"]*",?$/gm) || []).join('\n')
}

// 从 dsh-client-ui-theme 实际导出的 token 里抄下来的白名单。
// 新增 token 时同步这里；写错名字会让这条测试变红。
const KNOWN_TOKENS = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2',
  '--dsw-alias-bg-layer-3', '--dsw-alias-bg-overlay', '--dsw-alias-bg-mask-1',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-border-l3',
  '--dsw-alias-border-l4', '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-interactive-bg-active', '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary', '--dsw-alias-label-tertiary',
  '--dsw-alias-label-caption', '--dsw-alias-label-primary-inverted',
  '--dsw-alias-button-primary-fill', '--dsw-alias-button-primary-hover',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-success-primary',
  '--dsw-alias-state-warn-primary', '--dsw-specific-menu',
  '--dsw-elevation-prominent', '--dsw-elevation-stroke-color',
  '--dsw-radius-sm', '--dsw-radius-md', '--dsw-radius-lg',
  '--dsw-menu-backdrop-filter',
  '--dsh-content-font-size-secondary', '--dsh-content-font-delta-secondary',
])

test('CSS 里引用的每个 --dsw-* 变量都真实存在', () => {
  const css = cssRulesOnly(SOURCE)
  const used = [...new Set([...css.matchAll(/(--dsw-[a-z0-9-]+)/g)].map(m => m[1]))]
  assert.ok(used.length > 0, '应能从 CSS 规则里提到变量')
  const unknown = used.filter(token => !KNOWN_TOKENS.has(token))
  assert.deepEqual(unknown, [], '以下变量名不存在，会静默落到回退值：' + unknown.join(', '))
})

test('弹层设置了 elevation 描边色（glass 主题靠它画玻璃边）', () => {
  assert.match(SOURCE, /--dsw-elevation-stroke-color:\s*var\(--dsw-alias-border-l1\)/,
    'panel 必须覆写 --dsw-elevation-stroke-color，否则 liquid-glass 下没有那圈描边')
})

test('不再出现已知不存在的旧变量名', () => {
  const cssText = cssRulesOnly(SOURCE)
  assert.ok(cssText.length > 0, '应能提取出 CSS 规则')
  for (const dead of ['--dsw-alias-border-default', '--dsw-alias-border-subtle',
    '--dsw-alias-status-danger', '--dsw-alias-status-success']) {
    assert.ok(!cssText.includes(dead), dead + ' 不存在，应换成真实 token')
  }
})

test('按钮分主次，不是一个样', () => {
  assert.match(SOURCE, /dcl-btn-primary/, '应有主按钮样式')
  assert.match(SOURCE, /dcl-btn-ghost/, '应有次按钮样式')
})
