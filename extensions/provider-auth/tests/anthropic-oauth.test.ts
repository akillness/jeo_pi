import { createHash } from "crypto";
import { describe, it, expect } from "vitest";
import {
  ANTHROPIC_AUTHORIZE_URL,
  ANTHROPIC_TOKEN_URL,
  ANTHROPIC_SCOPES,
  anthropicClientId,
  buildAuthUrl,
  buildTokenExchangeBody,
  buildRefreshBody,
  generatePkce,
  getAnthropicApiKey,
  liftCredentials,
  parseAuthorizationCode,
} from "../anthropic/oauth.js";

describe("anthropicClientId", () => {
  it("decodes to Anthropic's public Claude Code OAuth client id", () => {
    expect(anthropicClientId()).toBe("9d1c250a-e61b-44d9-88ed-5944d1962f5e");
  });
});

describe("endpoint constants (jeo-code parity)", () => {
  it("uses claude.ai for authorize and api.anthropic.com for token", () => {
    expect(ANTHROPIC_AUTHORIZE_URL).toBe("https://claude.ai/oauth/authorize");
    expect(ANTHROPIC_TOKEN_URL).toBe("https://api.anthropic.com/v1/oauth/token");
  });
});

describe("generatePkce", () => {
  it("derives an S256 challenge that verifies against the verifier", () => {
    const { verifier, challenge } = generatePkce();
    // base64url, no padding, sufficiently long.
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    const expected = createHash("sha256")
      .update(verifier)
      .digest("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(challenge).toBe(expected);
  });

  it("returns a fresh verifier each call", () => {
    expect(generatePkce().verifier).not.toBe(generatePkce().verifier);
  });
});

describe("buildAuthUrl", () => {
  it("builds a PKCE consent URL with code=true and the S256 challenge", () => {
    const url = new URL(buildAuthUrl("http://localhost:54545/callback", "state-xyz", "the-challenge"));
    expect(`${url.origin}${url.pathname}`).toBe(ANTHROPIC_AUTHORIZE_URL);
    expect(url.searchParams.get("client_id")).toBe(anthropicClientId());
    expect(url.searchParams.get("code")).toBe("true");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:54545/callback");
    expect(url.searchParams.get("scope")).toBe(ANTHROPIC_SCOPES);
    expect(url.searchParams.get("code_challenge")).toBe("the-challenge");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("state-xyz");
  });
});

describe("buildTokenExchangeBody", () => {
  it("builds an authorization_code grant body carrying the PKCE verifier", () => {
    const body = buildTokenExchangeBody("the-code", "the-state", "http://localhost/cb", "verifier-1");
    expect(body.grant_type).toBe("authorization_code");
    expect(body.code).toBe("the-code");
    expect(body.state).toBe("the-state");
    expect(body.redirect_uri).toBe("http://localhost/cb");
    expect(body.code_verifier).toBe("verifier-1");
    expect(body.client_id).toBe(anthropicClientId());
  });
});

describe("buildRefreshBody", () => {
  it("builds a refresh_token grant body", () => {
    const body = buildRefreshBody("rt-1");
    expect(body.grant_type).toBe("refresh_token");
    expect(body.refresh_token).toBe("rt-1");
    expect(body.client_id).toBe(anthropicClientId());
  });
});

describe("parseAuthorizationCode", () => {
  it("reads code + state from a full redirect URL", () => {
    const r = parseAuthorizationCode("http://localhost:54545/callback?code=abc&state=def", "fallback");
    expect(r).toEqual({ code: "abc", state: "def" });
  });

  it("splits a `code#state` manual-paste fragment", () => {
    expect(parseAuthorizationCode("abc#def", "fallback")).toEqual({ code: "abc", state: "def" });
  });

  it("treats a bare code as the code with the fallback state", () => {
    expect(parseAuthorizationCode("just-a-code", "fallback")).toEqual({ code: "just-a-code", state: "fallback" });
  });

  it("falls back to the provided state when a URL omits state", () => {
    const r = parseAuthorizationCode("http://localhost/callback?code=abc", "fallback");
    expect(r).toEqual({ code: "abc", state: "fallback" });
  });
});

describe("liftCredentials", () => {
  it("maps a token response, refreshing 5 minutes early and capturing identity", () => {
    const now = Date.now();
    const creds = liftCredentials({
      access_token: "sk-ant-oat01-xyz",
      refresh_token: "rt-new",
      expires_in: 3600,
      account: { uuid: "acc-1", email_address: "u@example.com" },
    });
    expect(creds.access).toBe("sk-ant-oat01-xyz");
    expect(creds.refresh).toBe("rt-new");
    expect(creds.accountId).toBe("acc-1");
    expect(creds.email).toBe("u@example.com");
    // 3600s minus the 5-minute safety margin.
    expect(creds.expires).toBeGreaterThanOrEqual(now + (3600 - 300) * 1000 - 50);
    expect(creds.expires).toBeLessThanOrEqual(now + (3600 - 300) * 1000 + 1000);
  });

  it("preserves the previous refresh token when the response omits one", () => {
    const creds = liftCredentials({ access_token: "a", refresh_token: "", expires_in: 60 }, "rt-old");
    expect(creds.refresh).toBe("rt-old");
    expect(creds.accountId).toBeUndefined();
  });
});

describe("getAnthropicApiKey", () => {
  it("returns the access token as the bearer key", () => {
    expect(getAnthropicApiKey({ access: "sk-ant-oat01-9", refresh: "rt", expires: 0 })).toBe("sk-ant-oat01-9");
  });
});
