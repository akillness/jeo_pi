## Context Brief: Agentic Harness Plan Progress / Footer Render 안정화

### Goal
`agentic-harness`에서 plan 실행 중 화면이 아래로 밀리는 현상을 줄이고, `plan-validator` 성공 후에도 Task Progress Tracker가 `running`으로 남는 문제를 고친다.

### Scope
- **In scope**
  - `plan-validator` 성공 시 해당 plan task가 정확히 `completed` 처리되도록 수정
  - `plan-compliance` / `plan-worker` / reviewer / nested subagent가 tracker 상태를 잘못 오염시키지 않도록 방어
  - footer / Task Progress Tracker 리렌더가 화면을 밀지 않도록 렌더링 방식 조정
  - 관련 regression test 추가

- **Out of scope**
  - Task Progress Tracker 제거
  - plan 실행 플로우 전체 재설계
  - 카테고리 분류 프롬프트나 실제 product feature 작업
  - pi TUI 코어 대규모 수정

### Technical Context
- 관련 파일:
  - `extensions/agentic-harness/plan-progress.ts`
    - `0/4 │ 2 running`, `◐`, `○`, `✓` 렌더링 담당
  - `extensions/agentic-harness/plan-progress-events.ts`
    - subagent lifecycle을 plan task 상태로 변환
  - `extensions/agentic-harness/footer.ts`
    - footer render 및 spinner tick 처리
  - `extensions/agentic-harness/index.ts`
    - `tool_execution_start/end` 이벤트 wiring

- 핵심 원인 후보:
  - `plan-validator` 성공이어도 `matchedTaskIds`가 없거나 mismatch되면 explicit `planTaskId` completion이 skip될 수 있음
  - successful non-validator stage는 의도적으로 task를 완료하지 않는데, 이 상태가 validator 완료와 제대로 연결되지 않으면 `running`이 누적됨
  - footer가 spinner/status 변경마다 `requestRender(true)`를 호출해 full redraw가 반복되고, 이것이 화면 밀림을 유발할 가능성이 큼

### Constraints
- Task Progress Tracker는 유지
- 목표는 숨김/축소가 아니라 “렌더링 방식 안정화”
- 기존 의도: `plan-compliance` / `plan-worker` 성공만으로는 completed 처리하지 않고, `plan-validator` 성공이 completion 기준
- reviewer/nested subagent는 plan task 상태를 임의로 start/complete하지 않아야 함

### Success Criteria
- Task 1 validator 성공 후 Task 2가 실행 중이면 footer가 다음처럼 보여야 함:
  - `1/4 │ 1 running`
  - Task 1: `✓`
  - Task 2: spinner
- `plan-validator` 성공 이벤트에 `matchedTaskIds`가 없어도 `planTaskId` 기준으로 completion 처리됨
- reviewer/nested subagent가 plan task를 잘못 running/completed로 만들지 않음
- spinner tick/status update가 반복되어도 화면이 아래로 밀리지 않음
- 관련 Vitest regression test 추가 및 기존 테스트 통과

### Open Questions
- 화면 밀림의 실제 terminal-level repro는 아직 완전 특정되지 않았지만, 사용자가 선택한 목표는 **렌더링 방식 안정화**로 확정.

### Complexity Assessment

| Signal | Score |
|---|---:|
| Scope breadth | 2 |
| File impact | 2 |
| Interface boundaries | 2 |
| Dependency depth | 2 |
| Risk surface | 2 |

**Score:** 10  
**Verdict:** Complex  
**Rationale:** progress lifecycle, nested subagent matching, footer/TUI rendering이 연결된 내부 통합 문제라 단일 파일 수정으로 끝나기 어렵습니다.

### Suggested Next Step
Proceed to `agentic-milestone-planning` — task requires milestone decomposition for multi-phase execution.
