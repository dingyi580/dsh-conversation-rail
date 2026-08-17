/**
 * 会话小地图的呈现层：贴着对话滚动区左缘的一条竖轨，一根杠一轮对话。
 *
 * ```
 *   ▏─────                 ┌──────────────────────────────┐
 *   ▏───────────           │ 做任何补丁啊，这…            │  ← 提问（深色，一行）
 *   ▏━━━━━━━━━━━━━━  ◀━━━━━┤ CRLF 已排除。下…             │
 *   ▏──────                │ 大小、只有合法重…            │  ← 回答（淡色，截几行）
 *   ▏────────              └──────────────────────────────┘
 * ```
 *
 * 位置不靠插入宿主 DOM：轨道是 body 上的 fixed 浮层，按
 * `[data-conversation-scroll]` 的实测矩形对齐。宿主换皮肤、改栅格、
 * 折叠侧栏都不会把它挤歪，也不会反过来影响对话区的布局。
 */
import type { RailTurn } from './turns.js'

/** 样式表只注入一次，按这个 id 认领。 */
const STYLE_ID = 'dsh-conversation-rail-style'
/** 浮层根节点的标记属性，便于排查和皮肤覆盖。 */
const HOST_ATTR = 'data-dsh-conversation-rail'
/** 对话滚动容器——宿主 ChatView 的稳定锚点。 */
const SCROLLPORT_SELECTOR = '[data-conversation-scroll]'
/** 每行消息挂的 key，等于 Chat Node key。 */
const ANCHOR_SELECTOR = '[data-chat-anchor-key]'

/** 有一轮就画一根杠——空会话之外一律显示。 */
const MIN_TURNS = 1
/** 轨道上下留白，避免顶到标题栏和输入框。 */
const RAIL_PADDING = 32
/** 单根杠的最小 / 最大占位高度（含间距）。 */
const SLOT_MIN = 3
const SLOT_MAX = 11
/** 杠长范围。 */
const BAR_MIN_WIDTH = 10
const BAR_MAX_WIDTH = 34
/** 轨道离滚动区左缘的距离。 */
const RAIL_INSET = 10
/** 布局巡检间隔：兜住皮肤动画、侧栏折叠这类不发事件的尺寸变化。 */
const SYNC_INTERVAL_MS = 250
/**
 * 重画与高亮的合并窗口。用定时器而不是 requestAnimationFrame：
 * 标签页隐藏时 rAF 完全不触发，会话在后台读完再切回来就是一条空轨道。
 */
const COALESCE_MS = 32
/** 补完历史后等 React 把行渲染出来：重试次数与间隔。 */
const SCROLL_RETRIES = 20
const SCROLL_RETRY_MS = 50

const CSS = `
[${HOST_ATTR}] {
  position: fixed;
  z-index: 60;
  pointer-events: none;
  display: none;
  font-family: var(--dsw-font-family, inherit);
}
[${HOST_ATTR}][data-visible='1'] { display: block; }

[${HOST_ATTR}] .dsh-rail-track {
  position: absolute;
  left: 0;
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  pointer-events: auto;
}

[${HOST_ATTR}] .dsh-rail-hit {
  display: flex;
  align-items: center;
  width: 44px;
  border: 0;
  padding: 0;
  margin: 0;
  background: none;
  cursor: pointer;
  -webkit-appearance: none;
  appearance: none;
}

[${HOST_ATTR}] .dsh-rail-bar {
  border-radius: 2px;
  background: var(--dsw-alias-label-secondary, #6b7079);
  opacity: .5;
  transition: opacity .12s ease, background-color .12s ease, width .12s ease;
}

[${HOST_ATTR}] .dsh-rail-hit:hover .dsh-rail-bar { opacity: .9; }

[${HOST_ATTR}] .dsh-rail-hit[data-active='1'] .dsh-rail-bar {
  opacity: 1;
  background: var(--dsw-alias-label-primary, #1b1c1f);
}

/* 正在为这一轮补历史：杠自己脉动，告诉用户点击已经收到了。 */
[${HOST_ATTR}] .dsh-rail-hit[data-loading='1'] .dsh-rail-bar {
  background: var(--dsw-alias-brand-primary, #4d6bfe);
  opacity: 1;
  animation: dsh-rail-pulse .8s ease-in-out infinite;
}

@keyframes dsh-rail-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .3; }
}

[${HOST_ATTR}] .dsh-rail-card {
  position: absolute;
  width: 296px;
  box-sizing: border-box;
  padding: 12px 14px;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, .08));
  background: var(--dsw-alias-bg-layer-2, #fff);
  box-shadow: 0 8px 28px rgba(0, 0, 0, .14);
  pointer-events: none;
  opacity: 0;
  transform: translateX(-4px);
  transition: opacity .12s ease, transform .12s ease;
}
[${HOST_ATTR}] .dsh-rail-card[data-open='1'] { opacity: 1; transform: translateX(0); }

[${HOST_ATTR}] .dsh-rail-q {
  color: var(--dsw-alias-label-primary, #1b1c1f);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

[${HOST_ATTR}] .dsh-rail-a {
  margin-top: 6px;
  color: var(--dsw-alias-label-tertiary, #8a8f98);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  -webkit-box-orient: vertical;
}

[${HOST_ATTR}] .dsh-rail-a:empty { display: none; }
`

/** 轨道向宿主借的一个能力：把还没加载的那一轮补进来。 */
export interface RailDeps {
  /**
   * 分页加载历史，直到 `seq` 那一轮进入窗口。
   * @param seq - 目标轮次的事件 seq。
   * @returns 它的 Chat Node key；补不到（已到日志开头或失败）返回 null。
   */
  reveal(seq: number): Promise<string | null>
}

/** 已挂载轨道的对外操作面。 */
export interface RailHandle {
  /** 用新的轮次列表重画轨道（内部按帧合并，可以随流式更新高频调用）。 */
  update(turns: readonly RailTurn[]): void
  /** 拆掉浮层与所有监听。 */
  dispose(): void
}

/**
 * 注入一次性样式表。
 * @param doc - 目标文档。
 */
function ensureStyle(doc: Document): void {
  if (doc.getElementById(STYLE_ID) !== null) return
  const style = doc.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  doc.head.append(style)
}

/**
 * 把权重映射成杠长：开方压缩，长回答不至于把短回答挤成一个点。
 * @param weight - 该轮的字符体量。
 * @param maxWeight - 当前会话里最大的体量。
 * @returns 像素宽度。
 */
function barWidth(weight: number, maxWeight: number): number {
  if (maxWeight <= 0) return BAR_MIN_WIDTH
  const ratio = Math.sqrt(Math.min(1, weight / maxWeight))
  return Math.round(BAR_MIN_WIDTH + (BAR_MAX_WIDTH - BAR_MIN_WIDTH) * ratio)
}

/**
 * 在对话流里找某一轮对应的行元素。
 * @param root - 搜索根（滚动容器）。
 * @param key - Chat Node key。
 * @returns 命中的行，找不到返回 null。
 */
function anchorOf(root: Element, key: string): HTMLElement | null {
  for (const row of root.querySelectorAll(ANCHOR_SELECTOR)) {
    if (row instanceof HTMLElement && row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/**
 * 挂载会话小地图。
 *
 * @param doc - 宿主文档。
 * @param deps - 宿主提供的历史补齐能力。
 * @returns 轨道操作面；调用方负责在会话切换或卸载时 dispose。
 */
export function mountRail(doc: Document, deps: RailDeps): RailHandle {
  ensureStyle(doc)

  const host = doc.createElement('div')
  host.setAttribute(HOST_ATTR, '')
  const track = doc.createElement('div')
  track.className = 'dsh-rail-track'
  const card = doc.createElement('div')
  card.className = 'dsh-rail-card'
  const question = doc.createElement('div')
  question.className = 'dsh-rail-q'
  const answer = doc.createElement('div')
  answer.className = 'dsh-rail-a'
  card.append(question, answer)
  host.append(track, card)
  doc.body.append(host)

  let turns: readonly RailTurn[] = []
  let hits: HTMLElement[] = []
  let scrollport: HTMLElement | null = null
  let activeSeq: number | null = null
  let drawHandle: ReturnType<typeof setTimeout> | null = null
  let activeHandle: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  /** 当前生效的滚动容器；换会话或换布局时自动改挂滚动监听。 */
  function resolveScrollport(): HTMLElement | null {
    const found = doc.querySelector(SCROLLPORT_SELECTOR)
    const next = found instanceof HTMLElement ? found : null
    if (next === scrollport) return scrollport
    scrollport?.removeEventListener('scroll', onScroll)
    scrollport = next
    scrollport?.addEventListener('scroll', onScroll, { passive: true })
    return scrollport
  }

  /** 把浮层摆到滚动区左缘，并按可用高度决定是否显示。 */
  function place(): void {
    const port = resolveScrollport()
    if (port === null || turns.length < MIN_TURNS) {
      host.dataset.visible = '0'
      return
    }
    const rect = port.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) {
      host.dataset.visible = '0'
      return
    }
    host.dataset.visible = '1'
    host.style.left = Math.round(rect.left + RAIL_INSET) + 'px'
    host.style.top = Math.round(rect.top) + 'px'
    host.style.height = Math.round(rect.height) + 'px'
    host.style.width = BAR_MAX_WIDTH + 44 + 'px'

    const available = Math.max(0, rect.height - RAIL_PADDING * 2)
    const slot = Math.min(SLOT_MAX, Math.max(SLOT_MIN, available / Math.max(1, turns.length)))
    const total = slot * turns.length
    track.style.top = Math.round((rect.height - total) / 2) + 'px'

    const bar = Math.max(1, Math.min(3, slot - 2))
    for (const hit of hits) {
      hit.style.height = slot + 'px'
      const line = hit.firstElementChild
      if (line instanceof HTMLElement) line.style.height = bar + 'px'
    }
  }

  /** 重建杠，然后重新摆位。 */
  function draw(): void {
    if (disposed) return
    const maxWeight = turns.reduce((max, turn) => Math.max(max, turn.weight), 0)
    track.replaceChildren()
    hits = turns.map((turn, index) => {
      const hit = doc.createElement('button')
      hit.type = 'button'
      hit.className = 'dsh-rail-hit'
      hit.dataset.railIndex = String(index)
      hit.title = turn.question
      const line = doc.createElement('div')
      line.className = 'dsh-rail-bar'
      line.style.width = barWidth(turn.weight, maxWeight) + 'px'
      hit.append(line)
      track.append(hit)
      return hit
    })
    place()
    paintActive()
  }

  /** 计算滚动区顶部当前对着哪一轮，并高亮对应的杠。 */
  function measureActive(): void {
    activeHandle = null
    const port = scrollport
    if (port === null || turns.length === 0) return
    const top = port.getBoundingClientRect().top
    // 未加载的那些轮次没有行，扫描时自然跳过，不参与判定。
    let hitSeq: number | null = null
    for (const turn of turns) {
      const row = turn.key === null ? null : anchorOf(port, turn.key)
      if (row === null) continue
      // 行顶已经越过滚动区顶部，说明这一轮开始了；取最后一个满足的。
      if (row.getBoundingClientRect().top - top <= 8) hitSeq = turn.seq
      else break
    }
    if (hitSeq === null || hitSeq === activeSeq) return
    activeSeq = hitSeq
    paintActive()
  }

  /** 把 activeSeq 落到 DOM 上。 */
  function paintActive(): void {
    turns.forEach((turn, index) => {
      const hit = hits[index]
      if (hit === undefined) return
      hit.dataset.active = turn.seq === activeSeq ? '1' : '0'
    })
  }

  function onScroll(): void {
    place()
    if (activeHandle !== null) return
    activeHandle = setTimeout(measureActive, COALESCE_MS)
  }

  function onResize(): void {
    place()
  }

  /** 悬停：把这一轮的提问与回答填进卡片，并贴着这根杠竖直对齐。 */
  function openCard(index: number): void {
    const turn = turns[index]
    const hit = hits[index]
    if (turn === undefined || hit === undefined) return
    question.textContent = turn.question.length > 0 ? turn.question : '（提问已不在加载窗口内）'
    answer.textContent = turn.answer
    card.dataset.open = '1'

    const hostRect = host.getBoundingClientRect()
    const hitRect = hit.getBoundingClientRect()
    card.style.left = BAR_MAX_WIDTH + 26 + 'px'
    // 先摆一次才量得到高度，然后夹回视口内，避免顶到屏幕上下缘。
    const height = card.offsetHeight
    const wanted = hitRect.top + hitRect.height / 2 - height / 2
    const clamped = Math.max(8, Math.min(wanted, doc.documentElement.clientHeight - height - 8))
    card.style.top = Math.round(clamped - hostRect.top) + 'px'
  }

  function closeCard(): void {
    card.dataset.open = '0'
  }

  track.addEventListener('mouseover', (event) => {
    const target = event.target
    const hit = target instanceof Element ? target.closest('.dsh-rail-hit') : null
    if (!(hit instanceof HTMLElement)) return
    const index = Number(hit.dataset.railIndex)
    if (Number.isInteger(index)) openCard(index)
  })

  track.addEventListener('mouseleave', closeCard)

  /**
   * 滚到某一行。刚补进来的历史要等 React 渲染完才有 DOM，重试几次再放弃。
   * @param key - 目标行的 Chat Node key。
   */
  function scrollToKey(key: string): void {
    let tries = 0
    const attempt = (): void => {
      const port = scrollport
      const row = port === null ? null : anchorOf(port, key)
      if (row !== null) {
        // 瞬时跳，不做平滑动画：跨越上万像素的平滑滚动又慢又容易被宿主的
        // 贴底逻辑打断，而且标签页隐藏时 smooth 根本不推进（无帧可用）。
        row.scrollIntoView({ behavior: 'auto', block: 'start' })
        return
      }
      if (disposed || ++tries > SCROLL_RETRIES) return
      setTimeout(attempt, SCROLL_RETRY_MS)
    }
    attempt()
  }

  track.addEventListener('click', (event) => {
    const target = event.target
    const hit = target instanceof Element ? target.closest('.dsh-rail-hit') : null
    if (!(hit instanceof HTMLElement)) return
    const turn = turns[Number(hit.dataset.railIndex)]
    if (turn === undefined) return

    if (turn.key !== null) {
      scrollToKey(turn.key)
      return
    }

    // 这一轮还在加载窗口之外：先让宿主把历史翻到它，再跳。
    if (hit.dataset.loading === '1') return
    hit.dataset.loading = '1'
    void deps.reveal(turn.seq)
      .then((key) => { if (key !== null && !disposed) scrollToKey(key) })
      .finally(() => { hit.dataset.loading = '0' })
  })

  const timer = setInterval(place, SYNC_INTERVAL_MS)
  window.addEventListener('resize', onResize)

  return {
    update(next: readonly RailTurn[]): void {
      turns = next
      if (drawHandle !== null) return
      drawHandle = setTimeout(() => {
        drawHandle = null
        draw()
      }, COALESCE_MS)
    },
    dispose(): void {
      disposed = true
      clearInterval(timer)
      window.removeEventListener('resize', onResize)
      scrollport?.removeEventListener('scroll', onScroll)
      if (drawHandle !== null) clearTimeout(drawHandle)
      if (activeHandle !== null) clearTimeout(activeHandle)
      host.remove()
    },
  }
}
