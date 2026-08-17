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
/** 围栏代码块——预览里一律剔除。 */
const FENCED_CODE = /```[\s\S]*?(?:```|$)/g;
/** 行首 markdown 修饰。 */
const LINE_ORNAMENT = /^[ \t]*(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s*)?|\d+[.)]\s+)/;
/** 强调与行内代码的包裹符。 */
const INLINE_MARKS = /[`*_~]/g;
/** 连续空白（含换行）。 */
const WHITESPACE = /\s+/g;
const QUESTION_LIMIT = 120;
const ANSWER_LIMIT = 400;
/**
 * 取内容块里的纯文字。
 * @param content - ContentBlock 数组。
 * @returns 拼接后的文字；非 text 块（图片、工具调用、思考链）跳过。
 */
function textOf(content) {
    if (!Array.isArray(content))
        return '';
    const parts = [];
    for (const raw of content) {
        if (raw === null || typeof raw !== 'object')
            continue;
        const block = raw;
        if (block.type !== 'text')
            continue;
        if (typeof block.text === 'string' && block.text.length > 0)
            parts.push(block.text);
    }
    return parts.join('\n');
}
/**
 * 压成一行。
 * @param text - 原文。
 * @returns 单行预览。
 */
function oneLine(text) {
    const flat = text.replace(FENCED_CODE, ' ').replace(INLINE_MARKS, '').replace(WHITESPACE, ' ').trim();
    return flat.length > QUESTION_LIMIT ? flat.slice(0, QUESTION_LIMIT) + '…' : flat;
}
/**
 * 整理回答预览。
 * @param text - 原文。
 * @returns 去代码、去修饰后的正文。
 */
function proseOf(text) {
    const lines = text
        .replace(FENCED_CODE, '')
        .split('\n')
        .map((line) => line.replace(LINE_ORNAMENT, '').replace(INLINE_MARKS, '').trim())
        .filter((line) => line.length > 0);
    const prose = lines.join('\n');
    return prose.length > ANSWER_LIMIT ? prose.slice(0, ANSWER_LIMIT) + '…' : prose;
}
/**
 * 读整份日志，折成轮次目录。
 *
 * @param query - host 的 sessionQuery 服务。
 * @param sessionId - 目标会话。
 * @returns 从旧到新的轮次；读不到日志时抛出，由调用方转成 HTTP 错误。
 */
export async function buildOutline(query, sessionId) {
    const { events } = await query.readSession(sessionId);
    const turns = [];
    let current;
    for (const event of events) {
        if (event.type === 'user/message') {
            const data = event.data;
            // 只有真人提问开一轮；plugin 注入的上下文共用这个事件类型，跳过。
            if (data?.source?.kind !== 'user')
                continue;
            const text = textOf(data.content);
            current = { seq: event.seq, question: oneLine(text), answer: '', weight: text.length };
            turns.push(current);
            continue;
        }
        if (event.type === 'assistant/message') {
            if (current === undefined)
                continue;
            const data = event.data;
            const text = textOf(data?.message?.content);
            if (text.length === 0)
                continue;
            current.answer = current.answer.length > 0 ? current.answer + '\n' + text : text;
            current.weight += text.length;
            continue;
        }
        // tool/result、chunk、turn 边界等一概不进大纲。
    }
    for (const turn of turns)
        turn.answer = proseOf(turn.answer);
    return turns.filter((turn) => turn.question.length > 0 || turn.answer.length > 0);
}
//# sourceMappingURL=outline.js.map