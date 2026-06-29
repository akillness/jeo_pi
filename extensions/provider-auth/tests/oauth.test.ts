import { describe, it, expect } from "vitest";
import {
  ANTIGRAVITY_AUTH_URL,
  ANTIGRAVITY_TOKEN_URL,
  ANTIGRAVITY_SCOPES,
  antigravityClientId,
  antigravityClientSecret,
  buildAuthUrl,
  buildTokenExchangeBody,
  buildRefreshBody,
  getAntigravityApiKey,
} from "../antigravity/oauth.js";

describe("antigravityClientId", () => {
  it("decodes to a Google installed-app client id", () => {
    const id = antigravityClientId();
    expect(id).toMatch(/\.apps\.googleusercontent\.com$/);
    expect(id.startsWith("107100606059")).toBe(true);
  });
});

describe("antigravityClientSecret", () => {
  it("uses the bundled default when no env override is set", () => {
    const secret = antigravityClientSecret({});
    expect(secret.startsWith("GOCSPX-")).toBe(true);
  });

  it("prefers the ANTIGRAVITY_OAUTH_CLIENT_SECRET env override", () => {
    expect(antigravityClientSecret({ ANTIGRAVITY_OAUTH_CLIENT_SECRET: "override-secret" })).toBe("override-secret");
  });
});

describe("buildAuthUrl", () => {
  it("builds a consent URL with offline access and all scopes", () => {
    const url = new URL(buildAuthUrl("http://localhost:51121/oauth-callback", "state123"));
    expect(`${url.origin}${url.pathname}`).toBe(ANTIGRAVITY_AUTH_URL);
    expect(url.searchParams.get("client_id")).toBe(antigravityClientId());
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:51121/oauth-callback");
    expect(url.searchParams.get("state")).toBe("state123");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toBe(ANTIGRAVITY_SCOPES.join(" "));
  });
});

describe("buildTokenExchangeBody", () => {
  it("builds an authorization_code grant body", () => {
    const body = buildTokenExchangeBody("the-code", "http://localhost/cb");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("the-code");
    expect(body.get("redirect_uri")).toBe("http://localhost/cb");
    expect(body.get("client_id")).toBe(antigravityClientId());
    expect(body.get("client_secret")).toBeTruthy();
  });
});

describe("buildRefreshBody", () => {
  it("builds a refresh_token grant body", () => {
    const body = buildRefreshBody("rt-1");
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("rt-1");
    expect(body.get("client_id")).toBe(antigravityClientId());
  });
});

describe("getAntigravityApiKey", () => {
  it("returns the access token as the bearer key", () => {
    expect(getAntigravityApiKey({ access: "at-9", refresh: "rt", expires: 0 })).toBe("at-9");
  });
});

describe("token URL constant", () => {
  it("points at Google's OAuth token endpoint", () => {
    expect(ANTIGRAVITY_TOKEN_URL).toBe("https://oauth2.googleapis.com/token");
  });
});
