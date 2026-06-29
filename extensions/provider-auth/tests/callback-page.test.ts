/**
 * Real-behaviour coverage for the Antigravity OAuth callback server.
 *
 * Instead of asserting strings in isolation, these tests start the *actual*
 * localhost callback server `loginAntigravity` binds, drive a browser-style GET
 * against the redirect URI, and read the HTML the server returns — proving the
 * post-auth page really is pi's auth-browser page (success and failure), and
 * that a valid callback drives the login to completion.
 *
 * The Google token/userinfo/discovery network calls are stubbed via a fetch
 * mock so the flow completes deterministically without real credentials.
 */

import { afterEach, describe, it, expect, vi } from "vitest";
import { get as httpGet } from "http";
import type { OAuthLoginCallbacks } from "@mariozechner/pi-ai";
import {
  ANTIGRAVITY_CALLBACK_PATH,
  ANTIGRAVITY_CALLBACK_PORT,
  ANTIGRAVITY_TOKEN_URL,
  loginAntigravity,
} from "../antigravity/oauth.js";

const BASE = `http://localhost:${ANTIGRAVITY_CALLBACK_PORT}`;

/** GET a callback URL, retrying briefly while the server finishes binding. */
function fetchPage(path: string, attempt = 0): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    // agent:false + Connection:close so the socket is not kept alive — otherwise
    // server.close() blocks on the lingering connection and the next test's
    // listen() on the fixed callback port hits EADDRINUSE.
    const req = httpGet(`${BASE}${path}`, { agent: false, headers: { connection: "close" } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c as Buffer));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf-8") }));
    });
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ECONNREFUSED" && attempt < 50) {
        setTimeout(() => fetchPage(path, attempt + 1).then(resolve, reject), 20);
      } else {
        reject(err);
      }
    });
  });
}

/** Build login callbacks that capture the auth URL pi would open in the browser. */
function makeCallbacks(): { callbacks: OAuthLoginCallbacks; getState: () => string | null } {
  const captured: { url?: string } = {};
  const callbacks: OAuthLoginCallbacks = {
    onAuth: ({ url }) => {
      captured.url = url;
    },
    onProgress: () => {},
  };
  return {
    callbacks,
    getState: () => (captured.url ? new URL(captured.url).searchParams.get("state") : null),
  };
}

async function waitForState(getState: () => string | null): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const s = getState();
    if (s) return s;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("auth URL (state) was never produced");
}

function stubGoogleFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url === ANTIGRAVITY_TOKEN_URL) {
        return new Response(JSON.stringify({ access_token: "at-test", refresh_token: "rt-test", expires_in: 3600 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // userinfo + project discovery are best-effort; fail them so the flow
      // still completes without depending on real Google responses.
      return new Response("{}", { status: 500 });
    }),
  );
}

describe("Antigravity OAuth callback server (pi auth browser)", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    // The login flow binds a fixed callback port (Google's redirect URI is
    // static), so let the closed server fully release it before the next test
    // re-binds the same port.
    await new Promise((r) => setTimeout(r, 200));
  });

  it("serves pi's auth-browser SUCCESS page and completes login on a valid callback", async () => {
    stubGoogleFetch();
    const { callbacks, getState } = makeCallbacks();
    const loginPromise = loginAntigravity(callbacks);

    const state = await waitForState(getState);
    const res = await fetchPage(`${ANTIGRAVITY_CALLBACK_PATH}?code=auth-code-123&state=${state}`);

    expect(res.status).toBe(200);
    expect(res.body).toContain("<h1>Authentication successful</h1>");
    expect(res.body).toContain('viewBox="0 0 800 800"'); // pi logo == native pi page

    const creds = await loginPromise;
    expect(creds.access).toBe("at-test");
    expect(creds.refresh).toBe("rt-test");
  });

  it("serves pi's auth-browser ERROR page and rejects when the provider returns an error", async () => {
    stubGoogleFetch();
    const { callbacks, getState } = makeCallbacks();
    const loginPromise = loginAntigravity(callbacks);
    const rejection = expect(loginPromise).rejects.toThrow(/authorization error: access_denied/);

    const state = await waitForState(getState);
    const res = await fetchPage(`${ANTIGRAVITY_CALLBACK_PATH}?error=access_denied&state=${state}`);

    expect(res.status).toBe(400);
    expect(res.body).toContain("<h1>Authentication failed</h1>");
    expect(res.body).toContain("Error: access_denied");

    await rejection;
  });

  it("serves pi's auth-browser ERROR page and rejects on a state mismatch", async () => {
    stubGoogleFetch();
    const { callbacks, getState } = makeCallbacks();
    const loginPromise = loginAntigravity(callbacks);
    const rejection = expect(loginPromise).rejects.toThrow(/state mismatch/);

    await waitForState(getState);
    const res = await fetchPage(`${ANTIGRAVITY_CALLBACK_PATH}?code=abc&state=not-the-real-state`);

    expect(res.status).toBe(400);
    expect(res.body).toContain("<h1>Authentication failed</h1>");

    await rejection;
  });
});
