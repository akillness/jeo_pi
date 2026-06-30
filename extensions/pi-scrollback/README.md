# pi-scrollback

Two TUI conveniences for the [pi](https://github.com/badlogic/pi-mono) coding
agent:

1. **Scroll up through the conversation** — pi's main viewport relies on the
   terminal's native scrollback, which isn't always reachable (small panes,
   mouse-reporting terminals, remote sessions). This extension adds an in-app,
   keyboard-driven overlay that renders the whole transcript in a scrollable
   bordered window.
2. **Copy the conversation to the clipboard** — grab the full transcript (or
   just the last assistant reply) without selecting text by hand.

## Usage

| Action | Command | Default shortcut |
| --- | --- | --- |
| Open the scrollable history overlay | `/scrollback` | `alt+s` |
| Copy the full transcript | `/copy` (or `/copy all`) | `alt+c` |
| Copy only the last assistant reply | `/copy last` | — |

Inside the scrollback overlay:

- `↑` / `↓` or `k` / `j` — scroll one line
- `PgUp` / `PgDn` (or `Ctrl+B` / `Ctrl+F`, `Space`) — scroll one page
- `g` / `G` — jump to top / bottom
- `q` or `Esc` — close

Copying uses pi's own `copyToClipboard`, which prefers the native clipboard and
falls back to platform tools (`pbcopy`, `wl-copy`, `xclip`/`xsel`, `clip`) and
OSC 52 for remote sessions.

## Design notes

- `transcript.ts` turns pi's `AgentMessage[]` into plain text and has no pi
  runtime imports, so it is trivially unit-testable. Thinking blocks are
  excluded by default; tool calls are summarised as `→ called name(args)`.
- `scroll-view.ts` is a self-contained `Component`. The scroll math
  (`clampOffset`) and width-aware wrapping (`wrapToWidth`, CJK-aware) are pure
  exported functions covered by tests.
- `index.ts` wires the commands and shortcuts and reads the active session via
  `ctx.sessionManager` + `buildSessionContext`.

## Development

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
```
