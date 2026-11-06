# dsh-compact-line

**控制上下文，省 token。** 把 DSH 的自动压缩线从「比例」改成「直接填 token 数」——填 `256000`，它就是 25.6 万，不管底下跑的模型窗口是 1M 还是 200K。

## 它解决什么

DSH 自带的压缩是按**比例**算的（`thresholdRatio`），分母是当前模型自己的上下文窗口。于是同一个数字在不同模型上完全是两回事：

| 模型窗口 | `thresholdRatio: 0.25` 实际是 |
|---|---|
| 1,048,576 | 262,144 |
| 200,000 | 50,000 |
| 131,072 | 32,768 |

想表达「压缩线 25.6 万」，在 1M 模型上要写 `0.244140625`；在 200K 模型上根本写不出来——25.6 万已经超过窗口了。

结果就是：**切换模型时压缩时机跟着乱跳**。1M 模型压得太晚（上下文塞满才动），200K 模型压得太早（才聊几轮就摘要，token 全花在重复总结上）。

这个插件把这件事拧回来：

- 你填一个绝对 token 数，插件按每个模型自己的窗口反算比例
- 窗口装不下的模型单独兜底（退到可用窗口的 90%，宁可早压一点，也不要直接撞溢出）
- 一次性写进所有 Agent 预设，换预设不失效

## 安装

```sh
dsh plugin --profile web add "file:<本目录>"
```

装完重启 DSH。设置 → 插件 → `dsh-compact-line`，卡片里就是面板。

## 只想用功能，不要 UI

可以。**UI 是独立的一层，删掉它后端照常工作。**

插件的能力全在后端：一条 `/plugins/dsh-compact-line/apply` 路由负责换算并写入预设。UI（读数胶囊 + 设置卡片）只是这条路由的两个消费者。

### 做法一：去掉 package.json 里的 client 声明

宿主按 `package.json` 的 `dsh.client` 字段决定要不要给插件挂前端 bundle。**没有这个字段就静默跳过**，后端不受影响：

```jsonc
{
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" }
    // 删掉整个 "client" 段
  }
}
```

然后把 `lib/client.js` 一起删了。重启后插件页不再有卡片，输入框下方也不再有读数，但压缩线仍然生效。

### 做法二：留着后端，自己写 UI

保留 `dsh.client` 声明，把 `exports['./client']` 指向你自己的文件即可。

三条路由都在 `/plugins/dsh-compact-line` 下，只监听回环地址，并要求 `Host` 头是回环——这是防跨站的前提，别去掉：

| 方法 | 路径 | 作用 | 请求体 |
|---|---|---|---|
| `GET` | `/state` | 读当前配置 | — |
| `POST` | `/apply` | 换算并写入所有预设 | `{"thresholdTokens": 256000}` |
| `POST` | `/reset` | 恢复宿主默认 | — |

`/state` 返回：

```jsonc
{
  "defaults": { "thresholdTokens": 256000, "maxTokens": 65536 },
  "presets": [                       // 每个 Agent 预设的真实配置
    { "presetId": "ptc", "present": true, "thresholdRatio": 0.244140625, "maxTokens": 65536, "auto": true }
  ],
  "lastApplied": { "plan": { "thresholdTokens": 256000 } },  // 只在内存里，重启即空
  "referenceWindow": 1048576         // 实测的参考窗口；读不到就是 undefined
}
```

`/apply` 返回 `{ ok, changed, skipped, plan, models, warnings }`。`skipped` 里会说明哪个预设没写进去、为什么。

一个最小调用：

```js
await fetch('/plugins/dsh-compact-line/apply', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ thresholdTokens: 256000 }),
})
```

### 做法三：完全不要 HTTP，直接调函数

后端逻辑都在 `lib/host.js` 里，不依赖 webServer。自己组一个 ctx 调就行：

```js
import { describeCurrent, applyToAllPresets } from 'dsh-compact-line/lib/host.js'

const { plan } = await describeCurrent(ctx, { thresholdTokens: 256000, maxTokens: 65536 })
await applyToAllPresets(ctx, plan)
```

`ctx` 需要提供 `loader.entries()`、`ctx.get('llm')`、`ctx.get('configEditor')` 三样。测试里的假 ctx 就是按这个形状写的，可以参照。

## 界面长什么样

两处入口，同一个表单：

1. **输入框下方那排读数**（轮次 / 步数 / token 那一行）多出一段「压缩线 256K」，点开是面板。这是日常入口。
2. **设置 → 插件 → dsh-compact-line** 的卡片，同一套控件加上各预设的现状表格。

面板只有一个数字输入框。没有档位表、没有下拉框——既然要的是「填多少就是多少」，一个只有五个候选的选择器就是个谎言。

## 已知边界

- **已经开始的会话**要等下一轮才用上新阈值（Loader 热更新作用于新建的 Agent）。
- 重启 DSH 后胶囊先显示「默认」或比例，点一次「应用」才会重新记下绝对值——`lastApplied` 只在内存里，不落盘。
- 插件不做压缩本身，它只配置 DSH 自带的后端。

## 自测

不依赖任何框架或构建工具：

```sh
node --test "test/*.test.mjs"  # 全套 75 例，秒级跑完
```

> 用 glob 而不是 `node --test test/`：Node 22 起会把目录当成模块入口去
> resolve，直接 `MODULE_NOT_FOUND`。

也可以逐个跑：

```sh
node --test test/core.test.mjs        # 33 例：换算、窗口约束、配置键集、预设结构
node --test test/host.test.mjs        # 12 例：写入路径（假 ctx 驱动真实 host.js）
node --test test/exports.test.mjs     # 10 例：导出形状 + client bundle 静态契约
node --test test/client.test.mjs      #  8 例：bundle 真跑一遍，注册了哪些槽位
node --test test/validation.test.mjs  #  6 例：输入解析不吞错
node --test test/select.test.mjs      #  6 例：面板只有一个数字输入框
```

`client.test.mjs` 专门守住一次真事故：bundle 把 `inject` 写成 `[]`，宿主于是不给 `ctx` 挂 `slots`，第一次 `ctx.slots.inject` 就抛 TypeError，而 `apply` 自己的 try/catch 把它吞成一条没人看的 console.error——宿主侧全绿、日志干净、卡片就是不出现。

## 实现细节

<details>
<summary>目标配置写在哪、为什么改顶层无效</summary>

**不是** profile 根上那条 `compaction-basic`——那条在宿主的 web-app 补丁里是 `disabled: true`。真正服务会话的是**每个 Agent 预设内部**那一份：

```yaml
- id: preset-ptc
  name: '@deepseek-ai/dsh-agent-preset'
  config:
    plugins:
      - id: compaction            # <-- 这一组
        name: cordis:group
        config:
          - id: compaction-basic  # <-- 这里才是有效配置
            name: '@deepseek-ai/dsh-compaction-basic'
```

所以插件写入的是**每一个 preset**，而不是顶层那一行。

</details>

<details>
<summary>换算算法</summary>

写进上游的只有 `thresholdRatio`，绝对数由我们自己记住：

- 参考窗口取**出现最多的那个**——默认比例对大多数模型直接成立，`modelPolicies` 只用来纠正少数派，配置不会膨胀成一张全模型表
- 窗口装不下目标线时退到可用窗口的 90%
- `headroomTokens` 写 0。它默认 65536，会从触发线里再扣一段，让实际压缩点早于你填的数字。插件承诺「填多少就是多少」，所以清零
- **不写 `retainTokens` / `retainRatio`**。压缩后留多少交给上游按它自己的比例决定——插件只回答「什么时候压」

</details>

<details>
<summary>上游硬约束（插件负责替你守住）</summary>

- `compaction-basic` 没有 `thresholdTokens` 字段。`resolveConfig()` 的键集固定，传未知键加载即抛错
- 压缩线必须小于可用窗口，否则永远不触发
- 保留量必须小于压缩线，否则上游拒绝加载

</details>

## License

MIT
