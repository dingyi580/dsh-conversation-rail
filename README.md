# dsh-conversation-rail · 会话小地图

长会话的快速定位器。对话滚动区左缘一条竖轨，**一根杠 = 一轮对话**；
悬停弹出预览卡，点击跳到那一轮。

```
  ▏─────                 ┌──────────────────────────────┐
  ▏───────────           │ 做任何补丁啊，这…            │  ← 提问（深色，一行，省略号）
  ▏━━━━━━━━━━━━━━  ◀━━━━━┤ CRLF 已排除。下…             │
  ▏──────                │ 大小、只有合法重…            │  ← 回答（淡色，最多四行）
  ▏────────              └──────────────────────────────┘
```

- **杠长** = 这一轮的文字体量（开方压缩，10–34px）。
- **加粗高亮的那根** = 滚动区顶部当前对着的那一轮。
- **预览卡**只放人话：用户提问 + 助手的纯文字回答。围栏代码块、工具调用、
  命令行、思考链、上下文注入一律不进卡片——命令和 JSON 扫不出信息。

## 画的是整个会话，不是当前加载窗口

对话历史是分页加载的，前端快照里通常只有最近一小段——`8 轮` 的会话可能只有
1 轮在窗口里。轨道不受这个限制：

- **骨架**来自 host 的大纲接口（`GET …/api/outline?sessionId=`）。host 用
  `ctx.sessionQuery.readSession()` 读整份日志，折成每轮约百来字节的目录再回给前端，
  不把历史推过网络。
- **实时快照**覆盖其中已加载的那段——它带着可跳转的 DOM 锚点，正在流式输出的
  那一轮也只有它是最新的。两边按 `user/message` 的事件 **seq** 对齐，实时的压过大纲的。
- **点还没加载的那根杠**：反复调 `session.loadOlder()` 翻历史，直到那一轮进入窗口再跳过去。
  翻页期间那根杠会脉动，上限 40 页——宁可跳不过去，也不会因为点一下就无限翻整份日志。

大纲用 `readSession` 而不是更轻的 `filterEvents`，是因为后者不回 `source`。而
`user/message` 这个事件类型同时装着**真人提问**和 `agent.inject()` 注入的上下文
（文件变更通知、AGENTS.md、skill 正文……），官方文档写明三者都原样投影 content、
**靠 `source` 区分**。少了这个字段就会把注入的上下文也画成一根杠。

## 它是怎么接上去的

占一个座位：`conversation.session.header.utilities`。选它不是为了在标题栏画
东西——这是 session 作用域的槽，组件能拿到框架的 `useSession` 快照钩子和
`sessionId`，生命周期跟着会话走。组件在标题栏里渲染 `null`，真正的轨道是
body 上的 fixed 浮层，按 `[data-conversation-scroll]` 的实测矩形对齐，
不参与宿主布局，换皮肤 / 折叠侧栏 / 改栅格都不会把它挤歪。

数据只来自 `ConversationSnapshot.chat`：按 `order` 遍历，遇到 `user` 开一轮，
其后的 `assistant-step` 文字块归到这一轮。跳转用宿主自己那套锚点
（`[data-chat-anchor-key]`），和它内部的滚动定位走同一条路。

## 已知边界

- **大纲一个会话取一次。** 新产生的轮次从实时快照进来，不重取；只有切走再切回
  才会重新拉（host 侧 5 秒缓存兜住来回跳）。
- **跳到很早的轮次 = 把它之前的历史全加载进来。** 这是分页本身的语义：要显示第 1 轮，
  就得把它到窗口之间的都翻出来。跳最近的几轮则几乎不用翻页。
- **大纲接口失败时自动降级**，退回只画已加载的那一段，不会让轨道消失。
- **预览按纯文本渲染**，不解析 markdown：行首的 `#`、`-`、`1.` 和强调符会被剥掉，
  围栏代码整块删除。

## 安装

装配信息在 profile 里，不在本仓库。把插件放到 `~/.dsh/plugins/dsh-conversation-rail`
之后，往 `~/.dsh/profiles/web/package.json` 加两处：

```json
{
  "dsh": { "profile": { "bundles": ["…", "@dsh-external/dsh-conversation-rail"] } },
  "dependencies": {
    "@dsh-external/dsh-conversation-rail": "link:/Users/<你>/.dsh/plugins/dsh-conversation-rail"
  }
}
```

再把它链进 profile 的 node_modules，然后重启 web 服务（新插件进装配表要重启，
改代码可以用 `dev_reload_package` 热重载）：

```bash
ln -sfn ../../../../plugins/dsh-conversation-rail ~/.dsh/profiles/web/node_modules/@dsh-external/dsh-conversation-rail
```

## 构建

```bash
node_modules/.bin/tsc -p tsconfig.json   # 类型校验
node_modules/.bin/tsdown                  # src/client → lib/client.js
```

`lib/index.js` 是手写的空 host 入口（这个插件没有 host 行为），不参与构建。
装配走 `cordis.patch.yml` + profile 的 `dsh.profile.bundles`。
