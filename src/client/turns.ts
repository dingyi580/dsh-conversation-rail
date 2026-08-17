/**
 * ChatSnapshot → 轨道条目。
 *
 * 一根杠 = 一轮对话：一条用户提问 + 该轮里助手说过的**纯文字**。
 * 工具调用 / 命令行 / 思考链 / 上下文注入 / 压缩标记全部不进预览——
 * 预览卡是给人扫的，命令和 JSON 扫不出信息。
 */

/** 轨道上的一根杠，也是预览卡的一份内容。 */
export interface RailTurn {
  /** 该轮 `user/message` 的事件 seq——跨加载窗口的稳定身份，合并大纲时按它对齐。 */
  seq: number
  /**
   * 用户消息的 Chat Node key，等于 DOM 上的 data-chat-anchor-key，点击就滚到它。
   * `null` 表示这一轮还没被分页加载进来，点它要先补历史。
   */
  key: string | null
  /** 提问原文，压成单行。 */
  question: string
  /** 该轮助手回答里的纯文字，已去掉围栏代码块。 */
  answer: string
  /**
   * 杠长权重：这一轮的**未截断**文字体量。拿截断后的预览长度算权重会齐平
   * 到上限，长短轮次的杠一样长，地图就没信息了。
   */
  weight: number
}

/** ChatSnapshot 的最小读取面——只用到有序 key 和按 key 取节点。 */
export interface ChatSource {
  readonly order: readonly string[]
  readonly nodes: { get(key: string): ChatViewNode | undefined }
}

interface ChatViewNode {
  readonly key: string
  readonly kind: string
  readonly data: unknown
  readonly visibility?: 'visible' | 'hidden'
}

/** core ContentBlock：判别字段是 type。 */
interface ContentBlockLike {
  readonly type?: string
  readonly text?: string
}

/** UI 侧 AssistantBlock：判别字段是 kind。 */
interface AssistantBlockLike {
  readonly kind?: string
  readonly text?: string
}

/** 围栏代码块——回答预览里一律剔除（bash / diff / json 都在这里面）。 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g
/** 行首 markdown 修饰：标题号、引用号、列表点、任务框。 */
const LINE_ORNAMENT = /^[ \t]*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/
/** 强调与行内代码的包裹符，去掉后读起来更像正文。 */
const INLINE_MARKS = /[`*_~]/g
/** 连续空白（含换行）。 */
const WHITESPACE = /\s+/g

/**
 * 窗口顶部那段「提问已翻出加载窗口」的助手输出用这个 seq 占位。
 * 有全量大纲时它会被真正的那一轮顶掉。
 */
const ORPHAN_SEQ = -1

/** 提问最多留这么长，卡片只显示一行，多了没意义。 */
const QUESTION_LIMIT = 120
/** 回答最多留这么长，卡片按行数截断，超出的字符白算。 */
const ANSWER_LIMIT = 400

/**
 * 从内容块数组里取纯文字。
 * @param blocks - 用户消息的 ContentBlock 数组，或助手消息的 AssistantBlock 数组。
 * @returns 按顺序拼起来的文字；非文字块（图片、工具调用、思考链）跳过。
 */
function textOf(blocks: unknown): string {
  if (!Array.isArray(blocks)) return ''
  const parts: string[] = []
  for (const raw of blocks) {
    if (raw === null || typeof raw !== 'object') continue
    const block = raw as ContentBlockLike & AssistantBlockLike
    // core 块用 type，UI 块用 kind；两边都只认 'text'，
    // 'reasoning' / 'tool-call' / 'image' / 'other' 一概不要。
    const tag = block.type ?? block.kind
    if (tag !== 'text') continue
    if (typeof block.text === 'string' && block.text.length > 0) parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * 压成一行：去修饰、塌空白、截长度。
 * @param text - 原始文字。
 * @returns 适合当标题显示的单行文本。
 */
function oneLine(text: string): string {
  const flat = text
    .replace(FENCED_CODE, ' ')
    .replace(INLINE_MARKS, '')
    .replace(WHITESPACE, ' ')
    .trim()
  return flat.length > QUESTION_LIMIT ? flat.slice(0, QUESTION_LIMIT) + '…' : flat
}

/**
 * 整理回答预览：剔除围栏代码，逐行去 markdown 修饰，保留段落换行。
 * @param text - 助手的纯文字拼接结果。
 * @returns 适合多行截断显示的正文。
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
 * 遍历 Chat 快照，按「用户消息开一轮」把节点折成轨道条目。
 *
 * 顺序即真相：`order` 是引擎给的渲染序，遇到 user 就开新的一轮，
 * 其后的 assistant-step 文字都算这一轮的回答。窗口被截断导致开头
 * 没有 user 节点时，先补一条空提问的轮次收留这些回答。
 *
 * @param chat - 当前会话的 Chat 快照。
 * @returns 从旧到新的轨道条目；没有可显示内容时返回空数组。
 */
export function buildTurns(chat: ChatSource | undefined): RailTurn[] {
  if (chat === undefined) return []
  const turns: RailTurn[] = []
  let current: RailTurn | undefined

  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.visibility === 'hidden') continue

    if (node.kind === 'user') {
      const data = node.data as { content?: unknown; seq?: number } | undefined
      const text = textOf(data?.content)
      current = {
        seq: typeof data?.seq === 'number' ? data.seq : ORPHAN_SEQ,
        key: node.key,
        question: oneLine(text),
        answer: '',
        weight: text.length,
      }
      turns.push(current)
      continue
    }

    if (node.kind === 'assistant-step') {
      if (current === undefined) {
        // 窗口截断：这些回答的提问已经翻出加载窗口了，仍然给它一根杠。
        // 拿到全量大纲后这根杠会被真正的那一轮取代（见 mergeTurns）。
        current = { seq: ORPHAN_SEQ, key: node.key, question: '', answer: '', weight: 0 }
        turns.push(current)
      }
      const data = node.data as { blocks?: unknown } | undefined
      const text = textOf(data?.blocks)
      if (text.length > 0) {
        current.answer = current.answer.length > 0 ? current.answer + '\n' + text : text
        current.weight += text.length
      }
      continue
    }

    // tool-call / command / context / compaction / retry / turn-tail / turn-error…
    // 一律不进预览，也不单独占杠。
  }

  // weight 在累加时就按原文记好了，这里只把回答收成可显示的预览。
  for (const turn of turns) turn.answer = proseOf(turn.answer)

  return turns.filter((turn) => turn.question.length > 0 || turn.answer.length > 0)
}

/**
 * 合并全量大纲与实时快照。
 *
 * 大纲是骨架——它包含整个会话的每一轮，包括还没分页加载进来的；实时快照
 * 覆盖其中已加载的部分，因为它带着可跳转的锚点 key，而且正在流式输出的
 * 那一轮只有它是最新的。按 seq 对齐，实时的一律压过大纲的。
 *
 * @param outline - host 侧读整份日志折出的轮次目录（可能为空：接口失败时）。
 * @param live - 当前加载窗口里的轮次。
 * @returns 按 seq 升序的完整轨道条目。
 */
export function mergeTurns(outline: readonly RailTurn[], live: readonly RailTurn[]): RailTurn[] {
  if (outline.length === 0) return [...live]

  const bySeq = new Map<number, RailTurn>()
  for (const turn of outline) bySeq.set(turn.seq, turn)
  for (const turn of live) {
    // 占位轮次（提问在窗口外）没有真实 seq，大纲已经把那一轮列全了，丢掉。
    if (turn.seq === ORPHAN_SEQ) continue
    bySeq.set(turn.seq, turn)
  }

  return [...bySeq.values()].sort((a, b) => a.seq - b.seq)
}
