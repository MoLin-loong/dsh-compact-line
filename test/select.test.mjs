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
  '--dsw-alias-brand-primary',
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

/* --------------------------------------------------- 文案保持简短 */

test('面板不再出现大段解释性文字', () => {
  // 用户明确要求「多余文字不要」。这些是历次删掉的长文案，出现任何一个
  // 都说明又被加回来了。注释里提到它们（说明为什么删）不算。
  const code = SOURCE.split('\n').filter(line => {
    const t = line.trim()
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*')
  }).join('\n')

  const banned = [
    '自己算 —— 这里不接管',
    '分母是每个模型自己的窗口',
    '用来核对这个比例实际对应多少 token',
    '已经开始的会话要等下一轮',
    '升级 DSH 前建议先点一次',
    '由预设比例 × 参考窗口',
    '"上次写入 ',
  ]
  for (const text of banned) {
    assert.ok(!code.includes(text), '长文案不应出现：' + text)
  }
})

test('面板里最长的可见文案不超过 20 字', () => {
  // 只查会显示在面板上的文字。title / aria-label 是悬停与读屏用的，
  // 不占版面，长一点更好（信息可以藏在那里而不撑宽面板）。
  const visible = SOURCE
    .split('\n')
    .filter(line => !/title:|aria-label|\/\//.test(line))
    .join('\n')
  const literals = [...visible.matchAll(/"([\u4e00-\u9fa5][^"]{0,60})"/g)].map(m => m[1])
  const long = literals.filter(s => s.length > 20)
  assert.deepEqual(long, [], '以下文案过长：' + long.join(' | '))
})

test('表单只保留一行简短说明', () => {
  assert.match(SOURCE, /压完保留原文约一半/, '应保留这句关键说明')
})

/* --------------------------------------------------- 窄容器布局约束 */

test('按钮禁止换行（否则窄弹层里「刷新」会竖排）', () => {
  // 真实故障：弹层收到 260px 后，flex 的默认 shrink 把两个字的按钮
  // 压成「刷/新」两行，整个面板看起来像坏了。
  assert.match(SOURCE, /\.dcl-btn\{[^}]*white-space:nowrap/, '按钮必须 nowrap')
  assert.match(SOURCE, /\.dcl-btn\{[^}]*flex:none/, '按钮不能被压缩')
})

test('输入框与单位不被同行按钮挤压', () => {
  assert.match(SOURCE, /\.dcl-input\{[^}]*flex:none/)
  assert.match(SOURCE, /\.dcl-unit\{[^}]*flex:none/)
})

test('不保留关闭按钮：点外部和 Esc 已足够', () => {
  // 用户原话「x 也不用保留，都没点过 x」。删掉后省一行，也免了右上角
  // 与应用按钮抢位置（那正是上一版的故障）。
  assert.ok(!SOURCE.includes('.dcl-close'), '不应再有关闭按钮的样式')
  assert.ok(!SOURCE.includes('aria-label: "关闭"'), '不应再有关闭按钮的节点')
})

test('弹层宽度贴合内容，且不依赖父元素百分比', () => {
  // 三次踩坑：
  //  1. 写死 236px —— 三个按钮 293px 溢出到面板外
  //  2. max-content —— 受包含块约束，胶囊窄时被压扁
  //  3. max-width 用 100% —— 相对胶囊算，弹层只剩一百多像素，文字全挤成两行
  // fit-content 贴合最宽的行；max-width 用绝对像素，父元素多宽都不影响。
  assert.match(SOURCE, /\.dcl-pop\{[^}]*width:fit-content/, '弹层应用 fit-content')
  assert.match(SOURCE, /\.dcl-pop\{[^}]*max-width:min\(\d+px/, 'max-width 应用绝对像素')
  assert.ok(!/\.dcl-pop\{[^}]*max-width:[^}]*100%/.test(SOURCE), 'max-width 不能含百分比')
  assert.ok(!/\.dcl-pop\{[^}]*min-width:/.test(SOURCE), '不要 min-width，会把内容撑出空白')
})
