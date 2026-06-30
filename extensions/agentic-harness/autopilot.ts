/**
 * autopilot.ts — autonomous build loop hardened with autoresearch ratcheting.
 *
 * Ported and adapted from jeo-code's `src/autopilot.ts` into jeo-pi's extension
 * runtime. The engine owns the RATCHET BRAIN — a frozen evaluator, one change per
 * step, keep-if-improved / revert-otherwise by score, an append-only evidence
 * ledger, baseline-first discipline, and convergence/patience stops. Mutation
 * ("make one change") is supplied by the agent/operator between steps; this module
 * never performs destructive git ops.
 *
 * Adaptations vs jeo-code:
 *  - State root is an explicit `cwd` argument (not `process.cwd()`), so the engine
 *    is fully unit-testable without changing directories.
 *  - The frozen evaluator runs behind an injectable `runEval` seam, so every pure
 *    decision function is exercised without spawning a process.
 *  - Atomic writes (`*.tmp → rename`) for `session.json`, matching jeo-pi's memory
 *    bundle convention.
 *  - Returns rendered text lines instead of writing to stdout, so the jeo-pi
 *    `/autopilot` command can surface them through the harness UI.
 *
 * State (per cwd):
 *   .jeo/autopilot/session.json   frozen contract (immutable for the session)
 *   .jeo/autopilot/log.jsonl      append-only attempt log (baseline, steps, stops)
 *
 * No external dependencies (Node stdlib only).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, appendFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export type Goal = "min" | "max" | "gate";

export const GOALS: readonly Goal[] = ["min", "max", "gate"];

export function isGoal(value: string): value is Goal {
  return (GOALS as readonly string[]).includes(value);
}

export interface AutopilotSession {
  task: string;
  evalCmd: string;
  goal: Goal;
  timeoutSec: number;
  patience: number;
  createdAt: string;
  frozen: true;
}

export type LogEventType = "baseline" | "step" | "stop";

export interface LogEvent {
  ts: string;
  type: LogEventType;
  [k: string]: unknown;
}

export interface EvalResult {
  score: number;
  passed: boolean;
  output: string;
}

// ── pure ratchet brain (runtime-agnostic, unit-tested) ───────────────────────

/**
 * Extract the score an evaluator advertises via a `score: <number>` line. The
 * LAST occurrence wins (a runner may print intermediate scores), mirroring
 * jeo-code. Returns NaN when no score line is present — a non-measurable run.
 */
export function parseScore(output: string): number {
  const matches = [...output.matchAll(/score:\s*(-?\d+(?:\.\d+)?)/gi)];
  return matches.length ? Number(matches[matches.length - 1][1]) : NaN;
}

export function isImprovement(goal: Goal, score: number, best: number | undefined): boolean {
  if (best === undefined) return true;
  if (goal === "min") return score < best;
  if (goal === "max") return score > best;
  return true; // gate handled via passed, not score
}

/**
 * Fold one KEPT step's score into the running best, mirroring the log re-scan so
 * an in-memory best never diverges from a fresh re-scan. NaN scores never become
 * the best; the gate goal tracks the last value.
 */
export function foldBest(goal: Goal, best: number | undefined, score: number): number | undefined {
  if (Number.isNaN(score)) return best;
  if (best === undefined) return score;
  if (goal === "min") return Math.min(best, score);
  if (goal === "max") return Math.max(best, score);
  return score;
}

/** Best kept score so far, folding baseline + kept steps. undefined if none. */
export function bestScoreFromLog(
  goal: Goal,
  log: Iterable<{ type: unknown; decision?: unknown; score?: unknown }>,
): number | undefined {
  let best: number | undefined;
  for (const ev of log) {
    if (ev.type === "baseline" || (ev.type === "step" && ev.decision === "keep")) {
      const sc = ev.score;
      if (typeof sc === "number" && !Number.isNaN(sc)) {
        best = foldBest(goal, best, sc);
      }
    }
  }
  return best;
}

/**
 * Single source of truth for the ratchet keep/revert decision. Shared by step and
 * status so they can never diverge.
 *  - gate goal: keep iff the eval passed (score is irrelevant).
 *  - min/max goal: a non-measurable (NaN) score can never prove improvement, so it
 *    is always reverted; otherwise keep iff it improves on the best so far.
 */
export function decideStep(
  goal: Goal,
  score: number,
  passed: boolean,
  best: number | undefined,
): "keep" | "revert" {
  if (goal === "gate") return passed ? "keep" : "revert";
  if (Number.isNaN(score)) return "revert";
  return isImprovement(goal, score, best) ? "keep" : "revert";
}

/**
 * Convergence is a streak of consecutive no-progress steps (reverts) reaching
 * patience — for every goal, gate included. A gate loop that keeps failing has
 * made no forward progress and must stop early instead of burning the budget.
 */
export function isConverged(sinceImprove: number, patience: number): boolean {
  return sinceImprove >= patience;
}

/** Steps-since-last-keep streak over an ordered step log. */
export function sinceImproveFromSteps(steps: Iterable<{ decision?: unknown; [k: string]: unknown }>): number {
  let sinceImprove = 0;
  for (const e of steps) {
    if (e.decision === "keep") sinceImprove = 0;
    else sinceImprove++;
  }
  return sinceImprove;
}

// ── state persistence (per cwd) ──────────────────────────────────────────────

function apDir(cwd: string): string {
  return join(cwd, ".jeo", "autopilot");
}
function sessionPath(cwd: string): string {
  return join(apDir(cwd), "session.json");
}
function logPath(cwd: string): string {
  return join(apDir(cwd), "log.jsonl");
}

/** Atomic write: write to `<path>.tmp` then rename over the target. */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function sessionExists(cwd: string): boolean {
  return existsSync(sessionPath(cwd));
}

export function loadSession(cwd: string): AutopilotSession | null {
  const p = sessionPath(cwd);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as AutopilotSession;
  } catch {
    return null;
  }
}

export function freezeSession(cwd: string, session: AutopilotSession): void {
  mkdirSync(apDir(cwd), { recursive: true });
  atomicWrite(sessionPath(cwd), JSON.stringify(session, null, 2) + "\n");
  // fresh log on (re)init
  writeFileSync(logPath(cwd), "", "utf8");
}

export function appendLog(cwd: string, ev: { type: LogEventType; [k: string]: unknown }): LogEvent {
  mkdirSync(apDir(cwd), { recursive: true });
  const full: LogEvent = { ts: new Date().toISOString(), ...ev };
  appendFileSync(logPath(cwd), JSON.stringify(full) + "\n", "utf8");
  return full;
}

export function readLog(cwd: string): LogEvent[] {
  const p = logPath(cwd);
  if (!existsSync(p)) return [];
  return readFileSync(p, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l) as LogEvent;
      } catch {
        return null;
      }
    })
    .filter((e): e is LogEvent => e !== null);
}

export function hasBaseline(cwd: string): boolean {
  return readLog(cwd).some((e) => e.type === "baseline");
}

export function currentBest(cwd: string, goal: Goal): number | undefined {
  return bestScoreFromLog(goal, readLog(cwd));
}

// ── frozen evaluator (isolated process boundary) ─────────────────────────────

/** Run the frozen eval command. Score is NaN when there is no `score:` line. */
export function runEvalCommand(session: AutopilotSession, cwd: string): EvalResult {
  let output = "";
  let passed = true;
  try {
    output = execSync(session.evalCmd, {
      cwd,
      encoding: "utf8",
      timeout: session.timeoutSec * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32" ? undefined : process.env.SHELL || "/bin/bash",
    });
  } catch (e: unknown) {
    passed = false;
    const err = e as { stdout?: string; stderr?: string };
    output = (err.stdout ?? "") + (err.stderr ?? "");
  }
  return { score: parseScore(output), passed, output: output.trim() };
}

// ── command orchestration ────────────────────────────────────────────────────

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = "true";
      else {
        flags[key] = next;
        i++;
      }
    } else positionals.push(a);
  }
  return { positionals, flags };
}

/** Shell-ish tokenizer that honours single/double quotes for flag values. */
export function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push(m[1] ?? m[2] ?? m[3] ?? "");
  }
  return tokens;
}

function parsePositiveInt(flags: Record<string, string>, name: string, fallback: number): number | { error: string } {
  const raw = flags[name];
  if (raw === undefined || raw === "true") return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) return { error: `--${name} must be a positive integer` };
  return parsed;
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return String(n);
}

export const AUTOPILOT_HELP = [
  "Autopilot — autonomous build loop with autoresearch ratcheting",
  "",
  "Borrows jeo-code's ratchet brain: a frozen evaluator, one change per step,",
  "keep-if-improved / revert-otherwise by score, and convergence stops. You (the",
  "agent) make exactly one change between steps; autopilot decides keep vs revert.",
  "",
  "  /autopilot init <task...> --eval <cmd> [--goal min|max|gate] [--timeout S] [--patience N]",
  "  /autopilot baseline                    Record the starting score (min/max goals)",
  "  /autopilot step --change <desc>        Re-run the eval and ratchet keep/revert",
  "  /autopilot status [--json]             Show the evidence ledger",
  "  /autopilot clear --confirm             Discard the frozen session + ledger",
  "  /autopilot help                        Show this help",
  "",
  "eval contract: the command prints 'score: <number>' (min/max goals) or exits 0/1 (gate goal).",
].join("\n");

export interface AutopilotCommandResult {
  ok: boolean;
  lines: string[];
}

export interface AutopilotCommandOptions {
  cwd: string;
  /** Injectable eval seam (defaults to the process-spawning runEvalCommand). */
  runEval?: (session: AutopilotSession, cwd: string) => EvalResult;
  /** Injectable revert hook runner for the `--on-revert` flag. */
  runOnRevert?: (cmd: string, cwd: string) => void;
}

function ok(lines: string[]): AutopilotCommandResult {
  return { ok: true, lines };
}
function fail(line: string): AutopilotCommandResult {
  return { ok: false, lines: [`autopilot: ${line}`] };
}

function defaultRunOnRevert(cmd: string, cwd: string): void {
  execSync(cmd, {
    cwd,
    stdio: "ignore",
    shell: process.platform === "win32" ? undefined : process.env.SHELL || "/bin/bash",
  });
}

/**
 * Top-level command orchestrator for `/autopilot`. Returns rendered lines for the
 * UI rather than printing, and never throws on user error (returns `ok: false`).
 */
export function runAutopilotCommand(input: string, opts: AutopilotCommandOptions): AutopilotCommandResult {
  const cwd = opts.cwd;
  const runEval = opts.runEval ?? runEvalCommand;
  const runOnRevert = opts.runOnRevert ?? defaultRunOnRevert;
  const tokens = tokenize(input.trim());
  const [cmd, ...rest] = tokens;
  const { positionals, flags } = parseArgs(rest);

  switch (cmd) {
    case undefined:
    case "":
    case "help":
    case "--help":
      return ok([AUTOPILOT_HELP]);

    case "init": {
      if (sessionExists(cwd) && flags.force !== "true") {
        return fail(`session already frozen (use --force to overwrite)`);
      }
      const task = positionals.join(" ").trim() || (flags.task && flags.task !== "true" ? flags.task : "");
      if (!task) return fail("init requires a task: /autopilot init <task...> --eval <cmd>");
      if (!flags.eval || flags.eval === "true") {
        return fail("init requires --eval <command that prints 'score: N' or exits 0/1>");
      }
      const goalRaw = flags.goal && flags.goal !== "true" ? flags.goal : "min";
      if (!isGoal(goalRaw)) return fail("--goal must be min|max|gate");
      const timeout = parsePositiveInt(flags, "timeout", 300);
      if (typeof timeout !== "number") return fail(timeout.error);
      const patience = parsePositiveInt(flags, "patience", 3);
      if (typeof patience !== "number") return fail(patience.error);

      const session: AutopilotSession = {
        task,
        evalCmd: flags.eval,
        goal: goalRaw,
        timeoutSec: timeout,
        patience,
        createdAt: new Date().toISOString(),
        frozen: true,
      };
      freezeSession(cwd, session);
      return ok([
        `autopilot: session frozen → .jeo/autopilot/session.json`,
        `  task=${session.task}`,
        `  eval=${session.evalCmd}  goal=${session.goal}  timeout=${session.timeoutSec}s  patience=${session.patience}`,
        session.goal === "gate"
          ? `Make one change, then: /autopilot step --change "<what you changed>"`
          : `Next: /autopilot baseline`,
      ]);
    }

    case "baseline": {
      const session = loadSession(cwd);
      if (!session) return fail("no session — run: /autopilot init <task...> --eval <cmd>");
      if (hasBaseline(cwd)) return fail("baseline already recorded (re-init to reset)");
      const { score, passed, output } = runEval(session, cwd);
      appendLog(cwd, { type: "baseline", score, passed, output });
      return ok([`autopilot: baseline score=${fmt(score)} passed=${passed}`]);
    }

    case "step": {
      const session = loadSession(cwd);
      if (!session) return fail("no session — run: /autopilot init <task...> --eval <cmd>");
      if (session.goal !== "gate" && !hasBaseline(cwd)) {
        return fail("record a baseline first: /autopilot baseline");
      }
      const change = flags.change && flags.change !== "true" ? flags.change : "(unspecified change)";
      const best = currentBest(cwd, session.goal);
      const { score, passed, output } = runEval(session, cwd);
      const decision = decideStep(session.goal, score, passed, best);

      const revertLines: string[] = [];
      if (decision === "revert" && flags["on-revert"] && flags["on-revert"] !== "true") {
        try {
          runOnRevert(flags["on-revert"], cwd);
        } catch {
          revertLines.push("autopilot: --on-revert hook failed (decision still logged)");
        }
      }

      appendLog(cwd, { type: "step", change, score, passed, decision, prevBest: best ?? null, output });
      const cmp =
        session.goal === "gate"
          ? passed
            ? "pass"
            : "fail"
          : `${fmt(score)} vs best ${fmt(best)}`;
      return ok([`autopilot: step ${decision.toUpperCase()}  (${cmp})  — ${change}`, ...revertLines]);
    }

    case "status": {
      const session = loadSession(cwd);
      if (!session) return fail("no session — run: /autopilot init <task...> --eval <cmd>");
      const log = readLog(cwd);
      const steps = log.filter((e) => e.type === "step");
      const kept = steps.filter((e) => e.decision === "keep").length;
      const reverted = steps.filter((e) => e.decision === "revert").length;
      const baseline = log.find((e) => e.type === "baseline");
      const best = bestScoreFromLog(session.goal, log);
      const stop = [...log].reverse().find((e) => e.type === "stop");
      const sinceImprove = sinceImproveFromSteps(steps);
      const converged = isConverged(sinceImprove, session.patience);

      let recommendation: string;
      if (stop) recommendation = `stopped: ${stop.reason as string}`;
      else if (converged) recommendation = "converged — stop or change strategy";
      else recommendation = "continue";

      if (flags.json === "true") {
        return ok([
          JSON.stringify(
            {
              task: session.task,
              goal: session.goal,
              eval: session.evalCmd,
              baseline: baseline ? (baseline.score as number) : null,
              best: best ?? null,
              attempts: steps.length,
              kept,
              reverted,
              sinceImprove,
              converged,
              recommendation,
            },
            null,
            2,
          ),
        ]);
      }

      return ok([
        `Autopilot status — ${session.task}`,
        `  goal=${session.goal}  eval=${session.evalCmd}`,
        `  baseline=${fmt(baseline ? (baseline.score as number) : null)}  best=${fmt(best ?? null)}`,
        `  attempts=${steps.length}  kept=${kept}  reverted=${reverted}  sinceImprove=${sinceImprove}`,
        `  recommendation: ${recommendation}`,
      ]);
    }

    case "clear": {
      if (flags.confirm !== "true") return fail("refusing to clear without --confirm");
      const dir = apDir(cwd);
      if (existsSync(sessionPath(cwd))) {
        // overwrite then leave the dir; a fresh init re-freezes.
        try {
          writeFileSync(logPath(cwd), "", "utf8");
        } catch {
          /* ignore */
        }
      }
      // Best-effort removal of the session contract.
      try {
        if (existsSync(sessionPath(cwd))) renameSync(sessionPath(cwd), `${sessionPath(cwd)}.cleared`);
      } catch {
        /* ignore */
      }
      void dir;
      return ok(["autopilot: session + ledger cleared"]);
    }

    default:
      return fail(`unknown subcommand: ${cmd} (try: /autopilot help)`);
  }
}
