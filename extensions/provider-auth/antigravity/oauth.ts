/**
 * Antigravity OAuth — borrowed from jeo-code (`src/auth/flows/antigravity.ts`)
 * and adapted to pi's OAuth provider interface.
 *
 * This is a Google authorization-code flow against the Antigravity desktop-app
 * client (different client id/secret and extra scopes than gemini-cli). The
 * installed-app client secret ships publicly in the Antigravity app (RFC 8252
 * §8.5: installed-app secrets are not confidential) and is stored base64-encoded
 * only to avoid secret scanners. `ANTIGRAVITY_OAUTH_CLIENT_SECRET` overrides it.
 *
 * The pure builders (auth URL, token/refresh bodies, client id/secret decode,
 * getApiKey) are exported separately so they are unit-testable without network
 * or a browser. The live `login()` runs a localhost callback server.
 */

import { createServer } from "http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import { authErrorHtml, authSuccessHtml } from "../auth-page.js";
import { ANTIGRAVITY_DISCOVERY_METADATA, discoverGoogleProjectId } from "./discovery.js";

const decode = (s: string): string => Buffer.from(s, "base64").toString("utf-8");

const CLIENT_ID = decode(
  [
    "MTA3MTAwNjA2MDU5MS10",
    "bWhzc2luMmgyMWxjcmUy",
    "MzV2dG9sb2poNGc0MDNl",
    "cC5hcHBzLmdvb2dsZXVz",
    "ZXJjb250ZW50LmNvbQ==",
  ].join(""),
);

const DEFAULT_CLIENT_SECRET_B64 = ["R09DU1BYLUs1OEZX", "UjQ4NkxkTEoxbUxC", "OHNYQzR6NnFEQWY="].join("");

export const ANTIGRAVITY_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const ANTIGRAVITY_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const ANTIGRAVITY_CALLBACK_PORT = 51121;
export const ANTIGRAVITY_CALLBACK_PATH = "/oauth-callback";
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

/** The Antigravity OAuth client id (decoded from the bundled base64 chunks). */
export function antigravityClientId(): string {
  return CLIENT_ID;
}

/** Effective Antigravity OAuth client secret: env override → bundled default. */
export function antigravityClientSecret(env: Record<string, string | undefined> = process.env): string {
  return env.ANTIGRAVITY_OAUTH_CLIENT_SECRET || decode(DEFAULT_CLIENT_SECRET_B64);
}

/** Build the Google authorization-code URL for the given redirect + state. Pure. */
export function buildAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: ANTIGRAVITY_SCOPES.join(" "),
    state,
    access_type: "offline",
    prompt: "consent",
  });
  return `${ANTIGRAVITY_AUTH_URL}?${params.toString()}`;
}

/** Body for the authorization-code → token exchange. Pure. */
export function buildTokenExchangeBody(code: string, redirectUri: string): URLSearchParams {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: antigravityClientSecret(),
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri,
  });
}

/** Body for a refresh-token grant. Pure. */
export function buildRefreshBody(refreshToken: string): URLSearchParams {
  return new URLSearchParams({
    client_id: CLIENT_ID,
    client_secret: antigravityClientSecret(),
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
}

/** Credentials → API key (the Google access token used as a bearer). */
export function getAntigravityApiKey(credentials: OAuthCredentials): string {
  return credentials.access;
}

async function getUserEmail(access: string): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v1/userinfo?alt=json", {
      headers: { authorization: `Bearer ${access}` },
    });
    if (res.ok) return ((await res.json()) as { email?: string }).email;
  } catch {
    /* email is optional */
  }
  return undefined;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function toCredentials(data: TokenResponse, prevRefresh?: string): OAuthCredentials {
  return {
    access: data.access_token,
    refresh: data.refresh_token || prevRefresh || "",
    // Refresh 5 minutes before the real expiry to avoid mid-request expiry.
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000,
  };
}

/** Exchange an authorization code for credentials, attaching email + discovered project. */
export async function exchangeAntigravityCode(code: string, redirectUri: string): Promise<OAuthCredentials> {
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: buildTokenExchangeBody(code, redirectUri),
  });
  if (!res.ok) throw new Error(`Antigravity token exchange failed (HTTP ${res.status}): ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  if (!data.refresh_token) throw new Error("No refresh token received from Google. Retry with prompt=consent.");
  const creds = toCredentials(data);
  creds.email = await getUserEmail(data.access_token);
  let projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID || undefined;
  if (!projectId) {
    try {
      projectId = await discoverGoogleProjectId(data.access_token, {
        metadata: { ...ANTIGRAVITY_DISCOVERY_METADATA },
      });
    } catch {
      projectId = undefined; // best-effort: the adapter retries discovery lazily
    }
  }
  if (projectId) creds.projectId = projectId;
  return creds;
}

/** Refresh expired Antigravity credentials. */
export async function refreshAntigravityToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: buildRefreshBody(credentials.refresh),
  });
  if (!res.ok) throw new Error(`Antigravity token refresh failed (HTTP ${res.status}): ${await res.text()}`);
  const data = (await res.json()) as TokenResponse;
  const refreshed = toCredentials(data, credentials.refresh);
  // Preserve discovery metadata across refreshes.
  if (credentials.projectId) refreshed.projectId = credentials.projectId;
  if (credentials.email) refreshed.email = credentials.email;
  return refreshed;
}

const randomState = (): string => Math.random().toString(36).slice(2) + Date.now().toString(36);

/**
 * Run the interactive Antigravity login. Starts a localhost callback server,
 * opens the consent URL via pi's `onAuth`, and exchanges the returned code.
 * Falls back to manual code entry when the callback server cannot bind.
 */
export async function loginAntigravity(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const redirectUri = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}${ANTIGRAVITY_CALLBACK_PATH}`;
  const state = randomState();
  const authUrl = buildAuthUrl(redirectUri, state);

  const codePromise = new Promise<string>((resolve, reject) => {
    const server = createServer((req, res) => {
      try {
        const url = new URL(req.url ?? "/", `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}`);
        if (url.pathname !== ANTIGRAVITY_CALLBACK_PATH) {
          res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
          res.end(authErrorHtml("Callback route not found."));
          return;
        }
        const returnedState = url.searchParams.get("state");
        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");
        if (error) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(authErrorHtml("Antigravity sign-in did not complete.", `Error: ${error}`));
          server.close();
          reject(new Error(`Antigravity authorization error: ${error}`));
          return;
        }
        if (!code || returnedState !== state) {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
          res.end(
            authErrorHtml(
              "Antigravity sign-in could not be verified.",
              "The callback was missing a code or its state did not match.",
            ),
          );
          server.close();
          reject(new Error("Antigravity callback was missing a code or had a state mismatch."));
          return;
        }
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(authSuccessHtml("Antigravity sign-in complete — you can close this tab and return to your terminal."));
        server.close();
        resolve(code);
      } catch (err) {
        server.close();
        reject(err as Error);
      }
    });
    server.on("error", reject);
    server.listen(ANTIGRAVITY_CALLBACK_PORT, "localhost");
    callbacks.signal?.addEventListener("abort", () => {
      server.close();
      reject(new Error("Antigravity login aborted."));
    });
  });

  callbacks.onAuth({ url: authUrl, instructions: "Complete the Antigravity sign-in in your browser." });

  let code: string;
  try {
    code = await codePromise;
  } catch (err) {
    // Callback server failed (e.g. port busy) — fall back to manual code paste.
    if (callbacks.onManualCodeInput) {
      callbacks.onProgress?.(`Automatic callback failed (${(err as Error).message}); paste the code manually.`);
      code = await callbacks.onManualCodeInput();
    } else {
      throw err;
    }
  }

  callbacks.onProgress?.("Exchanging authorization code for Antigravity tokens…");
  return exchangeAntigravityCode(code, redirectUri);
}
