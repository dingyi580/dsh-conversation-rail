/**
 * 全量会话大纲：不受前端加载窗口限制的轮次目录。
 *
 * 前端的 ChatSnapshot 只有已分页加载进来的那一段——`11 轮` 的会话可能只
 * 有 2 轮在窗口里，轨道就只有 2 根杠。这里走 host 侧的 `ctx.sessionQuery`
 * 把整份日志读出来，折成一份**很小**的目录（每轮约百来字节）交给前端，
 * 轨道于是一上来就是整个会话的全图；点到未加载的那一轮，前端再用
 * `session.loadOlder()` 补历史。
 *
 * 为什么用 `readSession` 而不是更轻的 `filterEvents`：后者只回
 * {seq, type, time, surface, text}，没有 `source`。而 `user/message` 这个
 * 事件类型同时装着**真人提问**和 `agent.inject()` 塞进去的上下文
 * （文件变更通知、AGENTS.md、skill 正文、定时通知……），
 * 官方文档写得很清楚：三者都原样投影 content，**靠 `source` 区分**。
 * 没有 source 就会把注入的上下文也画成一根杠。
 */

/** 一轮对话在大纲里的样子，与前端 RailTurn 对齐。 */
export interface OutlineTurn {
  /** 该轮 `user/message` 事件的 seq——跨加载窗口的稳定身份。 */
  seq: number
  /** 提问，已压成单行。 */
  question: string
  /** 该轮助手的纯文字回答，已去掉围栏代码块。 */
  answer: string
  /** 杠长权重：未截断的文字体量。 */
  weight: number
}

/** 日志事件的最小读取面。 */
interface LogEvent {
  readonly type: string
  readonly seq: number
  readonly data?: unknown
}

/** host 侧只用到 sessionQuery 的这一个方法。 */
export interface SessionQueryFace {
  readSession(sessionId: string): Promise<{ events: readonly LogEvent[] }>
}

interface BlockLike {
  readonly type?: string
  readonly text?: string
}

/** 围栏代码块——预览里一律剔除。 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g
/** 行首 markdown 修饰。 */
const LINE_ORNAMENT = /^[ \t]*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/
/** 强调与行内代码的包裹符。 */
const INLINE_MARKS = /[`*_~]/g
/** 连续空白（含换行）。 */
const WHITESPACE = /\s+/g

const QUESTION_LIMIT = 120
const ANSWER_LIMIT = 400

/**
 * 取内容块里的纯文字。
 * @param content - ContentBlock 数组。
 * @returns 拼接后的文字；非 text 块（图片、工具调用、思考链）跳过。
 */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const raw of content) {
    if (raw === null || typeof raw !== 'object') continue
    const block = raw as BlockLike
    if (block.type !== 'text') continue
    if (typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 压成一行。
 * @param text - 原文。
 * @returns 单行预览。
 */
function oneLine(text: string): string {
  const flat = text.replace(FENCED_CODE, ' ').replace(INLINE_MARKS, '').replace(WHITESPACE, ' ').trim()
  return flat.length > QUESTION_LIMIT ? flat.slice(0, QUESTION_LIMIT) + '…' : flat
}

/**
 * 整理回答预览。
 * @param text - 原文。
 * @returns 去代码、去修饰后的正文。
 */
function proseOf(text: string): string {
  const lines = text
    .replace(FENCED_CODE, '')
    .split('\n')
    .map((line) => line.replace(LINE_ORNAMENT, '').replace(INLINE_MARKS, '').trim())
    .filter((line) => line.length > 0)
  const prose = lines.join('\n')
  return prose.length > ANSWER_LIMIT ? prose.slice(0, ANSWER_LIMIT) + '…' : prose
}

/**
 * 读整份日志，折成轮次目录。
 *
 * @param query - host 的 sessionQuery 服务。
 * @param sessionId - 目标会话。
 * @returns 从旧到新的轮次；读不到日志时抛出，由调用方转成 HTTP 错误。
 */
export async function buildOutline(query: SessionQueryFace, sessionId: string): Promise<OutlineTurn[]> {
  const { events } = await query.readSession(sessionId)
  const turns: OutlineTurn[] = []
  let current: OutlineTurn | undefined

  for (const event of events) {
    if (event.type === 'user/message') {
      const data = event.data as { content?: unknown; source?: { kind?: string } } | undefined
      // 只有真人提问开一轮；plugin 注入的上下文共用这个事件类型，跳过。
      if (data?.source?.kind !== 'user') continue
      const text = textOf(data.content)
      current = { seq: event.seq, question: oneLine(text), answer: '', weight: text.length }
      turns.push(current)
      continue
    }

    if (event.type === 'assistant/message') {
      if (current === undefined) continue
      const data = event.data as { message?: { content?: unknown } } | undefined
      const text = textOf(data?.message?.content)
      if (text.length === 0) continue
      current.answer = current.answer.length > 0 ? current.answer + '\n' + text : text
      current.weight += text.length
      continue
    }

    // tool/result、chunk、turn 边界等一概不进大纲。
  }

  for (const turn of turns) turn.answer = proseOf(turn.answer)
  return turns.filter((turn) => turn.question.length > 0 || turn.answer.length > 0)
}
