# AGENTS

## Debugging Quick Toggle (Pi startup/autocomplete)

When debugging slow startup or delayed `/` autocomplete, enable the built-in debug flags below.

### 1) Fast startup timing breakdown
```bash
PI_TIMING=1 PI_STARTUP_BENCHMARK=1 pi
```
- Prints stage-by-stage startup timings (including `interactiveMode.init`).
- Useful to detect whether delay is in startup initialization vs runtime behavior.

### 2) Autocomplete debug logging
```bash
PI_AUTOCOMPLETE_DEBUG=1 pi
```
- Writes autocomplete lifecycle logs to:
  - `~/.pi/agent/pi-debug.log`
- Includes markers such as:
  - interactive mode construction
  - autocomplete setup timing
  - extension binding start/end
  - first `/` input timing and provider state

### 3) Typical repro flow for delayed `/` suggestions
```bash
cd /
PI_AUTOCOMPLETE_DEBUG=1 pi
```
Then immediately type `/` and inspect logs:
```bash
tail -n 120 ~/.pi/agent/pi-debug.log
```

### 4) TUI painted-frame FPS overlay (PI_FPS)
```bash
PI_FPS=1 pi
```
- Adds a live `FPS <n>` segment to the agentic-harness footer (metrics row).
- Counts actually-painted frames/sec — i.e. `RoachFooter.render()` invocations,
  which the TUI coalesces/throttles, so this is the real frame rate, not the raw
  `requestRender()` call rate.
- When the UI is idle (no animation/streaming/typing) the TUI stops painting and
  the number decays to `FPS 0`; it rises during spinner animation, streaming
  output, or typing. That idle→0 behavior is honest, not a bug.
- Implemented in `extensions/agentic-harness`; disabled by default → zero
  overhead and no output change when unset.

### 5) Keep debug off by default
These flags are opt-in and should remain off in normal usage.
## Startup Gotcha: duplicate package registration

If `pi` aborts at startup with many `Tool "…" conflicts with …` / `Flag "…"
conflicts with …` lines (followed by `Hint: Start without extensions using "pi
-ne"`), the same jeo-pi extensions are registered twice — almost always a local
dev checkout (`pi install .`) **and** the git package
(`pi install git:github.com/akillness/jeo-pi`) at once. pi dedupes packages by
canonical path (`resource-loader.mergePaths`), so it cannot tell two physical
copies are the same repo and every shared tool/flag collides → fatal exit.

Fix: register exactly one source.

```bash
pi list                                     # see what is registered
pi remove .                                 # keep the git package, or…
pi remove git:github.com/akillness/jeo-pi   # keep developing from the checkout
```
