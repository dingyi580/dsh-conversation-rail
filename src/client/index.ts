/**
 * dsh-conversation-rail — client 入口：会话小地图。
 *
 * 占一个座位：`conversation.session.header.utilities`。选它不是因为要在
 * 标题栏画东西——这个座位是 session 作用域，组件能拿到框架给的
 * `useSession` 快照钩子和 `sessionId`，生命周期跟着会话走。组件本身在
 * 标题栏里渲染 null，真正的轨道是 body 上的 fixed 浮层（见 rail.ts），
 * 按对话滚动区的实测矩形对齐，不参与宿主布局。
 *
 * 轨道画的是**整个会话**，不是当前加载窗口：骨架来自 host 的大纲接口
 * （见 ../outline.ts），实时快照覆盖其中已加载的那段。点到还没加载的
 * 那一轮，就用 `session.loadOlder()` 反复翻历史直到它进窗口再跳过去。
 *
 * 注意：`slots.register(options, component)` 是两参调用——component 必须
 * 作为第二个实参传，塞进 options 会被 SlotCore 丢弃，渲染即崩。
 */
import * as React from 'react'
import { buildTurns, mergeTurns } from './turns.js'
import type { ChatSource, RailTurn } from './turns.js'
import { fetchOutline } from './outline.js'
import { mountRail } from './rail.js'
import type { RailHandle } from './rail.js'

type SlotsApi = {
  inject(slot: string, factory: () => unknown, label?: string): unknown
  register(options: unknown, component: unknown): unknown
}

/** 会话读写面上这个插件用得到的部分。 */
type SessionFace = {
  getSnapshot(): { chat?: ChatSource; hasMore?: boolean }
  loadOlder(): Promise<void>
}

type ClientContext = {
  slots: SlotsApi
  sessions: { binding(id: string): { session: SessionFace } | undefined }
  effect(disposer: () => void, label?: string): unknown
}

/** 框架注入的 session 标准套件里，这个组件只用得到这两项。 */
type SessionKit = {
  useSession: <S>(sel: (snapshot: { chat?: ChatSource }) => S, eq?: (a: S, b: S) => boolean) => S
  sessionId: string
}

export const inject = ['slots', 'sessions']

const PLUGIN = 'dsh-conversation-rail'

/**
 * 座位标签。插件对外发布之后装它的人不一定看得懂中文，按浏览器语言给一份英文。
 * @returns 中文界面下的中文名，其余一律英文。
 */
function label(): string {
  const lang = typeof navigator === 'undefined' ? '' : (navigator.language ?? '')
  return lang.toLowerCase().startsWith('zh') ? '会话小地图' : 'Session minimap'
}

/**
 * 补历史的翻页上限。一次 loadOlder 拉一页，到不了就停——宁可跳不过去，
 * 也不能在用户点一下之后无限翻整份日志。
 */
const MAX_PAGES = 40

/**
 * 在当前快照里找某个 seq 对应的 Chat Node key。
 * @param chat - 当前 Chat 快照。
 * @param seq - 目标轮次的事件 seq。
 * @returns 已加载则返回它的 key，否则 null。
 */
function keyForSeq(chat: ChatSource | undefined, seq: number): string | null {
  if (chat === undefined) return null
  for (const key of chat.order) {
    const node = chat.nodes.get(key)
    if (node === undefined || node.kind !== 'user') continue
    const data = node.data as { seq?: number } | undefined
    if (data?.seq === seq) return node.key
  }
  return null
}

/**
 * 小地图座位。标题栏里不占位置，只负责把数据喂给浮层。
 * @param props - 框架注入的 session 标准套件。
 * @returns 始终为 null——真正的界面在 body 浮层上。
 */
function createRailEntry(ctx: ClientContext): (props: SessionKit) => null {
  return function ConversationRail({ useSession, sessionId }: SessionKit): null {
    // chat 快照每次发布换一个引用，正好当 memo 的依赖；期间流式增量不会白算。
    const chat = useSession((snapshot) => snapshot.chat)
    const live: RailTurn[] = React.useMemo(() => buildTurns(chat), [chat])
    const rail = React.useRef<RailHandle | null>(null)
    const outline = React.useRef<readonly RailTurn[]>([])

    React.useEffect(() => {
      const handle = mountRail(document, {
        async reveal(seq: number): Promise<string | null> {
          const session = ctx.sessions.binding(sessionId)?.session
          if (session === undefined) return null
          for (let page = 0; page < MAX_PAGES; page++) {
            const snapshot = session.getSnapshot()
            const key = keyForSeq(snapshot.chat, seq)
            if (key !== null) return key
            if (snapshot.hasMore !== true) return null
            await session.loadOlder()
          }
          return null
        },
      })
      rail.current = handle
      return () => {
        rail.current = null
        handle.dispose()
      }
    }, [sessionId])

    // 全量大纲：一个会话取一次，新轮次从实时快照里进来，不必重取。
    React.useEffect(() => {
      const abort = new AbortController()
      outline.current = []
      void fetchOutline(sessionId, abort.signal).then((turns) => {
        if (abort.signal.aborted) return
        outline.current = turns
        rail.current?.update(mergeTurns(turns, live))
      })
      return () => abort.abort()
      // live 有意不进依赖：大纲只跟会话走，取回来时用当时最新的 live 合一次。
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId])

    React.useEffect(() => {
      rail.current?.update(mergeTurns(outline.current, live))
    }, [live])

    return null
  }
}

/**
 * 装配：把小地图接到会话标题栏的 utilities 座位上。
 * @param ctx - client Cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  const ConversationRail = createRailEntry(ctx)
  ctx.effect(() => ctx.slots.inject('conversation.session.header.utilities', () =>
    ctx.slots.register(
      {
        name: 'conversation.session.header.utilities',
        id: PLUGIN + '-rail',
        order: 90,
        label,
      },
      ConversationRail,
    ),
  ), PLUGIN + ': conversation rail')
}
