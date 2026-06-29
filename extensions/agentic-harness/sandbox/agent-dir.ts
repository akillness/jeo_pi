import { homedir } from "os";
import { join } from "path";

function toPortablePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function expandHomePath(path: string, homeDir: string): string {
  if (path === "~") return toPortablePath(homeDir);
  if (path.startsWith("~/")) return toPortablePath(join(homeDir, path.slice(2)));
  return toPortablePath(path);
}

export function resolvePiAgentDir(
  envDir = process.env.PI_CODING_AGENT_DIR,
  homeDir = homedir(),
): string {
  if (!envDir) return toPortablePath(join(homeDir, ".pi", "agent"));
  return expandHomePath(envDir, homeDir);
}

export function resolvePiSessionDir(
  envDir = process.env.PI_CODING_AGENT_SESSION_DIR,
  homeDir = homedir(),
): string | undefined {
  if (!envDir) return undefined;
  return expandHomePath(envDir, homeDir);
}
