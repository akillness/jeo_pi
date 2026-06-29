/**
 * Throwaway manual OAuth ping-pong driver (NOT shipped, NOT imported by index).
 *
 * Uses the REAL oauth.ts + messages.ts (no mocks) so what we verify here is
 * exactly what the provider does at runtime.
 *
 *   bun anthropic/_manual-login.ts url
 *       → prints the real claude.ai authorize URL, persists pkce+state to /tmp
 *
 *   bun anthropic/_manual-login.ts exchange '<code or code#state or redirect URL>'
 *       → exchanges for real tokens, persists creds, then makes a REAL
 *         /v1/messages call and prints Claude's reply (proves it RESPONDS)
 */
import { readFileSync, writeFileSync } from "fs";
import {
  ANTHROPIC_CALLBACK_PATH,
  ANTHROPIC_CALLBACK_PORT,
  buildAuthUrl,
  exchangeAnthropicCode,
  generatePkce,
  parseAuthorizationCode,
} from "./oauth.js";
import { buildAnthropicRequest, isOAuthToken } from "./messages.js";

async function* readSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line.startsWith("data:")) {
        const payload = line.slice(5).trim();
        if (payload && payload !== "[DONE]") yield payload;
      }
    }
  }
}

const PKCE_FILE = "/tmp/anthropic-oauth-pkce.json";
const CREDS_FILE = "/tmp/anthropic-oauth-creds.json";
const REDIRECT_URI = `http://localhost:${ANTHROPIC_CALLBACK_PORT}${ANTHROPIC_CALLBACK_PATH}`;

const randHex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");

async function cmdUrl() {
  const state = randHex(16);
  const pkce = generatePkce();
  writeFileSync(PKCE_FILE, JSON.stringify({ verifier: pkce.verifier, state }), "utf-8");
  const url = buildAuthUrl(REDIRECT_URI, state, pkce.challenge);
  console.log("\n=== Open this URL, approve, then copy the shown code (code#state) ===\n");
  console.log(url);
  console.log("\nThen paste it back so I can run: exchange '<pasted>'\n");
}

async function cmdExchange(pasted: string) {
  const { verifier, state } = JSON.parse(readFileSync(PKCE_FILE, "utf-8"));
  const parsed = parseAuthorizationCode(pasted, state);
  console.log(`Exchanging code (state=${parsed.state.slice(0, 8)}…) …`);
  const creds = await exchangeAnthropicCode(parsed.code, parsed.state, REDIRECT_URI, verifier);
  writeFileSync(CREDS_FILE, JSON.stringify(creds), "utf-8");
  console.log("Token exchange OK:");
  console.log(`  access starts: ${creds.access.slice(0, 14)}…  isOAuth=${isOAuthToken(creds.access)}`);
  console.log(`  accountId=${creds.accountId ?? "(none)"}  email=${creds.email ?? "(none)"}`);
  console.log(`  expires in ~${Math.round((creds.expires - Date.now()) / 60000)} min`);
  await cmdVerify();
}

async function cmdVerify() {
  const creds = JSON.parse(readFileSync(CREDS_FILE, "utf-8"));
  const { url, headers, body } = buildAnthropicRequest({
    model: "claude-sonnet-4-5-20250929",
    accessToken: creds.access,
    oauth: isOAuthToken(creds.access),
    systemPrompt: undefined,
    messages: [{ role: "user", content: "Reply with exactly: PONG", timestamp: Date.now() }],
    maxTokens: 64,
    stream: true,
  });
  console.log(`\nCalling REAL ${url} (oauth=${isOAuthToken(creds.access)}) …`);
  const res = await fetch(url, { method: "POST", headers, body });
  if (!res.ok) {
    console.log(`HTTP ${res.status}: ${await res.text()}`);
    return;
  }
  let text = "";
  for await (const data of readSse(res.body!)) {
    try {
      const evt = JSON.parse(data);
      if (evt.type === "content_block_delta" && evt.delta?.type === "text_delta") text += evt.delta.text;
    } catch {
      /* ignore */
    }
  }
  console.log(`\n=== Claude replied: ${JSON.stringify(text)} ===\n`);
}

const [cmd, arg] = process.argv.slice(2);
const run = cmd === "url" ? cmdUrl() : cmd === "exchange" ? cmdExchange(arg) : cmd === "verify" ? cmdVerify() : null;
if (!run) {
  console.log("usage: bun anthropic/_manual-login.ts <url|exchange '<code>'|verify>");
  process.exit(1);
}
run.catch((e) => {
  console.error(e);
  process.exit(1);
});
