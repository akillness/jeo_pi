# Provider Auth Extension

OAuth subscription login and custom model providers for the pi coding agent.

This extension wires three things into pi's native `/login`:

1. **Anthropic (Claude)** — a subscription provider that overrides pi's built-in
   Claude OAuth + streaming with `jeo-code`'s proven flow, and replaces pi's
   stale built-in Claude list with an up-to-date model catalogue.
2. **Antigravity** — a subscription provider that talks to Google's Cloud Code
   Assist (CCA) backend, with the OAuth flow, scopes, and model catalogue kept
   in parity with `jeo-code`.
3. **Custom providers** — any OpenAI-compatible endpoints declared in
   `~/.pi/agent/models.json` are loaded and registered automatically.

All providers share the same branded sign-in page (see below).

## Sign in

bash
pi
/login          # then select Anthropic / Antigravity / OpenAI / Copilot / …


### Branded pi 인증 브라우저 page

After the OAuth handshake completes, the local callback server renders pi's own
**인증 브라우저** confirmation page — the pi logo (`viewBox="0 0 800 800"`) with a
success or error state — instead of a bare redirect, then hands the token back to
the terminal and closes.

- **Antigravity** callbacks are served by `auth-page.ts`
  (`authSuccessHtml` / `authErrorHtml`), a byte-for-byte replica of pi-ai's
  internal `oauth-page.js` renderer.
- **Anthropic (Claude)** uses pi-ai's built-in `oauthSuccessHtml` /
  `oauthErrorHtml`, which is the same page family.

> pi-ai's `oauth-page.js` is not in the package `exports`, so the page is
> replicated locally rather than imported via a subpath.

## Anthropic OAuth

`anthropic/register.ts` registers the provider name `anthropic`, overriding pi's
built-in Claude provider in the global `/login` registry:

| Piece | What it does |
|-------|--------------|
| `oauth` block | `jeo-code`'s `claude.ai/oauth/authorize` PKCE flow (`anthropic/oauth.ts`), replacing pi's built-in (`platform.claude.com`) login |
| `streamSimple` (`anthropic-messages` api) | Claude Code request shape that makes an OAuth subscription respond — identity headers, billing/cloaking metadata, system prelude, adaptive/budget thinking, native tool blocks (`anthropic/messages.ts`) |
| `models` catalogue | Replaces pi's stale built-in Claude list (full replacement) and pins every Claude id to the transport above |

OAuth refresh tokens are **single-use (rotating)**: each refresh returns a new
access+refresh pair and invalidates the prior one, so credentials are persisted
back to `~/.pi/agent/auth.json` immediately after every refresh. Both the
`sk-ant-…` API-key path (`ANTHROPIC_API_KEY`) and the Pro/Max OAuth subscription
authenticate — but see the third-party-usage limit below for what the
subscription will and will not serve.

### Subscription third-party-usage limit (HTTP 400)

Anthropic's OAuth `/v1/messages` endpoint classifies each call as **first-party
Claude Code** or **third-party app**. Third-party traffic is now billed to a
separate *extra-usage* balance, so when that balance is empty the call fails with
`HTTP 400 invalid_request_error: "Third-party apps now draw from your extra
usage, not your plan limits."` — independent of the wire shape, which is already
a faithful `jeo-code`/Claude-Code port (identity headers, billing/cloaking
metadata, system prelude).

Two request properties flip a jeo-pi call from first- to third-party. Both were
isolated by live A/B replay against the real endpoint with the same OAuth token
(a bare request and even a 216 KB *benign* prompt both return 200, so neither is
a size limit):

1. **The `todowrite` tool name.** Anthropic exact-string-matches the lowercase
   `todowrite`; the canonical `TodoWrite` and every other spelling (`todo_write`,
   `write_todos`, …) pass. jeo-pi registers the tool as `todowrite`, so its
   presence alone trips the classifier.
2. **jeo-pi's agentic system prompt.** A *content* classifier (not size) trips on
   jeo-pi's harness framing + `<available_skills>` catalog once the jeo-pi-specific
   content passes roughly 7 KB; an equal-size benign prompt is served fine.

Because the full jeo-pi system prompt + toolset trips both gates, the **Pro/Max
subscription returns HTTP 400 for normal jeo-pi sessions**. For guaranteed full
functionality use an `sk-ant-api…` API key (`/login` → "Use an API key", or
`ANTHROPIC_API_KEY`), which is usage-billed and bypasses the subscription
classifier entirely. The runtime surfaces this exact guidance in the 400 error
message (`anthropic/messages.ts`, `isThirdPartyUsageError`).

## Anthropic model catalogue

`ANTHROPIC_CATALOG` (`anthropic/register.ts`) mirrors `jeo-code`'s verified
direct-API entries (`src/ai/model-catalog.ts`). Every id is the exact wire id the
live `/v1/messages` endpoint serves; all carry a 200K context window, accept text
+ images, and bill at 0 cost (the Pro/Max subscription is not per-token billed).

| Model id | Label | Reasoning | Max output |
|----------|-------|-----------|------------|
| `claude-opus-4-8` | Claude Opus 4.8 | yes | 64K |
| `claude-opus-4-7` | Claude Opus 4.7 | yes | 64K |
| `claude-opus-4-6` | Claude Opus 4.6 | yes | 64K |
| `claude-opus-4-5-20251101` | Claude Opus 4.5 | yes | 64K |
| `claude-opus-4-1-20250805` | Claude Opus 4.1 | yes | 32K |
| `claude-sonnet-4-5-20250929` | Claude Sonnet 4.5 | yes | 64K |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 | yes | 64K |
| `claude-3-5-sonnet-20241022` | Claude 3.5 Sonnet | no | 8,192 |

Thinking transport is selected per id by `messages.ts`: opus 4.6+ stream via
adaptive thinking, 4.5 via budget-effort, older ids via budget.

## Antigravity OAuth

`antigravity/oauth.ts` mirrors `jeo-code`'s flow:

| Field | Value |
|-------|-------|
| Callback | `http://localhost:51121/oauth-callback` |
| Scopes | `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs` |
| Project | resolved at login via CCA discovery, then stamped onto models by the `modifyModels` hook |

Credentials and the discovered project id persist to `~/.pi/agent/auth.json`.

## Antigravity model catalogue

`ANTIGRAVITY_MODEL_IDS` (`antigravity/register.ts`) is the live-routable CCA
catalogue for pi's OAuth path. `jeo-code` carries a broader static catalogue,
but pi only offers ids that avoid HTTP 400/404 on `streamGenerateContent`:

- **Claude:** `claude-opus-4-6-thinking`, `claude-sonnet-4-6`
- **Gemini:** `gemini-2.5-flash`, `gemini-2.5-flash-lite`,
  `gemini-2.5-flash-thinking`, `gemini-2.5-pro`, `gemini-3-flash`,
  `gemini-3-flash-agent`, `gemini-3.1-flash-lite`, `gemini-3.1-pro-low`,
  `gemini-3.5-flash-extra-low`, `gemini-3.5-flash-low`, `gemini-pro-agent`
- **Other:** `gpt-oss-120b-medium`

Capability rules (`toAntigravityModel`) follow jeo-code's catalogue:

| Family | Context window | Max output | Images |
|--------|----------------|------------|--------|
| Claude | 200K | 64K | yes |
| GPT-5  | 400K | 128K | yes |
| Gemini / gpt-oss | 1M | 65,536 | gpt-oss is text-only |

All models expose reasoning (at least standard thinking).

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Registers Anthropic + Antigravity + loads custom providers from `models.json` |
| `anthropic/register.ts` | Claude model catalogue + provider registration (OAuth, `streamSimple`) |
| `anthropic/oauth.ts` | Claude OAuth PKCE flow + rotating-token refresh |
| `anthropic/messages.ts` | Claude Code `/v1/messages` streaming transport (thinking, tools) |
| `antigravity/register.ts` | Model catalogue + provider registration (`modifyModels`) |
| `antigravity/oauth.ts` | OAuth flow + branded callback page serving |
| `auth-page.ts` | Branded pi 인증 브라우저 page renderer |
| `loader.ts`, `models-config.ts` | Custom providers from `~/.pi/agent/models.json` |

## Tests

bash
npx vitest run extensions/provider-auth --exclude '**/*.manual.test.ts'


Live wire tests against the real backends (require valid credentials in
`~/.pi/agent/auth.json`):

bash
PI_LIVE_ANTIGRAVITY=1 npx vitest run extensions/provider-auth/tests/live-antigravity.manual.test.ts
PI_LIVE_ANTHROPIC=1   npx vitest run extensions/provider-auth/tests/live-anthropic.manual.test.ts

