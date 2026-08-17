# dsh-conversation-rail · session minimap

English | [中文](README.zh.md)

A locator for long conversations in DSH Web. A vertical rail sits along the left
edge of the conversation, **one bar per turn**; hover a bar for a preview card,
click it to jump to that turn.

```
  ▏─────                 ┌──────────────────────────────┐
  ▏───────────           │ Can you patch this without…  │  ← question (one line, dark)
  ▏━━━━━━━━━━━━━━  ◀━━━━━┤ CRLF is already ruled out…   │
  ▏──────                │ only the legal re-encodes…   │  ← answer (up to four lines, dimmed)
  ▏────────              └──────────────────────────────┘
```

- **Bar length** = how much text that turn holds (square-root compressed, 10–34px).
- **The bold bar** = the turn currently at the top of the scroll area.
- **The preview card** carries prose only: your question plus the assistant's plain
  text. Fenced code blocks, tool calls, shell commands, reasoning traces and
  injected context never reach the card — you cannot skim JSON.

## It draws the whole session, not the loaded window

Conversation history is paginated: the front-end snapshot usually holds only the
most recent stretch, so an `8-turn` session may have 1 turn in the window. The
rail is not bound by that:

- **The skeleton** comes from the host's outline endpoint
  (`GET /dsh-conversation-rail/api/outline?sessionId=`). The host reads the full
  log with `ctx.sessionQuery.readSession()`, folds it into a table of contents of
  roughly a hundred bytes per turn, and returns that — the history itself never
  crosses the network.
- **The live snapshot** overrides the part that is loaded: it carries jumpable DOM
  anchors, and for a turn that is still streaming it is the only current source.
  The two are aligned by the `user/message` event **seq**, live winning over outline.
- **Clicking a bar that isn't loaded yet** calls `session.loadOlder()` repeatedly
  until that turn enters the window, then jumps. The bar pulses while paging, with
  a ceiling of 40 pages — better to not reach a turn than to page through an entire
  log because of one click.

The outline uses `readSession` rather than the lighter `filterEvents` because the
latter does not return `source`. The `user/message` event type carries both **real
questions** and context injected by `agent.inject()` (file-change notices,
AGENTS.md, skill bodies…); the official docs state all three project `content`
verbatim and are told apart **by `source`**. Without that field, injected context
would be drawn as turns.

## How it attaches

It takes one seat: `conversation.session.header.utilities`. Not to draw anything in
the header — that slot is session-scoped, so the component receives the framework's
`useSession` snapshot hook and `sessionId`, and its lifetime follows the session.
The component renders `null` in the header; the actual rail is a fixed overlay on
`body`, aligned to the measured rectangle of `[data-conversation-scroll]`. It stays
out of the host layout, so switching skins, collapsing the sidebar or changing the
grid cannot squeeze it.

Turn data comes from `ConversationSnapshot.chat`: walk `order`, open a turn on a
`user` node, attribute the following `assistant-step` text blocks to it. Jumping
uses the host's own anchors (`[data-chat-anchor-key]`), the same path its internal
scroll positioning takes.

## Known boundaries

- **The outline is fetched once per session.** New turns arrive through the live
  snapshot and do not trigger a refetch; only leaving and returning to the session
  refetches (a 5-second host-side cache absorbs the back-and-forth).
- **Jumping to a very early turn loads every page between it and the window.**
  That is what pagination means: to show turn 1, everything from there up to the
  loaded window has to come in. Jumping to recent turns pages almost not at all.
- **If the outline endpoint fails, the rail degrades** to drawing only the loaded
  stretch rather than disappearing.
- **Previews are rendered as plain text**, not markdown: leading `#`, `-`, `1.` and
  emphasis marks are stripped, fenced code is removed entirely.

## Install

```sh
dsh plugin --profile web add github:dingyi580/dsh-conversation-rail
```

Then restart `dsh web` (a newly assembled plugin needs a restart; later code changes
can be hot-reloaded with `dev_reload_package`).

<details>
<summary>Installing from a local checkout</summary>

Put the plugin at `~/.dsh/plugins/dsh-conversation-rail`, then add two entries to
`~/.dsh/profiles/web/package.json`:

```json
{
  "dsh": { "profile": { "bundles": ["…", "dsh-conversation-rail"] } },
  "dependencies": {
    "dsh-conversation-rail": "link:/Users/<you>/.dsh/plugins/dsh-conversation-rail"
  }
}
```

and link it into the profile's `node_modules`:

```sh
ln -sfn ../../../plugins/dsh-conversation-rail ~/.dsh/profiles/web/node_modules/dsh-conversation-rail
```

</details>

## Build

```sh
npm run build       # tsc for the host entry + tsdown for src/client → lib/client.js
npm run typecheck   # type check only
```

`lib/` is committed so the plugin installs from GitHub without a build step.
Assembly goes through `cordis.patch.yml` plus the profile's `dsh.profile.bundles`.

## License

BSD-3-Clause
