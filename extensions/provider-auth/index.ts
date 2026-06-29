/**
 * pi-provider-auth: unified provider authentication for jeo_pi, routed entirely
 * through pi's built-in `/login`.
 *
 * Borrows jeo-code's provider-login approach so jeo_pi authenticates and uses
 * Claude, Google Antigravity, and API providers without a bespoke command:
 *   - Claude:      registered here with jeo-code's Anthropic OAuth flow + Claude
 *                  Code streaming so /login → "Use a subscription" → Claude
 *                  Pro/Max responds (or "Use an API key" for ANTHROPIC_API_KEY).
 *   - Antigravity: registered here with a Google Cloud Code Assist OAuth block so
 *                  it appears under /login → "Use a subscription" → Google Antigravity.
 *   - Other APIs:  any OpenAI-compatible endpoint in ~/.pi/agent/models.json is
 *                  loaded at startup so it is selectable via /login → "Use an API key"
 *                  and /model.
 *
 * There is intentionally no `/provider` command — everything funnels through the
 * native /login subscription/API-key selectors, mirroring jeo-code's login UX.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { registerAnthropicProvider } from "./anthropic/register.js";
import { registerAntigravityProvider } from "./antigravity/register.js";
import { loadCustomProvidersFromConfig } from "./loader.js";

export default function providerAuthExtension(pi: ExtensionAPI): void {
  // Override Claude (Anthropic) OAuth + streaming with jeo-code's proven flow so
  // the Pro/Max subscription actually responds under /login → "Use a subscription".
  registerAnthropicProvider(pi);

  // Register Antigravity so it appears under /login → "Use a subscription"
  // (alongside the Claude provider above).
  registerAntigravityProvider(pi);

  // Load any models.json custom providers so they surface under
  // /login → "Use an API key" and /model, without a bespoke command. A
  // malformed models.json is logged (not thrown) so it never blocks /login.
  loadCustomProvidersFromConfig(pi, getAgentDir(), (message) => {
    console.error(`[pi-provider-auth] ${message}`);
  });
}
