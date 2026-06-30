import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AutopilotSession,
  type EvalResult,
  bestScoreFromLog,
  decideStep,
  foldBest,
  isConverged,
  isGoal,
  isImprovement,
  loadSession,
  parseArgs,
  parseScore,
  readLog,
  runAutopilotCommand,
  sinceImproveFromSteps,
  tokenize,
} from "../autopilot.js";

// ── pure ratchet brain ───────────────────────────────────────────────────────

describe("parseScore", () => {
  it("extracts a single score", () => {
    expect(parseScore("score: 42")).toBe(42);
  });
  it("takes the LAST score when several are printed", () => {
    expect(parseScore("score: 10\n...\nscore: 7")).toBe(7);
  });
  it("handles decimals and negatives", () => {
    expect(parseScore("score: -3.5")).toBe(-3.5);
  });
  it("is case-insensitive and tolerates surrounding text", () => {
    expect(parseScore("Final SCORE:  0.25 done")).toBe(0.25);
  });
  it("returns NaN when no score line exists", () => {
    expect(Number.isNaN(parseScore("all tests passed"))).toBe(true);
  });
});

describe("isImprovement", () => {
  it("treats an undefined best as always improving", () => {
    expect(isImprovement("min", 100, undefined)).toBe(true);
    expect(isImprovement("max", -100, undefined)).toBe(true);
  });
  it("compares correctly for min and max", () => {
    expect(isImprovement("min", 5, 10)).toBe(true);
    expect(isImprovement("min", 10, 5)).toBe(false);
    expect(isImprovement("max", 10, 5)).toBe(true);
    expect(isImprovement("max", 5, 10)).toBe(false);
  });
  it("is always true for gate (score is irrelevant)", () => {
    expect(isImprovement("gate", 0, 999)).toBe(true);
  });
});

describe("foldBest", () => {
  it("never lets NaN become the best", () => {
    expect(foldBest("min", 5, NaN)).toBe(5);
    expect(foldBest("min", undefined, NaN)).toBeUndefined();
  });
  it("adopts the score when there is no best yet", () => {
    expect(foldBest("min", undefined, 3)).toBe(3);
  });
  it("keeps the better value for min and max", () => {
    expect(foldBest("min", 5, 8)).toBe(5);
    expect(foldBest("min", 5, 2)).toBe(2);
    expect(foldBest("max", 5, 8)).toBe(8);
    expect(foldBest("max", 5, 2)).toBe(5);
  });
  it("tracks the latest value for gate", () => {
    expect(foldBest("gate", 5, 2)).toBe(2);
  });
});

describe("bestScoreFromLog", () => {
  it("folds baseline and kept steps, ignoring reverts and NaN", () => {
    const log = [
      { type: "baseline", score: 10 },
      { type: "step", decision: "keep", score: 8 },
      { type: "step", decision: "revert", score: 2 }, // ignored despite being lower
      { type: "step", decision: "keep", score: NaN }, // NaN never wins
      { type: "step", decision: "keep", score: 6 },
    ];
    expect(bestScoreFromLog("min", log)).toBe(6);
  });
  it("returns undefined for an empty log", () => {
    expect(bestScoreFromLog("max", [])).toBeUndefined();
  });
  it("matches a forward fold of the same kept scores (no divergence)", () => {
    const kept = [10, 8, 6, 7, 5];
    const log = kept.map((score, i) => (i === 0 ? { type: "baseline", score } : { type: "step", decision: "keep", score }));
    let folded: number | undefined;
    for (const s of kept) folded = foldBest("min", folded, s);
    expect(bestScoreFromLog("min", log)).toBe(folded);
  });
});

describe("decideStep", () => {
  it("keeps on a passing gate and reverts on a failing gate", () => {
    expect(decideStep("gate", NaN, true, undefined)).toBe("keep");
    expect(decideStep("gate", NaN, false, undefined)).toBe("revert");
  });
  it("always reverts a non-measurable (NaN) score for min/max", () => {
    expect(decideStep("min", NaN, true, 5)).toBe("revert");
    expect(decideStep("max", NaN, true, 5)).toBe("revert");
  });
  it("keeps improvements and reverts regressions for min/max", () => {
    expect(decideStep("min", 3, true, 5)).toBe("keep");
    expect(decideStep("min", 7, true, 5)).toBe("revert");
    expect(decideStep("max", 7, true, 5)).toBe("keep");
    expect(decideStep("max", 3, true, 5)).toBe("revert");
  });
  it("keeps the first measurable score when there is no best yet", () => {
    expect(decideStep("min", 100, true, undefined)).toBe("keep");
  });
});

describe("isConverged", () => {
  it("is true only once the no-progress streak reaches patience", () => {
    expect(isConverged(2, 3)).toBe(false);
    expect(isConverged(3, 3)).toBe(true);
    expect(isConverged(4, 3)).toBe(true);
  });
});

describe("sinceImproveFromSteps", () => {
  it("resets the streak on each keep", () => {
    const steps = [
      { decision: "revert" },
      { decision: "revert" },
      { decision: "keep" },
      { decision: "revert" },
    ];
    expect(sinceImproveFromSteps(steps)).toBe(1);
  });
  it("counts a clean run of reverts", () => {
    expect(sinceImproveFromSteps([{ decision: "revert" }, { decision: "revert" }])).toBe(2);
  });
});

describe("parseArgs / tokenize", () => {
  it("splits flags with values and bare boolean flags", () => {
    expect(parseArgs(["--eval", "npm test", "--force"])).toEqual({
      positionals: [],
      flags: { eval: "npm test", force: "true" },
    });
  });
  it("honours quoted flag values when tokenizing", () => {
    expect(tokenize('init build a thing --eval "npm run score"')).toEqual([
      "init",
      "build",
      "a",
      "thing",
      "--eval",
      "npm run score",
    ]);
  });
  it("guards the Goal type", () => {
    expect(isGoal("min")).toBe(true);
    expect(isGoal("bogus")).toBe(false);
  });
});

// ── command orchestration over a real temp cwd ───────────────────────────────

function queueEval(results: EvalResult[]): (s: AutopilotSession, cwd: string) => EvalResult {
  let i = 0;
  return () => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return r;
  };
}

describe("runAutopilotCommand", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "autopilot-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  it("freezes a session on init and refuses a second init without --force", () => {
    const first = runAutopilotCommand('init reduce flakiness --eval "npm test" --goal min', { cwd });
    expect(first.ok).toBe(true);
    expect(existsSync(join(cwd, ".jeo", "autopilot", "session.json"))).toBe(true);
    const session = loadSession(cwd)!;
    expect(session.task).toBe("reduce flakiness");
    expect(session.evalCmd).toBe("npm test");
    expect(session.goal).toBe("min");
    expect(session.frozen).toBe(true);

    const again = runAutopilotCommand('init other --eval "x"', { cwd });
    expect(again.ok).toBe(false);
    expect(again.lines.join(" ")).toContain("already frozen");

    const forced = runAutopilotCommand('init other --eval "y" --force', { cwd });
    expect(forced.ok).toBe(true);
    expect(loadSession(cwd)!.task).toBe("other");
  });

  it("rejects init without a task, eval, or with a bad goal/patience", () => {
    expect(runAutopilotCommand("init --eval x", { cwd }).ok).toBe(false); // no task
    expect(runAutopilotCommand("init do something", { cwd }).ok).toBe(false); // no eval
    expect(runAutopilotCommand("init t --eval x --goal sideways", { cwd }).ok).toBe(false);
    expect(runAutopilotCommand("init t --eval x --patience 0", { cwd }).ok).toBe(false);
  });

  it("records a baseline once and rejects a second baseline", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min', { cwd });
    const runEval = queueEval([{ score: 10, passed: true, output: "score: 10" }]);
    const base = runAutopilotCommand("baseline", { cwd, runEval });
    expect(base.ok).toBe(true);
    expect(base.lines.join(" ")).toContain("baseline score=10");
    expect(readLog(cwd).filter((e) => e.type === "baseline")).toHaveLength(1);

    const dupe = runAutopilotCommand("baseline", { cwd, runEval });
    expect(dupe.ok).toBe(false);
  });

  it("requires a baseline before stepping a min/max goal", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min', { cwd });
    const res = runAutopilotCommand('step --change "edit"', { cwd, runEval: queueEval([{ score: 1, passed: true, output: "" }]) });
    expect(res.ok).toBe(false);
    expect(res.lines.join(" ")).toContain("baseline first");
  });

  it("keeps an improving step and reverts a regressing one (min goal)", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min', { cwd });
    runAutopilotCommand("baseline", { cwd, runEval: queueEval([{ score: 10, passed: true, output: "score: 10" }]) });

    const keep = runAutopilotCommand('step --change "better"', {
      cwd,
      runEval: queueEval([{ score: 8, passed: true, output: "score: 8" }]),
    });
    expect(keep.lines[0]).toContain("step KEEP");

    const revert = runAutopilotCommand('step --change "worse"', {
      cwd,
      runEval: queueEval([{ score: 9, passed: true, output: "score: 9" }]),
    });
    expect(revert.lines[0]).toContain("step REVERT");

    const steps = readLog(cwd).filter((e) => e.type === "step");
    expect(steps.map((s) => s.decision)).toEqual(["keep", "revert"]);
    expect(bestScoreFromLog("min", readLog(cwd))).toBe(8);
  });

  it("runs the --on-revert hook only when the decision is revert", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min', { cwd });
    runAutopilotCommand("baseline", { cwd, runEval: queueEval([{ score: 10, passed: true, output: "score: 10" }]) });
    const reverts: string[] = [];
    const runOnRevert = (c: string) => reverts.push(c);

    runAutopilotCommand('step --change "good" --on-revert "git checkout ."', {
      cwd,
      runEval: queueEval([{ score: 5, passed: true, output: "score: 5" }]),
      runOnRevert,
    });
    expect(reverts).toHaveLength(0); // kept → no revert hook

    runAutopilotCommand('step --change "bad" --on-revert "git checkout ."', {
      cwd,
      runEval: queueEval([{ score: 99, passed: true, output: "score: 99" }]),
      runOnRevert,
    });
    expect(reverts).toEqual(["git checkout ."]);
  });

  it("steps a gate goal without a baseline using pass/fail", () => {
    runAutopilotCommand('init t --eval "cmd" --goal gate', { cwd });
    const pass = runAutopilotCommand('step --change "fix"', { cwd, runEval: queueEval([{ score: NaN, passed: true, output: "ok" }]) });
    expect(pass.lines[0]).toContain("KEEP");
    const failStep = runAutopilotCommand('step --change "break"', { cwd, runEval: queueEval([{ score: NaN, passed: false, output: "boom" }]) });
    expect(failStep.lines[0]).toContain("REVERT");
  });

  it("renders status with a convergence recommendation and JSON form", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min --patience 2', { cwd });
    runAutopilotCommand("baseline", { cwd, runEval: queueEval([{ score: 10, passed: true, output: "score: 10" }]) });
    // two consecutive reverts hit patience=2 → converged
    runAutopilotCommand('step --change "a"', { cwd, runEval: queueEval([{ score: 11, passed: true, output: "score: 11" }]) });
    runAutopilotCommand('step --change "b"', { cwd, runEval: queueEval([{ score: 12, passed: true, output: "score: 12" }]) });

    const text = runAutopilotCommand("status", { cwd });
    expect(text.ok).toBe(true);
    expect(text.lines.join("\n")).toContain("converged");

    const jsonRes = runAutopilotCommand("status --json", { cwd });
    const parsed = JSON.parse(jsonRes.lines[0]);
    expect(parsed.baseline).toBe(10);
    expect(parsed.best).toBe(10);
    expect(parsed.reverted).toBe(2);
    expect(parsed.converged).toBe(true);
    expect(parsed.recommendation).toContain("converged");
  });

  it("refuses to clear without --confirm and clears the ledger with it", () => {
    runAutopilotCommand('init t --eval "cmd"', { cwd });
    expect(runAutopilotCommand("clear", { cwd }).ok).toBe(false);
    const cleared = runAutopilotCommand("clear --confirm", { cwd });
    expect(cleared.ok).toBe(true);
    expect(existsSync(join(cwd, ".jeo", "autopilot", "session.json"))).toBe(false);
  });

  it("returns help text and rejects unknown subcommands", () => {
    expect(runAutopilotCommand("", { cwd }).lines.join("\n")).toContain("autoresearch ratcheting");
    expect(runAutopilotCommand("help", { cwd }).lines.join("\n")).toContain("/autopilot init");
    expect(runAutopilotCommand("frobnicate", { cwd }).ok).toBe(false);
  });

  it("writes an append-only JSONL ledger with one event per line", () => {
    runAutopilotCommand('init t --eval "cmd" --goal min', { cwd });
    runAutopilotCommand("baseline", { cwd, runEval: queueEval([{ score: 10, passed: true, output: "score: 10" }]) });
    runAutopilotCommand('step --change "x"', { cwd, runEval: queueEval([{ score: 8, passed: true, output: "score: 8" }]) });
    const raw = readFileSync(join(cwd, ".jeo", "autopilot", "log.jsonl"), "utf8").trim().split("\n");
    expect(raw).toHaveLength(2);
    for (const line of raw) expect(() => JSON.parse(line)).not.toThrow();
    expect(JSON.parse(raw[0]).type).toBe("baseline");
    expect(JSON.parse(raw[1]).type).toBe("step");
  });
});

// ── real subprocess end-to-end (no injected eval seam) ───────────────────────
// These exercise the actual `runEvalCommand` execSync boundary + on-disk ledger,
// the one path the seam-injected tests above never touch. The operator's "one
// change" between steps is modelled by mutating a metric file the eval reads.

describe("runAutopilotCommand — real subprocess eval", () => {
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "autopilot-e2e-"));
  });
  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  // eval reads ./metric and prints `score: <contents>`; min goal wants it lower.
  // The eval is wrapped in ONE level of double quotes (the /autopilot tokenizer
  // contract); inner quoting stays single so the command survives intact.
  const SCORE_EVAL_FLAG = `--eval "printf 'score: %s\\n' $(cat metric)"`;
  const writeMetric = (v: number) => writeFileSync(join(cwd, "metric"), String(v), "utf8");

  it("ratchets a real min-goal loop end-to-end through execSync", () => {
    writeMetric(10);
    const init = runAutopilotCommand(`init shrink ${SCORE_EVAL_FLAG} --goal min`, { cwd });
    expect(init.ok).toBe(true);

    // Baseline spawns the real shell and parses the real stdout score.
    const base = runAutopilotCommand("baseline", { cwd });
    expect(base.ok).toBe(true);
    expect(base.lines.join(" ")).toContain("baseline score=10");

    // One real change that improves → KEEP.
    writeMetric(6);
    const better = runAutopilotCommand('step --change "lower metric to 6"', { cwd });
    expect(better.lines[0]).toContain("step KEEP");

    // One real change that regresses → REVERT (best stays 6).
    writeMetric(9);
    const worse = runAutopilotCommand('step --change "metric drifts to 9"', { cwd });
    expect(worse.lines[0]).toContain("step REVERT");

    // The on-disk ledger reflects real subprocess scores, not injected ones.
    const log = readLog(cwd);
    const baseline = log.find((e) => e.type === "baseline");
    expect(baseline!.score).toBe(10);
    const steps = log.filter((e) => e.type === "step");
    expect(steps.map((s) => s.score)).toEqual([6, 9]);
    expect(steps.map((s) => s.decision)).toEqual(["keep", "revert"]);
    expect(bestScoreFromLog("min", log)).toBe(6);

    const status = runAutopilotCommand("status --json", { cwd });
    const parsed = JSON.parse(status.lines[0]);
    expect(parsed).toMatchObject({ baseline: 10, best: 6, attempts: 2, kept: 1, reverted: 1 });
  });

  it("reverts a non-measurable (no score line) real run", () => {
    writeMetric(5);
    runAutopilotCommand(`init t ${SCORE_EVAL_FLAG} --goal min`, { cwd });
    runAutopilotCommand("baseline", { cwd });
    // Re-freeze the eval to one that prints no score line → NaN → revert.
    runAutopilotCommand(`init t --eval ${JSON.stringify("echo no-metric-here")} --goal min --force`, { cwd });
    runAutopilotCommand("baseline", { cwd }); // baseline also NaN, allowed
    const res = runAutopilotCommand('step --change "blind edit"', { cwd });
    expect(res.lines[0]).toContain("step REVERT");
    const step = readLog(cwd).filter((e) => e.type === "step")[0];
    // A non-measurable (NaN) score cannot be represented in JSON, so it persists
    // as null — never a number, so the ratchet's best-scan can never adopt it.
    expect(step.score).toBeNull();
    expect(bestScoreFromLog("min", readLog(cwd))).toBeUndefined();
  });

  it("drives a real gate goal off the eval exit code", () => {
    // gate eval passes iff ./gate file contains 1 (bare, no inner quotes).
    const GATE_FLAG = `--eval "test $(cat gate) = 1"`;
    writeFileSync(join(cwd, "gate"), "0", "utf8");
    runAutopilotCommand(`init g ${GATE_FLAG} --goal gate`, { cwd });

    // failing change → REVERT
    const fail = runAutopilotCommand('step --change "still broken"', { cwd });
    expect(fail.lines[0]).toContain("step REVERT");
    expect(fail.lines[0]).toContain("fail");

    // passing change → KEEP
    writeFileSync(join(cwd, "gate"), "1", "utf8");
    const pass = runAutopilotCommand('step --change "fixed gate"', { cwd });
    expect(pass.lines[0]).toContain("step KEEP");
    expect(pass.lines[0]).toContain("pass");

    const steps = readLog(cwd).filter((e) => e.type === "step");
    expect(steps.map((s) => s.passed)).toEqual([false, true]);
    expect(steps.map((s) => s.decision)).toEqual(["revert", "keep"]);
  });

  it("converges after a real patience-length revert streak", () => {
    writeMetric(3);
    runAutopilotCommand(`init t ${SCORE_EVAL_FLAG} --goal min --patience 2`, { cwd });
    runAutopilotCommand("baseline", { cwd }); // best=3
    // two consecutive regressions (real runs) → reverts → converged
    writeMetric(7);
    runAutopilotCommand('step --change "regress 1"', { cwd });
    writeMetric(8);
    runAutopilotCommand('step --change "regress 2"', { cwd });
    const status = runAutopilotCommand("status --json", { cwd });
    const parsed = JSON.parse(status.lines[0]);
    expect(parsed.sinceImprove).toBe(2);
    expect(parsed.converged).toBe(true);
    expect(parsed.recommendation).toContain("converged");
  });
});
