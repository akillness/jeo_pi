# Risk Analysis

## Identified Risks

| # | Risk | Severity | Affected | Mitigation |
|---|------|----------|----------|------------|
| 1 | runAgent() structural coupling | Critical | M1 | Spike wrapper approach first, keep runAgent() untouched |
| 2 | No process registry | Critical | All | Build first, modeled on team-state.ts |
| 3 | Interrupt semantics ambiguous | High | M2 | Define upfront: SIGTERM/C-c, 5s grace, SIGKILL |
| 4 | Schema backward compatibility | High | M4 | Discriminated union on action field |
| 5 | Completion notification mechanism | High | M3 | File-based fallback, spike Pi API |
| 6 | lastActivity not in SingleResult | Medium | M4 | Small safe additive change |
| 7 | Dual backend complexity | High | All | Native first, then tmux |
| 8 | Extension API surface area | Critical | M1 | Verify registerTool.execute can return early |
| 9 | Process leak on parent crash | Medium | M1,M2 | session_shutdown cleanup handler |
| 10 | Resume ambiguity | High | Deferred | Cut from scope entirely |

## Risk-Ordered Sequence

1. Extension API spike (gate in M1) — fail fast on blocker
2. Process registry + async spawn (M1) — foundation
3. Status query (M2) — validates registry
4. Completion notification (M3) — highest uncertainty remaining
5. Live progress (M4) — additive, lowest risk
6. Interrupt (M2) — well-defined, medium risk
7. Schema integration (M4) — purely additive, safest last
