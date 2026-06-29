/**
 * Anthropic (Claude Pro/Max) OAuth — faithful port of jeo-code's
 * `src/auth/flows/anthropic.ts`, adapted to pi's OAuth provider interface.
 *
 * This replaces pi's built-in Anthropic OAuth flow (which points at
 * `platform.claude.com` with a wider scope set) with jeo-code's proven
 * `claude.ai/oauth/authorize` → `api.anthropic.com/v1/oauth/token` PKCE flow.
 * The resulting access token is used as `Authorization: Bearer` together with
 * the Claude Code identity headers in `messages.ts`.
 *
 * The pure builders (auth URL, exchange/refresh bodies, credential lift, PKCE)
 * are exported separately so they are unit-testable without a browser or
 * network. The live `login()` runs a localhost callback server and falls back
 * to manual code entry, mirroring `antigravity/oauth.ts`.
 */

import { createHash, randomBytes } from "crypto";
import { createServer } from "http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { authErrorHtml, authSuccessHtml } from "../auth-page.js";

const decode = (s: string): string => Buffer.from(s, "base64").toString("utf-8");

/** Anthropic's public Claude Code OAuth client id (base64-encoded, jeo-code parity). */
const CLIENT_ID = decode("OWQxYzI1MGEtZTYxYi00NGQ5LTg4ZWQtNTk0NGQxOTYyZjVl");

export const ANTHROPIC_AUTHORIZE_URL = "https://claude.ai/oauth/authorize";
export const ANTHROPIC_TOKEN_URL = "https://api.anthropic.com/v1/oauth/token";
export const ANTHROPIC_CALLBACK_PORT = 54545;
export const ANTHROPIC_CALLBACK_PATH = "/callback";
export const ANTHROPIC_SCOPES = "org:create_api_key user:profile user:inference";

/** The Anthropic OAuth client id (decoded from the bundled base64). */
export function anthropicClientId(): string {
  return CLIENT_ID;
}

/** base64url without padding. */
function base64Url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface PkcePair {
  verifier: string;
  challenge: string;
}

/** Generate a PKCE verifier/challenge pair (S256). Pure-ish (uses crypto RNG). */
export function generatePkce(): PkcePair {
  const verifier = base64Url(randomBytes(32));
  const challenge = base64Url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Build the Claude authorization-code URL. Pure. */
export function buildAuthUrl(redirectUri: string, state: string, challenge: string): string {
  const params = new URLSearchParams({
    code: "true",
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTHROPIC_SCOPES,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  });
  return `${ANTHROPIC_AUTHORIZE_URL}?${params.toString()}`;
}

/** Body for the authorization-code → token exchange. Pure. */
export function buildTokenExchangeBody(
  code: string,
  state: string,
  redirectUri: string,
  verifier: string,
): Record<string, string> {
  return {
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    state,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };
}

/** Body for a refresh-token grant. Pure. */
export function buildRefreshBody(refreshToken: string): Record<string, string> {
  return {
    grant_type: "refresh_token",
    client_id: CLIENT_ID,
    refresh_token: refreshToken,
  };
}

interface AnthropicTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  account?: { uuid?: string; email_address?: string };
}

/**
 * A pasted authorization value may be a full redirect URL, a `code#state`
 * fragment, or a bare code. Normalize it to `{ code, state }`. Pure.
 */
export function parseAuthorizationCode(input: string, fallbackState: string): { code: string; state: string } {
  const value = input.trim();
  // Full redirect URL → read query params.
  try {
    const url = new URL(value);
    const code = url.searchParams.get("code");
    if (code) return { code, state: url.searchParams.get("state") ?? fallbackState };
  } catch {
    /* not a URL */
  }
  // `code#state` fragment shape Anthropic shows for manual paste.
  const hashIdx = value.indexOf("#");
  if (hashIdx >= 0) {
    const code = value.slice(0, hashIdx);
    const frag = value.slice(hashIdx + 1);
    return { code, state: frag || fallbackState };
  }
  return { code: value, state: fallbackState };
}

/** Map an Anthropic token response → pi OAuthCredentials. Pure. */
export function liftCredentials(data: AnthropicTokenResponse, prevRefresh?: string): OAuthCredentials {
  const uuid = data.account?.uuid;
  const email = data.account?.email_address;
  const creds: OAuthCredentials = {
    access: data.access_token,
    refresh: data.refresh_token || prevRefresh || "",
    // Refresh 5 minutes before the real expiry to avoid mid-request expiry.
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
  if (typeof uuid === "string" && uuid) creds.accountId = uuid;
  if (typeof email === "string" && email) creds.email = email;
  return creds;
}

async function postJson(url: string, body: Record<string, string>): Promise<AnthropicTokenResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Anthropic OAuth request failed (HTTP ${res.status}): ${text}`);
  try {
    return JSON.parse(text) as AnthropicTokenResponse;
  } catch {
    throw new Error(`Anthropic OAuth returned invalid JSON: ${text}`);
  }
}

/** Exchange an authorization code (with PKCE verifier) for credentials. */
export async function exchangeAnthropicCode(
  code: string,
  state: string,
  redirectUri: string,
  verifier: string,
): Promise<OAuthCredentials> {
  const data = await postJson(ANTHROPIC_TOKEN_URL, buildTokenExchangeBody(code, state, redirectUri, verifier));
  return liftCredentials(data);
}

/** Credentials → API key (the Claude OAuth access token used as a bearer). */
export function getAnthropicApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}

/** Refresh expired Anthropic credentials, preserving the prior refresh + identity. */
export async function refreshAnthropicToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const data = await postJson(ANTHROPIC_TOKEN_URL, buildRefreshBody(credentials.refresh));
  const refreshed = liftCredentials(data, credentials.refresh);
  if (!refreshed.accountId && credentials.accountId) refreshed.accountId = credentials.accountId;
  if (!refreshed.email && credentials.email) refreshed.email = credentials.email;
  return refreshed;
}

const randomState = (): string => randomBytes(16).toString("hex");

/**
 * Run the interactive Claude Pro/Max login. Starts a localhost callback server,
 * opens the consent URL via pi's `onAuth`, and exchanges the returned code with
 * the PKCE verifier. Falls back to manual code paste when the callback server
 * cannot bind (or the browser cannot reach this machine).
 */
export async function loginAnthropic(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const redirectUri = `http://localhost:${ANTHROPIC_CALLBACK_PORT}${ANTHROPIC_CALLBACK_PATH}`;
  const state = randomState();
  const pkce = generatePkce();
  const authUrl = buildAuthUrl(redirectUri, state, pkce.challenge);

  const codePromise = new Promise<{ code: string; state: string }>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${ANTHROPIC_CALLBACK_PORT}`);
        if (url.pathname !== ANTHROPIC_CALLBACK_PATH) {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(authErrorHtml("Callback route not found."));
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(authErrorHtml("Claude sign-in did not complete.", `Error: ${error}`));
          server.close();
          reject(new Error(`Anthropic authorization error: ${error}`));
          return;
        }
        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(
            authErrorHtml(
              "Claude sign-in could not be verified.",
              "The callback was missing a code or its state did not match.",
            ),
          );
          server.close();
          reject(new Error("Anthropic callback was missing a code or had a state mismatch."));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(authSuccessHtml("Claude sign-in complete — you can close this tab and return to your terminal."));
        server.close();
        resolve({ code, state: returnedState ?? state });
      } catch (err) {
        server.close();
        reject(err as Error);
      }
    });
    server.on("error", reject);
    server.listen(ANTHROPIC_CALLBACK_PORT, "localhost");
    callbacks.signal?.addEventListener("abort", () => {
      server.close();
      reject(new Error("Claude login aborted."));
    });
  });

  callbacks.onAuth({
    url: authUrl,
    instructions:
      "Approve in your browser. If it cannot reach this machine, paste the final redirect URL or code when prompted.",
  });

  let code: string;
  let exchangeState = state;
  try {
    const result = await codePromise;
    code = result.code;
    exchangeState = result.state;
  } catch (err) {
    // Callback server failed (e.g. port busy / unreachable) — fall back to manual paste.
    if (callbacks.onManualCodeInput) {
      callbacks.onProgress?.(`Automatic callback failed (${(err as Error).message}); paste the code manually.`);
      const pasted = await callbacks.onManualCodeInput();
      const parsed = parseAuthorizationCode(pasted, state);
      code = parsed.code;
      exchangeState = parsed.state;
    } else {
      throw err;
    }
  }

  callbacks.onProgress?.("Exchanging authorization code for Claude tokens…");
  return exchangeAnthropicCode(code, exchangeState, redirectUri, pkce.verifier);
}
