window.__ModuleLoader__.load({
	id: "@dsh-external/dsh-conversation-rail",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/turns.ts
		/** 围栏代码块——回答预览里一律剔除（bash / diff / json 都在这里面）。 */
		const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
		/** 行首 markdown 修饰：标题号、引用号、列表点、任务框。 */
		const LINE_ORNAMENT = /^[ \t]*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/;
		/** 强调与行内代码的包裹符，去掉后读起来更像正文。 */
		const INLINE_MARKS = /[`*_~]/g;
		/** 连续空白（含换行）。 */
		const WHITESPACE = /\s+/g;
		/**
		* 窗口顶部那段「提问已翻出加载窗口」的助手输出用这个 seq 占位。
		* 有全量大纲时它会被真正的那一轮顶掉。
		*/
		const ORPHAN_SEQ = -1;
		/** 提问最多留这么长，卡片只显示一行，多了没意义。 */
		const QUESTION_LIMIT = 120;
		/** 回答最多留这么长，卡片按行数截断，超出的字符白算。 */
		const ANSWER_LIMIT = 400;
		/**
		* 从内容块数组里取纯文字。
		* @param blocks - 用户消息的 ContentBlock 数组，或助手消息的 AssistantBlock 数组。
		* @returns 按顺序拼起来的文字；非文字块（图片、工具调用、思考链）跳过。
		*/
		function textOf(blocks) {
			if (!Array.isArray(blocks)) return "";
			const parts = [];
			for (const raw of blocks) {
				if (raw === null || typeof raw !== "object") continue;
				const block = raw;
				if ((block.type ?? block.kind) !== "text") continue;
				if (typeof block.text === "string" && block.text.length > 0) parts.push(block.text);
			}
			return parts.join("\n");
		}
		/**
		* 压成一行：去修饰、塌空白、截长度。
		* @param text - 原始文字。
		* @returns 适合当标题显示的单行文本。
		*/
		function oneLine(text) {
			const flat = text.replace(FENCED_CODE, " ").replace(INLINE_MARKS, "").replace(WHITESPACE, " ").trim();
			return flat.length > QUESTION_LIMIT ? flat.slice(0, QUESTION_LIMIT) + "…" : flat;
		}
		/**
		* 整理回答预览：剔除围栏代码，逐行去 markdown 修饰，保留段落换行。
		* @param text - 助手的纯文字拼接结果。
		* @returns 适合多行截断显示的正文。
		*/
		function proseOf(text) {
			const prose = text.replace(FENCED_CODE, "").split("\n").map((line) => line.replace(LINE_ORNAMENT, "").replace(INLINE_MARKS, "").trim()).filter((line) => line.length > 0).join("\n");
			return prose.length > ANSWER_LIMIT ? prose.slice(0, ANSWER_LIMIT) + "…" : prose;
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
		function buildTurns(chat) {
			if (chat === void 0) return [];
			const turns = [];
			let current;
			for (const key of chat.order) {
				const node = chat.nodes.get(key);
				if (node === void 0 || node.visibility === "hidden") continue;
				if (node.kind === "user") {
					const data = node.data;
					const text = textOf(data?.content);
					current = {
						seq: typeof data?.seq === "number" ? data.seq : ORPHAN_SEQ,
						key: node.key,
						question: oneLine(text),
						answer: "",
						weight: text.length
					};
					turns.push(current);
					continue;
				}
				if (node.kind === "assistant-step") {
					if (current === void 0) {
						current = {
							seq: ORPHAN_SEQ,
							key: node.key,
							question: "",
							answer: "",
							weight: 0
						};
						turns.push(current);
					}
					const data = node.data;
					const text = textOf(data?.blocks);
					if (text.length > 0) {
						current.answer = current.answer.length > 0 ? current.answer + "\n" + text : text;
						current.weight += text.length;
					}
					continue;
				}
			}
			for (const turn of turns) turn.answer = proseOf(turn.answer);
			return turns.filter((turn) => turn.question.length > 0 || turn.answer.length > 0);
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
		function mergeTurns(outline, live) {
			if (outline.length === 0) return [...live];
			const bySeq = /* @__PURE__ */ new Map();
			for (const turn of outline) bySeq.set(turn.seq, turn);
			for (const turn of live) {
				if (turn.seq === ORPHAN_SEQ) continue;
				bySeq.set(turn.seq, turn);
			}
			return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
		}
		//#endregion
		//#region src/client/outline.ts
		/**
		* 拉取一个会话的全量轮次目录。
		*
		* @param sessionId - 目标会话。
		* @param signal - 会话切换时取消。
		* @returns 轮次目录；接口不可用或出错时返回空数组，轨道退回到只画已加载的那段。
		*/
		async function fetchOutline(sessionId, signal) {
			try {
				const res = await fetch("/@dsh-external/dsh-conversation-rail/api/outline?sessionId=" + encodeURIComponent(sessionId), { signal });
				if (!res.ok) return [];
				const body = await res.json();
				if (body.ok !== true || !Array.isArray(body.turns)) return [];
				const turns = [];
				for (const raw of body.turns) {
					if (typeof raw?.seq !== "number") continue;
					turns.push({
						seq: raw.seq,
						key: null,
						question: typeof raw.question === "string" ? raw.question : "",
						answer: typeof raw.answer === "string" ? raw.answer : "",
						weight: typeof raw.weight === "number" ? raw.weight : 0
					});
				}
				return turns;
			} catch {
				return [];
			}
		}
		//#endregion
		//#region src/client/rail.ts
		/** 样式表只注入一次，按这个 id 认领。 */
		const STYLE_ID = "dsh-conversation-rail-style";
		/** 浮层根节点的标记属性，便于排查和皮肤覆盖。 */
		const HOST_ATTR = "data-dsh-conversation-rail";
		/** 对话滚动容器——宿主 ChatView 的稳定锚点。 */
		const SCROLLPORT_SELECTOR = "[data-conversation-scroll]";
		/** 每行消息挂的 key，等于 Chat Node key。 */
		const ANCHOR_SELECTOR = "[data-chat-anchor-key]";
		/** 有一轮就画一根杠——空会话之外一律显示。 */
		const MIN_TURNS = 1;
		/** 单根杠的最小 / 最大占位高度（含间距）。 */
		const SLOT_MIN = 3;
		const SLOT_MAX = 11;
		/** 杠长范围。 */
		const BAR_MIN_WIDTH = 10;
		/** 轨道离滚动区左缘的距离。 */
		const RAIL_INSET = 10;
		/** 布局巡检间隔：兜住皮肤动画、侧栏折叠这类不发事件的尺寸变化。 */
		const SYNC_INTERVAL_MS = 250;
		/**
		* 重画与高亮的合并窗口。用定时器而不是 requestAnimationFrame：
		* 标签页隐藏时 rAF 完全不触发，会话在后台读完再切回来就是一条空轨道。
		*/
		const COALESCE_MS = 32;
		/** 补完历史后等 React 把行渲染出来：重试次数与间隔。 */
		const SCROLL_RETRIES = 20;
		const SCROLL_RETRY_MS = 50;
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
`;
		/**
		* 注入一次性样式表。
		* @param doc - 目标文档。
		*/
		function ensureStyle(doc) {
			if (doc.getElementById(STYLE_ID) !== null) return;
			const style = doc.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			doc.head.append(style);
		}
		/**
		* 把权重映射成杠长：开方压缩，长回答不至于把短回答挤成一个点。
		* @param weight - 该轮的字符体量。
		* @param maxWeight - 当前会话里最大的体量。
		* @returns 像素宽度。
		*/
		function barWidth(weight, maxWeight) {
			if (maxWeight <= 0) return BAR_MIN_WIDTH;
			const ratio = Math.sqrt(Math.min(1, weight / maxWeight));
			return Math.round(BAR_MIN_WIDTH + 24 * ratio);
		}
		/**
		* 在对话流里找某一轮对应的行元素。
		* @param root - 搜索根（滚动容器）。
		* @param key - Chat Node key。
		* @returns 命中的行，找不到返回 null。
		*/
		function anchorOf(root, key) {
			for (const row of root.querySelectorAll(ANCHOR_SELECTOR)) if (row instanceof HTMLElement && row.dataset.chatAnchorKey === key) return row;
			return null;
		}
		/**
		* 挂载会话小地图。
		*
		* @param doc - 宿主文档。
		* @param deps - 宿主提供的历史补齐能力。
		* @returns 轨道操作面；调用方负责在会话切换或卸载时 dispose。
		*/
		function mountRail(doc, deps) {
			ensureStyle(doc);
			const host = doc.createElement("div");
			host.setAttribute(HOST_ATTR, "");
			const track = doc.createElement("div");
			track.className = "dsh-rail-track";
			const card = doc.createElement("div");
			card.className = "dsh-rail-card";
			const question = doc.createElement("div");
			question.className = "dsh-rail-q";
			const answer = doc.createElement("div");
			answer.className = "dsh-rail-a";
			card.append(question, answer);
			host.append(track, card);
			doc.body.append(host);
			let turns = [];
			let hits = [];
			let scrollport = null;
			let activeSeq = null;
			let drawHandle = null;
			let activeHandle = null;
			let disposed = false;
			/** 当前生效的滚动容器；换会话或换布局时自动改挂滚动监听。 */
			function resolveScrollport() {
				const found = doc.querySelector(SCROLLPORT_SELECTOR);
				const next = found instanceof HTMLElement ? found : null;
				if (next === scrollport) return scrollport;
				scrollport?.removeEventListener("scroll", onScroll);
				scrollport = next;
				scrollport?.addEventListener("scroll", onScroll, { passive: true });
				return scrollport;
			}
			/** 把浮层摆到滚动区左缘，并按可用高度决定是否显示。 */
			function place() {
				const port = resolveScrollport();
				if (port === null || turns.length < MIN_TURNS) {
					host.dataset.visible = "0";
					return;
				}
				const rect = port.getBoundingClientRect();
				if (rect.width <= 0 || rect.height <= 0) {
					host.dataset.visible = "0";
					return;
				}
				host.dataset.visible = "1";
				host.style.left = Math.round(rect.left + RAIL_INSET) + "px";
				host.style.top = Math.round(rect.top) + "px";
				host.style.height = Math.round(rect.height) + "px";
				host.style.width = "78px";
				const available = Math.max(0, rect.height - 64);
				const slot = Math.min(SLOT_MAX, Math.max(SLOT_MIN, available / Math.max(1, turns.length)));
				const total = slot * turns.length;
				track.style.top = Math.round((rect.height - total) / 2) + "px";
				const bar = Math.max(1, Math.min(3, slot - 2));
				for (const hit of hits) {
					hit.style.height = slot + "px";
					const line = hit.firstElementChild;
					if (line instanceof HTMLElement) line.style.height = bar + "px";
				}
			}
			/** 重建杠，然后重新摆位。 */
			function draw() {
				if (disposed) return;
				const maxWeight = turns.reduce((max, turn) => Math.max(max, turn.weight), 0);
				track.replaceChildren();
				hits = turns.map((turn, index) => {
					const hit = doc.createElement("button");
					hit.type = "button";
					hit.className = "dsh-rail-hit";
					hit.dataset.railIndex = String(index);
					hit.title = turn.question;
					const line = doc.createElement("div");
					line.className = "dsh-rail-bar";
					line.style.width = barWidth(turn.weight, maxWeight) + "px";
					hit.append(line);
					track.append(hit);
					return hit;
				});
				place();
				paintActive();
			}
			/** 计算滚动区顶部当前对着哪一轮，并高亮对应的杠。 */
			function measureActive() {
				activeHandle = null;
				const port = scrollport;
				if (port === null || turns.length === 0) return;
				const top = port.getBoundingClientRect().top;
				let hitSeq = null;
				for (const turn of turns) {
					const row = turn.key === null ? null : anchorOf(port, turn.key);
					if (row === null) continue;
					if (row.getBoundingClientRect().top - top <= 8) hitSeq = turn.seq;
					else break;
				}
				if (hitSeq === null || hitSeq === activeSeq) return;
				activeSeq = hitSeq;
				paintActive();
			}
			/** 把 activeSeq 落到 DOM 上。 */
			function paintActive() {
				turns.forEach((turn, index) => {
					const hit = hits[index];
					if (hit === void 0) return;
					hit.dataset.active = turn.seq === activeSeq ? "1" : "0";
				});
			}
			function onScroll() {
				place();
				if (activeHandle !== null) return;
				activeHandle = setTimeout(measureActive, COALESCE_MS);
			}
			function onResize() {
				place();
			}
			/** 悬停：把这一轮的提问与回答填进卡片，并贴着这根杠竖直对齐。 */
			function openCard(index) {
				const turn = turns[index];
				const hit = hits[index];
				if (turn === void 0 || hit === void 0) return;
				question.textContent = turn.question.length > 0 ? turn.question : "（提问已不在加载窗口内）";
				answer.textContent = turn.answer;
				card.dataset.open = "1";
				const hostRect = host.getBoundingClientRect();
				const hitRect = hit.getBoundingClientRect();
				card.style.left = "60px";
				const height = card.offsetHeight;
				const wanted = hitRect.top + hitRect.height / 2 - height / 2;
				const clamped = Math.max(8, Math.min(wanted, doc.documentElement.clientHeight - height - 8));
				card.style.top = Math.round(clamped - hostRect.top) + "px";
			}
			function closeCard() {
				card.dataset.open = "0";
			}
			track.addEventListener("mouseover", (event) => {
				const target = event.target;
				const hit = target instanceof Element ? target.closest(".dsh-rail-hit") : null;
				if (!(hit instanceof HTMLElement)) return;
				const index = Number(hit.dataset.railIndex);
				if (Number.isInteger(index)) openCard(index);
			});
			track.addEventListener("mouseleave", closeCard);
			/**
			* 滚到某一行。刚补进来的历史要等 React 渲染完才有 DOM，重试几次再放弃。
			* @param key - 目标行的 Chat Node key。
			*/
			function scrollToKey(key) {
				let tries = 0;
				const attempt = () => {
					const port = scrollport;
					const row = port === null ? null : anchorOf(port, key);
					if (row !== null) {
						row.scrollIntoView({
							behavior: "auto",
							block: "start"
						});
						return;
					}
					if (disposed || ++tries > SCROLL_RETRIES) return;
					setTimeout(attempt, SCROLL_RETRY_MS);
				};
				attempt();
			}
			track.addEventListener("click", (event) => {
				const target = event.target;
				const hit = target instanceof Element ? target.closest(".dsh-rail-hit") : null;
				if (!(hit instanceof HTMLElement)) return;
				const turn = turns[Number(hit.dataset.railIndex)];
				if (turn === void 0) return;
				if (turn.key !== null) {
					scrollToKey(turn.key);
					return;
				}
				if (hit.dataset.loading === "1") return;
				hit.dataset.loading = "1";
				deps.reveal(turn.seq).then((key) => {
					if (key !== null && !disposed) scrollToKey(key);
				}).finally(() => {
					hit.dataset.loading = "0";
				});
			});
			const timer = setInterval(place, SYNC_INTERVAL_MS);
			window.addEventListener("resize", onResize);
			return {
				update(next) {
					turns = next;
					if (drawHandle !== null) return;
					drawHandle = setTimeout(() => {
						drawHandle = null;
						draw();
					}, COALESCE_MS);
				},
				dispose() {
					disposed = true;
					clearInterval(timer);
					window.removeEventListener("resize", onResize);
					scrollport?.removeEventListener("scroll", onScroll);
					if (drawHandle !== null) clearTimeout(drawHandle);
					if (activeHandle !== null) clearTimeout(activeHandle);
					host.remove();
				}
			};
		}
		//#endregion
		//#region src/client/index.ts
		/**
		* @dsh-external/dsh-conversation-rail — client 入口：会话小地图。
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
		const inject = ["slots", "sessions"];
		/**
		* 补历史的翻页上限。一次 loadOlder 拉一页，到不了就停——宁可跳不过去，
		* 也不能在用户点一下之后无限翻整份日志。
		*/
		const MAX_PAGES = 40;
		/**
		* 在当前快照里找某个 seq 对应的 Chat Node key。
		* @param chat - 当前 Chat 快照。
		* @param seq - 目标轮次的事件 seq。
		* @returns 已加载则返回它的 key，否则 null。
		*/
		function keyForSeq(chat, seq) {
			if (chat === void 0) return null;
			for (const key of chat.order) {
				const node = chat.nodes.get(key);
				if (node === void 0 || node.kind !== "user") continue;
				if (node.data?.seq === seq) return node.key;
			}
			return null;
		}
		/**
		* 小地图座位。标题栏里不占位置，只负责把数据喂给浮层。
		* @param props - 框架注入的 session 标准套件。
		* @returns 始终为 null——真正的界面在 body 浮层上。
		*/
		function createRailEntry(ctx) {
			return function ConversationRail({ useSession, sessionId }) {
				const chat = useSession((snapshot) => snapshot.chat);
				const live = react.useMemo(() => buildTurns(chat), [chat]);
				const rail = react.useRef(null);
				const outline = react.useRef([]);
				react.useEffect(() => {
					const handle = mountRail(document, { async reveal(seq) {
						const session = ctx.sessions.binding(sessionId)?.session;
						if (session === void 0) return null;
						for (let page = 0; page < MAX_PAGES; page++) {
							const snapshot = session.getSnapshot();
							const key = keyForSeq(snapshot.chat, seq);
							if (key !== null) return key;
							if (snapshot.hasMore !== true) return null;
							await session.loadOlder();
						}
						return null;
					} });
					rail.current = handle;
					return () => {
						rail.current = null;
						handle.dispose();
					};
				}, [sessionId]);
				react.useEffect(() => {
					const abort = new AbortController();
					outline.current = [];
					fetchOutline(sessionId, abort.signal).then((turns) => {
						if (abort.signal.aborted) return;
						outline.current = turns;
						rail.current?.update(mergeTurns(turns, live));
					});
					return () => abort.abort();
				}, [sessionId]);
				react.useEffect(() => {
					rail.current?.update(mergeTurns(outline.current, live));
				}, [live]);
				return null;
			};
		}
		/**
		* 装配：把小地图接到会话标题栏的 utilities 座位上。
		* @param ctx - client Cordis 上下文。
		*/
		function apply(ctx) {
			const ConversationRail = createRailEntry(ctx);
			ctx.effect(() => ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "@dsh-external/dsh-conversation-rail-rail",
				order: 90,
				label: () => "会话小地图"
			}, ConversationRail)), "@dsh-external/dsh-conversation-rail: conversation rail");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map