# Provider Auth Extension

OAuth subscription login and custom model providers for the pi coding agent.

This extension wires two things into pi's native `/login`:

1. **Antigravity** — a subscription provider that talks to Google's Cloud Code
   Assist (CCA) backend, with the OAuth flow, scopes, and model catalogue kept
   in parity with `jeo-code`.
2. **Custom providers** — any OpenAI-compatible endpoints declared in
   `~/.pi/agent/models.json` are loaded and registered automatically.

Anthropic (Claude) subscription login is provided natively by pi-ai and needs no
registration here; it shares the same branded sign-in page (see below).

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

## Antigravity OAuth

`antigravity/oauth.ts` mirrors `jeo-code`'s flow:

| Field | Value |
|-------|-------|
| Callback | `http://localhost:51121/oauth-callback` |
| Scopes | `cloud-platform`, `userinfo.email`, `userinfo.profile`, `cclog`, `experimentsandconfigs` |
| Project | resolved at login via CCA discovery, then stamped onto models by the `modifyModels` hook |

Credentials and the discovered project id persist to `~/.pi/agent/auth.json`.

## Antigravity model catalogue

`ANTIGRAVITY_MODEL_IDS` (`antigravity/register.ts`) matches `jeo-code`'s
`ANTIGRAVITY_MODELS` — 20 ids served via Cloud Code Assist:

- **Claude:** `claude-opus-4-5-thinking`, `claude-opus-4-6-thinking`,
  `claude-opus-4-7`(+`-thinking`), `claude-opus-4-8`(+`-thinking`),
  `claude-sonnet-4-5`(+`-thinking`), `claude-sonnet-4-6`(+`-thinking`)
- **Gemini:** `gemini-2.5-flash`(+`-thinking`), `gemini-2.5-pro`,
  `gemini-3-flash`, `gemini-3-pro-high/low`, `gemini-3.1-pro-high/low`
- **Other:** `gpt-oss-120b-medium`, `gpt-5.5`

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
| `index.ts` | Registers Antigravity + loads custom providers from `models.json` |
| `antigravity/register.ts` | Model catalogue + provider registration (`modifyModels`) |
| `antigravity/oauth.ts` | OAuth flow + branded callback page serving |
| `auth-page.ts` | Branded pi 인증 브라우저 page renderer |
| `loader.ts`, `models-config.ts` | Custom providers from `~/.pi/agent/models.json` |

## Tests

bash
npx vitest run extensions/provider-auth --exclude '**/*.manual.test.ts'


Live wire tests against the real CCA backend (require valid credentials in
`~/.pi/agent/auth.json`):

bash
PI_LIVE_ANTIGRAVITY=1 npx vitest run extensions/provider-auth/tests/live-antigravity.manual.test.ts

