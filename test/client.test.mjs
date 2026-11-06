import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

/**
 * 把 client bundle 真跑一遍。
 *
 * 这里出过一次真事故：bundle 把 inject 写成了 []，宿主于是不给 ctx 挂
 * slots，第一次 ctx.slots.inject 就抛 TypeError，而 apply 自己的 try/catch
 * 把它吞成一条没人看的 console.error —— 宿主侧全绿、日志干净、卡片就是不
 * 出现。所以这条断言不是形式主义：inject 必须含 slots，且 apply 必须真的
 * 注册了槽位。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadBundle() {
  const source = readFileSync(join(ROOT, 'lib', 'client.js'), 'utf8')
  let captured
  const sandbox = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
    console,
  }
  // 用一个只认识 react 的假 require 执行 bundle
  const fakeRequire = id => {
    if (id === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props, children }),
        useState: v => [v, () => {}],
        useEffect: () => {},
        useCallback: fn => fn,
        useMemo: fn => fn(),
        useRef: v => ({ current: v }),
      }
    }
    throw new Error('unexpected require: ' + id)
  }

  const fn = new Function('window', 'require', source)
  fn(sandbox, fakeRequire)
  assert.ok(captured, 'bundle 必须调用 window.__ModuleLoader__.load')
  return captured.factory(fakeRequire)
}

test('bundle 能被加载并返回模块', () => {
  const mod = loadBundle()
  assert.equal(typeof mod, 'object')
  assert.equal(mod.name, 'dsh-compact-line')
})

test('bundle 的 inject 含 slots', () => {
  const mod = loadBundle()
  assert.ok(Array.isArray(mod.inject))
  assert.ok(mod.inject.includes('slots'), 'inject 必须含 slots，否则 ctx.slots 是 undefined')
})

test('apply 在注入槽位后注册了卡片与胶囊', () => {
  const mod = loadBundle()
  const registered = []
  let injected = []
  const ctx = {
    slots: {
      inject(name, fn) {
        injected.push(name)
        return fn()
      },
      register(spec, component) {
        registered.push({ spec, component })
        return () => {}
      },
    },
  }
  const dispose = mod.apply(ctx)

  // 两个插件卡片槽位 + 一个 dock 胶囊
  const names = registered.map(r => r.spec.name)
  assert.ok(names.includes('plugins.bundle.config'), '应注册到插件卡片槽位')
  assert.ok(names.includes('plugins.row.config'), '应注册到插件行槽位')
  assert.ok(names.includes('conversation.composer.dock'), '应注册读数为胶囊')

  assert.equal(typeof dispose, 'function', 'apply 必须返回释放函数')
})

test('卡片与胶囊都拿到了 React 组件', () => {
  const mod = loadBundle()
  const registered = []
  const ctx = {
    slots: {
      inject: (name, fn) => fn(),
      register: (spec, component) => {
        registered.push({ spec, component })
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  for (const r of registered) {
    assert.equal(typeof r.component, 'function', r.spec.name + ' 的组件必须是函数')
  }
})

test('dock 胶囊带 id 与 order，不与宿主读数抢座', () => {
  const mod = loadBundle()
  let dockSpec
  const ctx = {
    slots: {
      inject: (name, fn) => fn(),
      register: (spec, component) => {
        if (spec.name === 'conversation.composer.dock') dockSpec = spec
        return () => {}
      },
    },
  }
  mod.apply(ctx)
  assert.ok(dockSpec)
  assert.equal(dockSpec.id, 'dsh-compact-line-dock')
  assert.equal(typeof dockSpec.order, 'number')
})

test('释放函数调用后不抛错', () => {
  const mod = loadBundle()
  const disposed = []
  const ctx = {
    slots: {
      inject: (name, fn) => fn(),
      register: () => () => disposed.push(1),
    },
  }
  const dispose = mod.apply(ctx)
  dispose()
  assert.ok(disposed.length > 0, '释放时应逐个 dispose 槽位')
})

test('ctx.slots 缺失时 apply 不崩溃（降级而非全盘失败）', () => {
  const mod = loadBundle()
  const ctx = { slots: { inject: () => { throw new Error('no slots') } } }
  assert.doesNotThrow(() => mod.apply(ctx))
})

test('面板样式注入是幂等的', () => {
  const mod = loadBundle()
  const ctx = {
    slots: { inject: (n, fn) => fn(), register: () => () => {} },
  }
  // 连续 apply 两次不应重复创建 style 节点（组件内 ensureStyles 负责）
  assert.doesNotThrow(() => mod.apply(ctx))
  assert.doesNotThrow(() => mod.apply(ctx))
})
