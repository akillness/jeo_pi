/**
 * pi-provider-auth: unified provider authentication & setup for jeo_pi.
 *
 * Borrows jeo-code's provider-login approach so jeo_pi can authenticate and use
 * Claude, Google Antigravity, and API providers (Ollama, LM Studio, and any
 * other OpenAI-compatible endpoint):
 *   - Claude:       pi's built-in /login (Anthropic OAuth) or ANTHROPIC_API_KEY.
 *   - Antigravity:  Google Cloud Code Assist OAuth + a custom CCA stream handler.
 *   - Other APIs:   models.json custom providers, configured via /provider.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getAgentDir } from "@mariozechner/pi-coding-agent";
import { modelsJsonPath } from "./models-config.js";
import {
  applyToConfig,
  parseProviderCommand,
  readModelsConfig,
  statusReport,
  toRuntimeModel,
  writeModelsConfig,
} from "./command.js";
import { registerAntigravityProvider } from "./antigravity/register.js";

export default function providerAuthExtension(pi: ExtensionAPI): void {
  // Make Antigravity loginable immediately (so `/login antigravity` works).
  registerAntigravityProvider(pi);

  pi.registerCommand("provider", {
    description: "Authenticate / configure providers: claude, antigravity, ollama, lmstudio, api",
    handler: async (args, ctx) => {
      const action = parseProviderCommand(args);

      if (action.kind === "error") {
        ctx.ui.notify(action.message, "error");
        return;
      }

      if (action.kind === "status") {
        ctx.ui.notify(statusReport(readModelsConfig(modelsJsonPath(getAgentDir()))), "info");
        return;
      }

      if (action.kind === "claude") {
        ctx.ui.notify(
          "Claude is built in. Run /login and choose Anthropic (Claude Pro/Max OAuth), or set ANTHROPIC_API_KEY. Then pick a model with /model.",
          "info",
        );
        return;
      }

      if (action.kind === "antigravity") {
        registerAntigravityProvider(pi);
        ctx.ui.notify(
          "Antigravity registered. Run /login and choose Google Antigravity to authenticate, then pick antigravity/* with /model.",
          "info",
        );
        return;
      }

      const path = modelsJsonPath(getAgentDir());
      let config;
      try {
        config = readModelsConfig(path);
      } catch (err) {
        ctx.ui.notify((err as Error).message, "error");
        return;
      }

      if (action.kind === "remove") {
        if (!config.providers?.[action.name]) {
          ctx.ui.notify(`No custom provider named '${action.name}' in models.json.`, "warning");
          return;
        }
        writeModelsConfig(path, applyToConfig(config, action));
        pi.unregisterProvider(action.name);
        ctx.ui.notify(`Removed provider '${action.name}' from models.json.`, "info");
        return;
      }

      // configure
      const { name, provider } = action;
      writeModelsConfig(path, applyToConfig(config, action));

      // Register at runtime so the provider is usable without a restart.
      if (provider.models.length > 0) {
        pi.registerProvider(name, {
          name: provider.name ?? name,
          baseUrl: provider.baseUrl,
          api: provider.api,
          apiKey: provider.apiKey,
          headers: provider.headers,
          models: provider.models.map((m) => toRuntimeModel(provider, m)),
        });
        ctx.ui.notify(
          `Configured '${name}' → ${provider.baseUrl}. Models: ${provider.models.map((m) => m.id).join(", ")}. Select with /model.`,
          "info",
        );
      } else {
        ctx.ui.notify(
          `Saved '${name}' → ${provider.baseUrl} to models.json. Add models with /provider ${name} <baseUrl> <modelId>, then restart or re-run to load them.`,
          "info",
        );
      }
    },
  });
}
