/**
 * 插件入口：把压缩线做成一条宿主 HTTP 路由，供 Web 面板读写。
 *
 * 为什么需要一条路由而不是只做设置表单：
 *   - compaction-basic 的 config 挂在 Agent 预设内部，不是 profile 根上的
 *     一条 entry，所以宿主自带的「设置 → 模型」表单覆盖不到它。settings
 *     服务只暴露 profile 根条目上声明为 volatile 的字段。
 *   - 我们要做的换算（绝对 token 数 → 每个模型各自的比例）也不是表单能表达的。
 *
 * 路由只挂在回环地址上，并且要求 Host 头是回环 —— 与宿主的其它插件同一条
 * 纪律：这条路由能改压缩行为，不能让任意网页跨站触发。
 *
 * @module dsh-compact-line
 */

import {
  DEFAULT_MAX_TOKENS,
  DEFAULT_THRESHOLD_TOKENS,
  applyToAllPresets,
  describeCurrent,
  readEffective,
  referenceWindowOf,
  restorePresetDefaults,
} from './host.js'

export const name = 'dsh-compact-line'

/** loader 是硬依赖；webServer 与 llm 用可选访问，缺了就有降级路径。 */
export const inject = ['loader']

const BASE_PATH = '/plugins/dsh-compact-line'

/** 一条路由读、一条路由写，路径分开，避免 GET 意外改状态。 */
const STATE_PATH = BASE_PATH + '/state'
const APPLY_PATH = BASE_PATH + '/apply'
const RESET_PATH = BASE_PATH + '/reset'

export function apply(ctx) {
  ctx.inject(['webServer'], webCtx => {
    const disposeState = webCtx.webServer.register({
      kind: 'exact',
      path: STATE_PATH,
      handler: async (req, res) => {
        if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' })
        if (!hostIsLoopback(req)) return sendJson(res, 403, { error: 'loopback only' })
        try {
          const effective = readEffective(ctx)
          // 重启后 lastApplied 没了，胶囊要靠这个分母把比例折算回绝对 token 数。
          // 读不到模型时它是 undefined，胶囊会退回显示比例 —— 不猜。
          const referenceWindow = await referenceWindowOf(ctx)
          sendJson(res, 200, {
            defaults: {
              thresholdTokens: DEFAULT_THRESHOLD_TOKENS,
              maxTokens: DEFAULT_MAX_TOKENS,
            },
            ...effective,
            referenceWindow,
          })
        } catch (error) {
          sendJson(res, 500, { error: messageOf(error) })
        }
      },
    })

    const disposeApply = webCtx.webServer.register({
      kind: 'exact',
      path: APPLY_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        if (!hostIsLoopback(req)) return sendJson(res, 403, { error: 'loopback only' })
        const controller = new AbortController()
        // 只在客户端真的断开时放弃。直接监听 req 的 'close' 是错的：请求体
        // 读完之后它也会触发，于是每次正常请求都会把 signal 置成 aborted，
        // 模型窗口一个都读不到（实测表现为全都是 "This operation was aborted"）。
        // res 的 close 才是「这条连接结束了」，且正常结束时 writableEnded 为 true。
        res.on('close', () => {
          if (!res.writableEnded) controller.abort()
        })
        try {
          const body = await readJson(req)
          const parsedThreshold = readInteger(body.thresholdTokens, '压缩线')
          if (!parsedThreshold.ok) return sendJson(res, 400, { ok: false, reason: parsedThreshold.reason })
          const parsedMax = readInteger(body.maxTokens, '摘要输出上限')
          if (!parsedMax.ok) return sendJson(res, 400, { ok: false, reason: parsedMax.reason })

          const thresholdTokens = parsedThreshold.value === undefined ? DEFAULT_THRESHOLD_TOKENS : parsedThreshold.value
          const maxTokens = parsedMax.value === undefined ? DEFAULT_MAX_TOKENS : parsedMax.value
          const auto = body.auto !== false

          if (!(thresholdTokens > 0)) {
            return sendJson(res, 400, { ok: false, reason: '压缩线必须是正数' })
          }

          // 保留量不在这里校验：插件已经不再写它，也不该拿一个自己不负责的数字
          // 去拦用户的请求。压完之后留多少交给上游的默认比例。
          const described = await describeCurrent(ctx, {
            thresholdTokens,
            maxTokens,
            auto,
            signal: controller.signal,
          })
          if (described.refuses !== undefined) {
            return sendJson(res, 400, { ok: false, reason: described.refuses })
          }
          const result = await applyToAllPresets(ctx, described.plan, ctx.logger)
          sendJson(res, result.ok ? 200 : 409, {
            ...result,
            plan: described.plan,
            models: described.models,
            warnings: described.warnings,
          })
        } catch (error) {
          sendJson(res, 500, { ok: false, reason: messageOf(error) })
        }
      },
    })

    const disposeReset = webCtx.webServer.register({
      kind: 'exact',
      path: RESET_PATH,
      handler: async (req, res) => {
        if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' })
        if (!hostIsLoopback(req)) return sendJson(res, 403, { error: 'loopback only' })
        try {
          const result = await restorePresetDefaults(ctx, ctx.logger)
          sendJson(res, result.ok ? 200 : 409, result)
        } catch (error) {
          sendJson(res, 500, { ok: false, reason: messageOf(error) })
        }
      },
    })

    return () => {
      disposeState()
      disposeApply()
      disposeReset()
    }
  })
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 把请求体里的一个数值字段读成整数。
 *
 * 分成两种缺失：**没给**（undefined / null / 空串）才用默认值；给了但不合法
 * （NaN、负数、小数）必须让调用方看到错误 —— 早先这里把非法值也当缺失，
 * 于是「保留量 48000 ≥ 压缩线 50000」这种非法组合会被默认值悄悄顶掉，
 * 用户以为设成功了，实际写进去的是别的东西。
 */
function readInteger(value, field) {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) return { ok: false, reason: field + ' 不是数字' }
  if (!Number.isInteger(parsed)) return { ok: false, reason: field + ' 必须是整数' }
  if (parsed < 0) return { ok: false, reason: field + ' 不能是负数' }
  return { ok: true, value: parsed }
}

/**
 * 只接受回环 Host。
 *
 * 与宿主自己的判断同口径：Host 头可以被浏览器伪造，所以这里再叠加一次
 * 「来源地址与来源站都是本机」。跨站页面即便猜到端口，也过不去。
 */
function hostIsLoopback(req) {
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  const address = req.socket === undefined ? '' : String(req.socket.remoteAddress || '')
  const hostLoopback = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host)
  const peerLoopback = address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  return hostLoopback && (address === '' || peerLoopback)
}

const MAX_BODY = 64 * 1024

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('error', reject)
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        resolve(typeof parsed === 'object' && parsed !== null ? parsed : {})
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
  })
}

function sendJson(res, status, payload) {
  const text = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  })
  res.end(text)
}