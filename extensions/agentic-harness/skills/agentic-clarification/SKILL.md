---
name: agentic-clarification
description: Use when a user's request is vague, ambiguous, or underspecified. Launches an iterative Q&A loop to resolve ambiguity, using an explorer subagent only when codebase context is needed. Outputs a Goal Contract for the durable /goal runtime. Triggers on "I want to...", "I need...", "let's build...", "can you help me...", "we should...", or any request where the full scope isn't immediately clear.
---

# Runtime-Enforced Deep Clarification

Narrows vague user requests into a durable Goal Contract through a deep-interview loop. Runs questions first, adds code exploration only when technical context is needed, records hidden runtime state with `clarification_state`, and blocks Goal Contract handoff until the checklist/ambiguity gate passes.

## Core Principle

Ambiguity does not resolve in one pass. Multiple rounds of questions, and code exploration when needed, gradually sharpen the picture. The purpose of this skill is not "writing code" — it is making "what the user wants" clear and, for implementation/codebase-impacting requests, making "what state the codebase is in" vivid enough to draft safely.

## Hard Gates

1. **One question per message.** Never bundle multiple questions into a single message.
2. **Use explorer only when needed.** Prefer saving tokens and latency for non-code/product/wording clarification; dispatch `agent: "explorer"` when the request is clearly implementation/codebase-impacting or when technical context is missing/uncertain.
3. **Use `clarification_state` whenever available.** Record every user answer, explorer finding, checklist update, unresolved ambiguity, accepted risk, and final Goal Contract draft.
4. **Do not start implementation until the runtime gate says `Gate: PASS`.** Understanding must be complete at the user-intent and codebase levels.
5. **Every question must narrow scope.** Do not repeat questions at the same level of ambiguity.
6. **Never dump raw code exploration results on the user.** Summarize findings in the context of the user's question.

## When To Use

- The user says "I want to…" but the scope is unclear
- The request is vague enough that implementation could go in multiple directions
- The user themselves hasn't fully articulated what they want
- There's a risk of clashing with existing codebase structure, so exploration may be needed

## When NOT To Use

- The request is already specific and clear (create or activate a `/goal` directly)
- The scope is obvious, like a simple bug fix or config change
- The user explicitly says "don't ask questions, just do it"

## The Two-Track Process

### Track 1: User Q&A (Ambiguity Resolution)

Ask the user questions to resolve ambiguity.

**Question principles:**

- One question per message
- Offer choices when possible (A/B/C)
- When a new ambiguity emerges from an answer, drill into it in the next question
- Ask "which case?" rather than "why?" — draw out concrete scenarios, not abstract intent
- If an answer contradicts a previous one, flag it immediately and realign

**Deep-interview coverage guide:**

The hidden runtime checklist must have concrete content for every item before handoff:

1. **Objective**: the durable end goal in one sentence.
2. **Scope**: what is included.
3. **Non-goals**: what is explicitly excluded.
4. **Constraints**: compatibility, time, dependencies, user preferences, migration boundaries.
5. **Success criteria**: observable acceptance conditions.
6. **Evidence required**: tests, commands, screenshots, logs, docs, or manual checks the verifier should expect.
7. **Risks**: known blockers, regression risks, rollback concerns.
8. **Edge cases**: boundary inputs, failure paths, platform differences, permissions, concurrency.
9. **Technical context**: affected files, existing patterns, integration points, and test coverage.

After each answer, briefly update "what we've established so far," call `clarification_state` to record the answer/checklist changes, and decide the next single most important ambiguity.

### Track 2: Codebase Exploration (Technical Context)

Use an explorer subagent only when codebase context is needed. Default to no explorer for non-code/product/wording clarification to save tokens and latency. For clear implementation/codebase-impacting requests, or whenever the technical context checklist cannot be completed from known information, launch `agent: "explorer"` and let it find/read files on demand.

**How to decide whether to dispatch exploration:**

Dispatch a subagent via the `subagent` tool with `agent: "explorer"` when any of these are true:

- The request asks to change code, tests, prompts, docs, configuration, or runtime behavior.
- A Goal Contract would mention affected files, interfaces, tests, migrations, or regressions.
- The `technical_context` checklist item is missing, uncertain, or would otherwise need to be accepted as risk.
- A user answer creates a new technical ambiguity.

When dispatched, the subagent investigates:

- Related file structure and naming conventions
- Existing implementation patterns (error handling, state management, data flow)
- Dependencies and interface boundaries
- Recent change history (relevant commits)
- Test coverage status

**Conditional subagent dispatch example:**

When the criteria above are met, call the `subagent` tool in single mode:
- `agent`: `"explorer"`
- `task`: A description of what to investigate

```
agent: "explorer"
task: |
  The user has requested [summarized request for a future Goal Contract].

  Investigate and report on:
  1. Related files and the role of each
  2. Existing implementation patterns (is something similar already in place?)
  3. Boundary areas this work is likely to affect
  4. Recent related changes
  5. Existing test state

  Report only key findings concisely.
  Do not dump entire file contents.
```

**Processing subagent results:**

When the subagent returns findings:
1. Cross-validate against the user's answers
2. If technical constraints unknown to the user are discovered, reflect them in the next question
3. If a conflict with existing code is likely, notify the user

## Putting It Together: The Goal Contract Loop

```dot
digraph agentic-clarification {
    rankdir=TB;
    "User states vague request" [shape=box];
    "Assess: what's ambiguous?" [shape=box];
    "Ask user ONE question" [shape=box];
    "Dispatch explorer if technical context is needed" [shape=box, style=dashed];
    "Receive user answer" [shape=box];
    "Receive explorer findings if dispatched" [shape=box, style=dashed];
    "Synthesize: still ambiguous?" [shape=diamond];
    "Present context brief" [shape=doublecircle];

    "User states vague request" -> "Assess: what's ambiguous?";
    "Assess: what's ambiguous?" -> "Ask user ONE question";
    "Ask user ONE question" -> "Dispatch explorer if technical context is needed" [style=dashed, label="conditional"];
    "Ask user ONE question" -> "Receive user answer";
    "Dispatch explorer if technical context is needed" -> "Receive explorer findings if dispatched" [style=dashed];
    "Receive user answer" -> "Synthesize: still ambiguous?";
    "Receive explorer findings if dispatched" -> "Synthesize: still ambiguous?" [style=dashed];
    "Synthesize: still ambiguous?" -> "Ask user ONE question" [label="yes"];
    "Synthesize: still ambiguous?" -> "Present context brief" [label="no"];
}
```

**Each cycle:**

1. Receive the user's answer
2. Merge subagent results if an explorer was dispatched (if still in progress, merge in the next cycle)
3. Update the "remaining ambiguities" list
4. Pick the next question (prioritize the one that most affects scope)
5. If needed, launch an explorer subagent when new technical context is missing or previous exploration revealed new areas to investigate

## Runtime Gate

Before producing the final Goal Contract:

1. Call `clarification_state` with `action=status`.
2. If the result contains `Gate: BLOCKED`, ask exactly one follow-up question for the highest-impact unresolved item, or use `subagent` if the missing information is technical.
3. Only when the result contains `Gate: PASS`, call `clarification_state` with `action=draft_goal_contract` using the exact Goal Contract fields.
4. Then present the Goal Contract to the user and stop.

Do not expose the hidden checklist as a separate command workflow. The user should experience questions and the final contract, not state management.

## Output: Goal Contract

When the runtime gate passes, present the user with a Goal Contract. This is the skill's final deliverable.

**Goal Contract format:**

```markdown
## Goal Contract: [Task Title]

### Objective
[One-sentence objective for the durable goal]

### Scope
- **In scope**: [Included work]
- **Out of scope**: [Explicitly excluded work]

### Technical Context
[Technical facts discovered through code exploration, or a concise note that no code exploration was needed for a non-code clarification]
- Current implementation state
- Affected areas
- Existing patterns to follow

### Success Criteria
- [Verifiable criterion for the completed state]

### Constraints
- [External, technical, time, priority, or compatibility constraint]

### Evidence Required
- [Evidence that must be added before requesting completion]

### Risks
- [Risk, blocker, or uncertainty the goal runtime should track]

### Suggested Initial Subgoals
1. [Initial subgoal title and objective]

### Open Questions (if any)
[Questions still open — unresolved but not blocking]

### Handoff
Run this after the user approves this Goal Contract:
- `/goal`
```

Show the Goal Contract in the conversation and stop. Do not begin implementation from this skill.

## Red Flags

Stop and recalibrate if any of these occur:

| Situation | Response |
|-----------|----------|
| User says "just figure it out" | Warn: starting before ambiguity is resolved leads to a high probability of rework. At minimum, confirm purpose and success criteria |
| Same topic questioned 3+ times | The user genuinely doesn't know. Separate knowns from unknowns, present assumptions for the unknowns, and confirm |
| Subagent finds conflicting existing code | Notify the user immediately. Conflicts with existing structure require a design decision |
| Request decomposes into multiple independent sub-tasks | Show the decomposition to the user and propose prioritizing one at a time |

## Anti-Patterns

| Anti-Pattern | Why It Fails |
|--------------|-------------|
| Five questions in one message | The user gives shallow answers. Ambiguity persists. |
| Skipping code exploration for implementation work | Scope can narrow in a direction that conflicts with existing code |
| Showing full subagent output to the user | Too much noise. Provide only the summary relevant to the user's context |
| Deciding "that's enough" unilaterally | Always present the Goal Contract to the user and get confirmation |
| Starting implementation | This skill ends at "clear context," not "implemented code" |

## Minimal Checklist

Self-check at the end of each cycle:

- [ ] Did one ambiguity get resolved this cycle?
- [ ] Is explorer use justified as needed or intentionally skipped for a non-code clarification?
- [ ] Was `clarification_state` updated with the answer/finding/checklist change?
- [ ] Is the next question based on previous answers and the current gate blockers?
- [ ] Has progress been clearly communicated to the user?

## Handoff Rules

After the Goal Contract is approved, hand the work to the durable goal runtime:

- Tell the user to run `/goal`; the runtime will create, activate, continue, and verify automatically.
- Do not ask the user to type `/goal create`, `/goal activate`, target ids, or other setup commands for the normal flow.
- Do not route to another workflow skill from clarification.
- Do not start implementation from clarification.
- If further exploration is needed, continue the Q&A loop within this skill.

The Goal Contract is the only final output of this skill. It must include enough success criteria and evidence required for the goal verifier to judge completion later.
