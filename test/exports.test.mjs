import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('index.js 导出 name / inject / apply', async () => {
  const mod = await import('../lib/index.js')
  assert.equal(mod.name, 'dsh-compact-line')
  assert.deepEqual(mod.inject, ['loader'])
  assert.equal(typeof mod.apply, 'function')
})

test('core.js 导出全部纯函数', async () => {
  const mod = await import('../lib/core.js')
  for (const fn of ['ratioFor', 'fitsWindow', 'effectiveThreshold', 'locateCompaction',
    'withCompactionConfig', 'buildEngineConfig', 'planFor', 'dominant']) {
    assert.equal(typeof mod[fn], 'function', fn + ' 应该是函数')
  }
})

test('host.js 导出写入与读取入口', async () => {
  const mod = await import('../lib/host.js')
  for (const fn of ['applyToAllPresets', 'describeCurrent', 'readEffective',
    'referenceWindowOf', 'restorePresetDefaults']) {
    assert.equal(typeof mod[fn], 'function', fn + ' 应该是函数')
  }
})

test('package.json 的 exports 与 dsh 声明齐全', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.name, 'dsh-compact-line')
  assert.equal(pkg.type, 'module')
  assert.ok(pkg.exports['.'], '必须导出根入口')
  assert.ok(pkg.exports['./client'], '必须导出 client bundle')
  assert.ok(pkg.dsh.bundle.patch, '必须声明 cordis 补丁')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-slots'),
    'client 依赖必须是 slots')
  assert.equal(pkg.dsh.client.platform, 'web')
})

test('cordis.patch.yml 用 insert 挂载自身', () => {
  const text = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
  assert.match(text, /insert:/)
  assert.match(text, /dsh-compact-line/)
})

test('client bundle 调用 __ModuleLoader__.load 且声明 slots 依赖', () => {
  const text = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.match(text, /window\.__ModuleLoader__\.load\(/, '必须走宿主加载器')
  assert.match(text, /exports\.inject\s*=\s*\[\s*"slots"\s*\]/, 'inject 必须含 slots')
  assert.match(text, /exports\.apply\s*=/, '必须导出 apply')
  assert.match(text, /exports\.name\s*=\s*"dsh-compact-line"/)
})

test('client bundle 的 inject 不是空数组（曾经的真事故）', () => {
  const text = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  assert.doesNotMatch(text, /exports\.inject\s*=\s*\[\s*\]/, 'inject 为 [] 会让面板静默消失')
})

test('client bundle 不引入 slots 之外的重型依赖', () => {
  const text = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  const requires = [...text.matchAll(/require\("([^"]+)"\)/g)].map(m => m[1])
  for (const dep of requires) {
    assert.equal(dep, 'react', '除 react 外不应 require 其它包，实际: ' + dep)
  }
})

test('README 里引用的测试文件都真实存在', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  // 兼容两种写法：node test/x.test.mjs 与 node --test test/x.test.mjs
  const named = [...readme.matchAll(/node\s+(?:--test\s+)?(test\/[\w.-]+\.mjs)/g)].map(m => m[1])
  assert.ok(named.length > 0, 'README 应列出测试命令')
  for (const rel of named) {
    assert.doesNotThrow(() => readFileSync(join(ROOT, rel)), rel + ' 在 README 里被引用但不存在')
  }
})

test('README 列出的用例数与实际文件一致', () => {
  const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
  const files = ['core', 'host', 'exports', 'client', 'validation', 'select']
  let total = 0
  for (const name of files) {
    const src = readFileSync(join(ROOT, 'test', name + '.test.mjs'), 'utf8')
    const count = (src.match(/^test\(/gm) || []).length
    total += count
    // README 里该文件的说明行应写明同样的数字
    const line = readme.split('\n').find(l => l.includes('test/' + name + '.test.mjs'))
    assert.ok(line, 'README 应列出 ' + name + '.test.mjs')
    assert.match(line, new RegExp('\\b' + count + ' 例'), name + '.test.mjs 实际 ' + count + ' 例，README 未写对')
  }
  assert.ok(total > 0)
})
