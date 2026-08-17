/**
 * 取 host 侧的全量会话大纲。
 *
 * 前端快照只有已分页加载的那一段，轨道要画整个会话就得问 host 要目录。
 * 一个会话只取一次：新产生的轮次会从实时快照里进来，不需要重取。
 */
import type { RailTurn } from './turns.js'

/** 与 host 侧 API_PREFIX 一一对应。 */
const API = '/dsh-conversation-rail/api'

interface OutlineResponse {
  ok?: boolean
  turns?: readonly { seq?: number; question?: string; answer?: string; weight?: number }[]
}

/**
 * 取不到就重试的间隔（毫秒）。
 *
 * 一个会话只取一次大纲，所以这一次失败的代价是整条轨道降级成「只画已加载
 * 的那段」，而且要等用户切走再切回才有机会恢复。host 重启、插件热重载、
 * 页面刚起来后端还没就绪——都是几百毫秒就过去的事，值得多等这几下。
 */
const RETRY_DELAYS = [400, 1200, 3000]

/**
 * 可取消的等待。
 * @param ms - 等待毫秒数。
 * @param signal - 会话切换时取消。
 * @returns 等到了返回 true，被取消返回 false。
 */
function delay(ms: number, signal: AbortSignal): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 拉取一个会话的全量轮次目录。
 *
 * @param sessionId - 目标会话。
 * @param signal - 会话切换时取消。
 * @returns 轮次目录；接口不可用或出错时返回空数组，轨道退回到只画已加载的那段。
 */
export async function fetchOutline(sessionId: string, signal: AbortSignal): Promise<RailTurn[]> {
  const query = API + '/outline?sessionId=' + encodeURIComponent(sessionId)

  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) return []
    const turns = await attemptOutline(query, signal)
    if (turns !== null) return turns
    if (attempt >= RETRY_DELAYS.length) return []
    if (!(await delay(RETRY_DELAYS[attempt], signal))) return []
  }
}

/**
 * 取一次大纲。
 *
 * @param query - 完整的请求地址。
 * @param signal - 会话切换时取消。
 * @returns 成功返回轮次（可能是空数组：新会话本来就没有轮次）；
 *          失败返回 `null`，交给调用方决定要不要再来一次。
 */
async function attemptOutline(query: string, signal: AbortSignal): Promise<RailTurn[] | null> {
  try {
    const res = await fetch(query, { signal })
    if (!res.ok) return null
    const body = (await res.json()) as OutlineResponse
    // host 读日志失败时回的是 200 + ok:false，同样算这一次没取到。
    if (body.ok !== true || !Array.isArray(body.turns)) return null
    const turns: RailTurn[] = []
    for (const raw of body.turns) {
      if (typeof raw?.seq !== 'number') continue
      turns.push({
        seq: raw.seq,
        // 大纲里的轮次没有 DOM 锚点——点它要先补历史。
        key: null,
        question: typeof raw.question === 'string' ? raw.question : '',
        answer: typeof raw.answer === 'string' ? raw.answer : '',
        weight: typeof raw.weight === 'number' ? raw.weight : 0,
      })
    }
    return turns
  } catch {
    // 取消和网络失败都走这里；取消由上层的 signal.aborted 判掉。
    return null
  }
}
