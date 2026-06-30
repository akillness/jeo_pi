# Provider Auth Extension

OAuth subscription login and custom model providers for the pi coding agent.

This extension wires four things into pi's native `/login`:

1. **Anthropic (Claude)** — a subscription provider that overrides pi's built-in
   Claude OAuth + streaming with `jeo-code`'s proven flow, and replaces pi's
   stale built-in Claude list with an up-to-date model catalogue.
2. **Antigravity** — a subscription provider that talks to Google's Cloud Code
   Assist (CCA) backend, with the OAuth flow, scopes, and model catalogue kept
   in parity with `jeo-code`.
3. **Tencent (TokenHub)** — an API-key *hub* provider fronting Tencent Cloud
   MaaS's international TokenHub, surfacing every hosted model family (DeepSeek,
   MiniMax, Zhipu GLM, Moonshot Kimi, Tencent Hunyuan) under one `tencent`
   provider, with the catalogue kept in parity with `jeo-code`.
4. **Custom providers** — any OpenAI-compatible endpoints declared in
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
| `streamSimple` (`anthropic-messages` api) | Claude Code request shape that makes an OAuth subscription respond — identity headers, billing/cloaking metadata, system prelude, adaptive/budget thinking, native tool blocks (`anthropic/messages.ts`). The OAuth shape is **host-gated**: `shouldUseOAuthShape` only emits it for a Claude `sk-ant-oat` token **on `api.anthropic.com`** (`isGenuineAnthropicHost`), so the transport shared with Tencent never leaks Claude cloaking to a compatible hub |
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

The 4.x ids all resolve over the OAuth subscription (live-verified 200). The
legacy `claude-3-5-sonnet-20241022` is served only on the **`sk-ant-…` API-key
path** — the Claude Pro/Max OAuth subscription returns HTTP 404 `model:` for it
(it is not in the Claude Code model set), so pick it only when logged in with an
API key.

Thinking transport is selected per id by `messages.ts`: opus 4.6+ stream via
adaptive thinking, 4.5 via budget-effort, older ids via budget. Three HTTP-400
fail-safes in `postAnthropic` keep a request alive instead of erroring: a
deprecated `temperature` (`isDeprecatedTemperatureError`, e.g. Opus 4.8) retries
once without it, an unsupported effort/adaptive field
(`isEffortUnsupportedError`, e.g. Sonnet/Haiku 4.5) retries with plain budget
thinking, and a rejected replayed reasoning artifact (`isReasoningArtifactError`)
retries with the artifacts stripped — and crucially that strip retry now also
disables `payload.thinking`, so a `thinking`-enabled request can never bounce on
the same "bare `tool_use` without a leading thinking block" 400 a second time.

`buildAnthropicMessages` also avoids that 400 on the first attempt: when thinking
is enabled but an assistant `tool_use` turn carries no signed thinking block
(e.g. it was produced while thinking was OFF and thinking is then toggled on),
Anthropic rejects the bare `tool_use` ("Expected `thinking`… found `tool_use`").
That turn is degraded to plain text (its `tool_use` dropped) and its matching
`tool_result` folds into plain user text in lockstep, so the message array stays
valid — jeo-code's "no signed artifact ⇒ no native `tool_use`" invariant. When
thinking is OFF, native `tool_use`/`tool_result` blocks are always preserved.

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

## Tencent hub (TokenHub)

`tencent/register.ts` registers the provider name `tencent` as a hosted model
*hub*. Tencent Cloud MaaS's international TokenHub
(`https://tokenhub-intl.tencentcloudmaas.com`) is a single API-key endpoint that
serves many third-party model families over the **Anthropic Messages** wire
format, so it registers with `api: "anthropic-messages"` — pi's Anthropic client
posts to `${baseUrl}/v1/messages` with an `x-api-key` header, exactly what
TokenHub expects. The provider registers its key as the template reference
`$TENCENT_API_KEY`, which pi interpolates from the `TENCENT_API_KEY` environment
variable at request time (a bare env-var name would be sent verbatim and
rejected), so the hub surfaces under `/login → "Use an API key"` and `/model`;
requests succeed once that key is set (`export TENCENT_API_KEY=sk-…`).

Because pi's transport registry keys by the `api` string, Tencent and Anthropic
**share the one `anthropic-messages` `streamSimple`**. The shared transport is
host-aware (`shouldUseOAuthShape` / `isGenuineAnthropicHost` in
`anthropic/messages.ts`): TokenHub always receives the plain `x-api-key` Messages
shape and **never** the Claude Code OAuth cloaking (Bearer auth, identity/billing
headers, system prelude) — even if `TENCENT_API_KEY` happens to contain
`sk-ant-oat`. Tencent declares no `oauth` block, so it is API-key only.

`TENCENT_MODEL_IDS` (`tencent/register.ts`) mirrors `jeo-code`'s verified
catalogue (`src/ai/providers/openai-compatible-catalog.ts`,
`src/ai/model-catalog.ts`). TokenHub exposes no `/v1/models` route, so this list
is the offline source of truth for the hub's picker. All ids carry a 128K context
window, 8K max output, and expose reasoning; only the GLM vision line accepts
images:

| Family | Model ids | Images |
|--------|-----------|--------|
| DeepSeek | `deepseek-v4-pro`, `deepseek-v4-pro-202606`, `deepseek-v4-flash`, `deepseek-v4-flash-202605`, `deepseek-v3.2` | no |
| MiniMax | `minimax-m3`, `minimax-m2.7`, `minimax-m2.5` | no |
| Zhipu GLM | `glm-5.2`, `glm-5.1`, `glm-5`, `glm-5-turbo`, `glm-5v-turbo` | `glm-5v-turbo` only |
| Moonshot Kimi | `kimi-k2.6`, `kimi-k2.5` | no |
| Tencent Hunyuan | `hy-mt2-plus` | no |

The default model when the hub is selected is `tencent/deepseek-v4-pro`.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Registers Anthropic + Antigravity + Tencent + loads custom providers from `models.json` |
| `anthropic/register.ts` | Claude model catalogue + provider registration (OAuth, `streamSimple`) |
| `anthropic/oauth.ts` | Claude OAuth PKCE flow + rotating-token refresh |
| `anthropic/messages.ts` | Claude Code `/v1/messages` streaming transport (thinking, tools) |
| `antigravity/register.ts` | Model catalogue + provider registration (`modifyModels`) |
| `antigravity/oauth.ts` | OAuth flow + branded callback page serving |
| `tencent/register.ts` | Tencent TokenHub hub provider registration + hosted model catalogue |
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

