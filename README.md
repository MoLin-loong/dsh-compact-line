# dsh-compact-line

把 DSH 的自动压缩线改成「直接填 token 数」。填 `256000`，它就是 25.6 万——
不管底下跑的模型窗口是 1M 还是 200K。

## 为什么需要它

DSH 的 `@deepseek-ai/dsh-compaction-basic` 只接受 **比例**（`thresholdRatio`），
分母是**当前模型自己的上下文窗口**。于是同一个数字在不同模型上含义完全不同：

| 模型窗口 | `thresholdRatio: 0.25` 实际是 |
|---|---|
| 1,048,576 | 262,144 |
| 200,000 | 50,000 |
| 131,072 | 32,768 |

想表达「压缩线 25.6 万」，在 1M 模型上要写 `0.244140625`，在 200K 模型上却
根本写不出来（25.6 万已经超过窗口）。本插件负责这个换算，并对窗口装不下的
模型单独兜底。

## 目标配置长在哪

**不是** profile 根上那条 `compaction-basic` —— 那条在宿主的 web-app 补丁里是
`disabled: true` 的。真正服务会话的是**每个 Agent 预设内部**那一份：

```
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

## 安装

```powershell
dsh plugin --profile web add "file:<本目录>"
```

装完重启 DSH。设置 → 插件 → 找到 `dsh-compact-line`，卡片里就是面板。

## 面板在哪

两处，同一个表单：

1. **输入框下方那排读数**（轮次 / 步数 / token / 上下文占用那一行）——多出一段
   「压缩线 256K」，点开就是面板。这是日常入口。
2. **设置 → 插件 → dsh-compact-line** 的卡片里，同一套控件加上四个预设的现状表格。

读数的样式**逐条照抄** `ui-chat` 的 `StatsPills`——也就是左边
「13 轮 360 步 · 200 tok/s」和「52.9M tok · 缓存命中 99%」这两块读数本身：

| 属性 | 值 | 为什么不是别的 |
|---|---|---|
| `font-size` | `calc(var(--dsh-content-font-size-secondary,13px) - 1px)` | **不能继承**：dock 容器没设字号，`inherit` 拿到的是浏览器默认 16px。而且要**再减 1px**——这一行最显眼的文字是 12px，不是 13px |
| `line-height` | `calc(20px + var(--dsh-content-font-delta-secondary,0px))` | 与邻居同一基线 |
| `color` | `var(--dsw-alias-label-tertiary)` | 这一行所有读数都是三级文字色 |
| `padding` | `1px 8px` | 宿主的数值；左右 8px 让 hover 底色不贴字 |
| `border-radius` | `var(--dsw-radius-sm)` | hover 底色需要圆角，不是胶囊 |
| hover | `background: var(--dsw-alias-interactive-bg-hover)` + 文字升到二级色 | 宿主既有语言，`StatsPills` 与 `ContextMeter` 都如此 |

没有边框、没有常驻底色——只剩指针落在上面（或面板展开）时浮出的那块圆角底色。

读数显示成 `25万` / `25.6万`：整数万不带 `.0`，有小数只留一位（0.1万 = 1000 tokens，
比压缩线本身的精度更细）。不足一万的原样分段，`0.5万` 这种写法反而不直观。

`lastApplied` 只在内存里，重启即清空。为了让重启后仍显示「25万」而不是「比例 0.25」，
`/state` 会额外返回实测的 `referenceWindow`，胶囊据此把比例折算回绝对数。**只有拿到
实测窗口才折算**——拿不到就老实显示比例，因为用兜底窗口（1048576）会把 `0.25` 算成
`26.2万`，一个很像、其实并不存在的值。

注意基准对象别挑错：这一行末尾的 `13%` 圆环是 `ContextMeter`，它用 13px；
左边那两块读数才是 `StatsPills`，用 12px。挑错了就会整体大一号。

不放进输入框工具栏（「完全权限」那一行）：那里是用户正在瞄准的控件，塞一个能点开
的东西进去会抢点击 —— `dsh-connect-workbuddy` 的 issue #71 就是这个教训。dock 那一行
本来就是「会话数字」的座位，压缩线属于同一类事实。

## 面板

| 控件 | 说明 |
|---|---|
| 压缩线 | 一个数字输入框，单位 tokens。填多少就是多少 |
| 应用 | 换算比例 → 写进每个 preset → Loader 热更新 |
| 刷新 | 从 Loader 重新读当前生效值（不是读缓存） |
| 恢复默认 | 删掉 profile 层对预设的覆盖，让它重新跟随 DSH |

**只有一个输入框。** 早先版本有一个 128K/200K/…/500K 的下拉档位，那是个谎言：
它让 250000 这种真实的值只能以「自定义」出现，而「自定义」什么信息都不提供。
更糟的是 `<select>` 的 value 若不在 option 里，浏览器不报错、而是静默选回第一项，
于是同一个数字在两个控件里显示成两个互相矛盾的数。

**没有「压缩后保留」。** 插件只回答「什么时候压」，压完留多少由上游按它自己的
`retainRatio`（0.16，分母是实际可用预算）决定。早先版本会写死 `retainTokens`，
现在写入时连这个键一起删掉——留在 profile 层里的旧值等于继续替用户做主。

**「恢复默认」很重要**：`configEditor` 写的是整条 preset 的 config。一旦写过，
这个 preset 就被**完整 pin 在用户层**——DSH 升级后预设里新增的插件不会出现，
因为补丁语义是「整行替换」而不是深合并。升级 DSH 或卸载本插件之前，先点一次。

## 算法

1. 读 `llm.listProviders()` / `listModels()` / `resolveModelInfo()`，拿到每个模型
   的真实窗口；
2. **参考窗口**取出现次数最多的那个（并列取大的）。默认 `thresholdRatio` 就按它算，
   于是多数模型一条 `modelPolicies` 都不需要；
3. 窗口与参考窗口不同的模型，进 `modelPolicies` 单独给比例；
4. 窗口装不下目标压缩线的模型，退到**可用窗口的 90%**——宁可早压一点，也不要让
   那条模型永远压不动、直接撞上下文溢出；
5. 窗口小到连一条有意义的线都画不出来（< 1000 tokens）时**跳过并报出原因**，
   不写出一条上游会拒绝加载、或者压完等于没压的配置；
6. `headroomTokens` 写 **0**。它默认 65536，会从触发线里再扣掉一段，让实际压缩
   点早于用户填的数字——清零才兑现「填多少就是多少」。

## 硬约束（都来自上游源码，插件负责替你守住）

- `retainRatio` 与 `retainTokens` **互斥**，同时出现加载即抛错；
- `retainRatio` 必须**小于** `thresholdRatio`；
- 键集是固定的，**没有** `thresholdTokens` 这个字段，传未知键直接拒绝加载。

插件自己一个 `retain*` 都不写，所以前两条对它不构成限制；但如果 profile 层里
留着早先版本的旧值，写入时会一并删掉——否则改个压缩线就可能让整个预设起不来。

## 路由

两条回环 HTTP 路由，只接受 `127.0.0.1` 且 Host 头必须是回环：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/plugins/dsh-compact-line/state` | 读当前生效值 |
| POST | `/plugins/dsh-compact-line/apply` | 写入 |
| POST | `/plugins/dsh-compact-line/reset` | 恢复默认 |

## 自测

不依赖任何框架或构建工具，直接跑：

```sh
node test/core.test.mjs        # 22 例：换算、窗口约束、配置键集、预设结构
node test/validation.test.mjs  #  6 例：输入解析不吞错
node test/host.test.mjs        #     写入路径（假 ctx 驱动真实 host.js，含旧 retain 清理）
node test/exports.test.mjs     #     导出形状 + client bundle 静态契约
node test/client.test.mjs      #      bundle 真跑一遍，注册了哪些槽位
node test/select.test.mjs      #      面板只有一个数字输入框，没有下拉、没有保留量
```

`client.test.mjs` 是补上去的，因为这里出过一次真事故：bundle 把 `inject` 写成了
`[]`，宿主于是不给 `ctx` 挂 `slots`，第一次 `ctx.slots.inject` 就抛 TypeError，
而 `apply` 自己的 try/catch 把它吞成一条没人看的 console.error —— 宿主侧全绿、
日志干净、卡片就是不出现。现在这条断言会直接拦下它：`inject` 必须含 `slots`。

## 已知边界

- **已经开始的会话**要等下一轮才用上新阈值（Loader 热更新作用于新建的 Agent）。
- 重启 DSH 后胶囊先显示「默认」或比例，点一次「应用」才会重新记下绝对值 ——
  `lastApplied` 只在内存里，不落盘。
- 插件不做压缩本身——它只配置 DSH 自带的后端。
