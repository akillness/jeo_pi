/**
 * Integration coverage for the `/login` subscription surface.
 *
 * pi's interactive `/login` → "Use a subscription" selector is built from
 * `authStorage.getOAuthProviders()` (see pi-coding-agent
 * `interactive-mode.js#getLoginProviderOptions("oauth")`), which returns the
 * global pi-ai OAuth registry. A provider lands in that registry when the model
 * registry applies a provider config carrying an `oauth` block — it calls
 * `registerOAuthProvider({ ...config.oauth, id: providerName })`
 * (pi-coding-agent `model-registry.js#applyProviderConfig`).
 *
 * These tests assert that the two providers the user wants as OAuth
 * subscriptions — Claude (anthropic, built in) and Antigravity (registered by
 * this extension) — both end up in that exact registry, i.e. both will appear
 * under `/login` → "Use a subscription".
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  getOAuthProviders,
  registerOAuthProvider,
  resetOAuthProviders,
} from "@mariozechner/pi-ai/oauth";
import { registerAntigravityProvider, ANTIGRAVITY_PROVIDER } from "../antigravity/register.js";

/** Capture the provider config the extension hands to `pi.registerProvider`. */
function captureAntigravityConfig(): any {
  let captured: any;
  const pi = {
    registerProvider: (name: string, config: any) => {
      if (name === ANTIGRAVITY_PROVIDER) captured = config;
    },
    unregisterProvider: () => {},
    registerCommand: () => {},
  } as any;
  registerAntigravityProvider(pi);
  return captured;
}

/**
 * Mirror pi's `model-registry.js#applyProviderConfig` OAuth-registration step:
 * when a registered provider carries an `oauth` block, the registry pushes it
 * into the global pi-ai OAuth registry keyed by the provider name.
 */
function applyOAuthLikeModelRegistry(providerName: string, config: any): void {
  if (config.oauth) {
    registerOAuthProvider({ ...config.oauth, id: providerName });
  }
}

describe("/login subscription registry (OAuth)", () => {
  beforeEach(() => {
    // Each test starts from pi's built-in OAuth providers only.
    resetOAuthProviders();
  });

  it("exposes Claude as a built-in OAuth subscription provider", () => {
    const anthropic = getOAuthProviders().find((p) => p.id === "anthropic");
    expect(anthropic).toBeTruthy();
    // Claude Pro/Max == the subscription the user asked to log in with.
    expect(anthropic!.name).toMatch(/Claude Pro\/Max/);
  });

  it("places Antigravity into the same OAuth subscription registry as Claude", () => {
    const ids = () => new Set(getOAuthProviders().map((p) => p.id));

    // Before our extension applies its config, antigravity is absent.
    expect(ids().has(ANTIGRAVITY_PROVIDER)).toBe(false);

    const config = captureAntigravityConfig();
    expect(config?.oauth).toBeTruthy();
    applyOAuthLikeModelRegistry(ANTIGRAVITY_PROVIDER, config);

    // Now /login → "Use a subscription" lists BOTH claude and antigravity.
    const subscriptionIds = ids();
    expect(subscriptionIds.has("anthropic")).toBe(true);
    expect(subscriptionIds.has(ANTIGRAVITY_PROVIDER)).toBe(true);
  });

  it("registers Antigravity with the full OAuth login contract /login drives", () => {
    const config = captureAntigravityConfig();
    applyOAuthLikeModelRegistry(ANTIGRAVITY_PROVIDER, config);

    const antigravity = getOAuthProviders().find((p) => p.id === ANTIGRAVITY_PROVIDER);
    expect(antigravity).toBeTruthy();
    expect(typeof antigravity!.name).toBe("string");
    expect(antigravity!.name.length).toBeGreaterThan(0);
    // The selector's "log in" action needs a callable login flow; refresh +
    // getApiKey keep the credential usable across requests.
    expect(typeof (antigravity as any).login).toBe("function");
    expect(typeof (antigravity as any).refreshToken).toBe("function");
    expect(typeof (antigravity as any).getApiKey).toBe("function");
  });
});
