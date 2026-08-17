/**
 * dsh-conversation-rail — host 入口。
 *
 * 只做一件事：开一个只读的 HTTP 口子，把整份会话日志折成轮次目录给前端。
 *
 *   GET /dsh-conversation-rail/api/outline?sessionId=<id>
 *     → { ok: true, turns: [{ seq, question, answer, weight }, …] }
 *
 * 前端的对话是分页加载的，快照里只有最近一段；轨道要画全会话就必须有一份
 * 不受窗口限制的目录。日志在 host 侧读、在 host 侧折，回给前端的只有每轮
 * 百来字节的预览，不把整份历史推过网络。
 */
import { buildOutline } from './outline.js'
import type { SessionQueryFace } from './outline.js'

/** 路由前缀，与 client 侧的 API 常量一一对应。 */
export const API_PREFIX = '/dsh-conversation-rail/api'

/** 大纲缓存有效期：折叠掉切会话来回跳产生的重复读取。 */
const CACHE_TTL_MS = 5_000

type Req = { url?: string }
type Res = {
  writeHead(code: number, headers: Record<string, string>): void
  end(body?: string): void
}

type HostContext = {
  sessionQuery: SessionQueryFace
  webServer: {
    register(route: { kind: string; path: string; handler: (req: Req, res: Res) => Promise<void> | void }): () => void
  }
  effect(disposer: () => void, label?: string): unknown
  logger?: { warn?(...args: unknown[]): void }
}

export const name = 'dsh-conversation-rail'
export const inject = ['webServer', 'sessionQuery']

interface CacheEntry {
  at: number
  turns: unknown[]
}

/**
 * 组装 HTTP 处理器。
 * @param ctx - host 上下文。
 * @returns webServer 路由处理器。
 */
function createHandler(ctx: HostContext): (req: Req, res: Res) => Promise<void> {
  const cache = new Map<string, CacheEntry>()

  const send = (res: Res, code: number, body: unknown): void => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  return async (req: Req, res: Res): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (!url.pathname.endsWith('/outline')) return send(res, 404, { ok: false, error: 'not found' })

    const sessionId = url.searchParams.get('sessionId')
    if (sessionId === null || sessionId.length === 0) {
      return send(res, 400, { ok: false, error: 'sessionId required' })
    }

    const now = Date.now()
    const cached = cache.get(sessionId)
    if (cached !== undefined && now - cached.at < CACHE_TTL_MS) {
      return send(res, 200, { ok: true, turns: cached.turns })
    }

    try {
      const turns = await buildOutline(ctx.sessionQuery, sessionId)
      cache.set(sessionId, { at: now, turns })
      send(res, 200, { ok: true, turns })
    } catch (error) {
      // 读不到日志不是致命错误：前端会退回到「只画已加载的那一段」。
      ctx.logger?.warn?.('[' + name + '] 读取会话大纲失败', error)
      send(res, 200, { ok: false, error: String(error) })
    }
  }
}

/**
 * 装配 host 侧路由。
 * @param ctx - host 上下文。
 */
export function apply(ctx: HostContext): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: createHandler(ctx),
  }), name + ': outline api')
}
