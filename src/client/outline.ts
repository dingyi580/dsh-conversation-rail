/**
 * 取 host 侧的全量会话大纲。
 *
 * 前端快照只有已分页加载的那一段，轨道要画整个会话就得问 host 要目录。
 * 一个会话只取一次：新产生的轮次会从实时快照里进来，不需要重取。
 */
import type { RailTurn } from './turns.js'

/** 与 host 侧 API_PREFIX 一一对应。 */
const API = '/@dsh-external/dsh-conversation-rail/api'

interface OutlineResponse {
  ok?: boolean
  turns?: readonly { seq?: number; question?: string; answer?: string; weight?: number }[]
}

/**
 * 拉取一个会话的全量轮次目录。
 *
 * @param sessionId - 目标会话。
 * @param signal - 会话切换时取消。
 * @returns 轮次目录；接口不可用或出错时返回空数组，轨道退回到只画已加载的那段。
 */
export async function fetchOutline(sessionId: string, signal: AbortSignal): Promise<RailTurn[]> {
  try {
    const res = await fetch(API + '/outline?sessionId=' + encodeURIComponent(sessionId), { signal })
    if (!res.ok) return []
    const body = (await res.json()) as OutlineResponse
    if (body.ok !== true || !Array.isArray(body.turns)) return []
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
    // 取消或网络失败都不该让轨道消失，退回实时快照那一段。
    return []
  }
}
