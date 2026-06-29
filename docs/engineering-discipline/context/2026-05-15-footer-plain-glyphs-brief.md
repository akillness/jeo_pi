# Context Brief: Footer plain glyph fallback 기본값 전환

### Goal
Windows 등 Nerd Font가 없는 환경에서 footer/statusline에 네모(tofu)가 보이지 않도록, agentic-harness footer의 기본 glyph 모드를 plain으로 바꾸고 Nerd Font UI는 명시적으로 opt-in 하게 만든다.

### Scope
- **In scope**:
  - `extensions/agentic-harness` footer의 Nerd Font 아이콘 기본 사용을 끄기
  - footer의 Powerline separator ``도 plain 모드에서는 일반 문자로 대체
  - 사용자 opt-in 설정 추가: `PI_AGENTIC_FOOTER_GLYPHS=nerd`, `.pi/settings.json`의 `{ "agenticHarness": { "footerGlyphs": "nerd" } }`
  - 기존 footer preset 설정과 공존
  - 관련 테스트 및 최소 문서 업데이트
- **Out of scope**:
  - plan/milestone/progress UI의 일반 유니코드 문자 변경
  - Windows Terminal 폰트 자동 감지
  - 전체 테마 시스템 개편

### Technical Context
- 현재 `extensions/agentic-harness/footer.ts`가 ``, ``, ``, `󰍛`, `󰆼` 등 Nerd Font/Powerline glyph를 출력합니다.
- `ICONS_PLAIN`과 `setUseNerdIcons(false)`는 이미 있으나, 런타임 사용자 설정으로 연결되어 있지 않고 Powerline separator ``는 여전히 하드코딩되어 있습니다.
- 설정 resolver는 `extensions/agentic-harness/ui-settings.ts`에 있으며 현재 `footerPreset`만 처리합니다.
- footer 생성은 `extensions/agentic-harness/index.ts`에서 `resolveAgenticUiSettings()` 결과를 `RoachFooter`에 넘기는 구조입니다.
- 주요 테스트 파일은 `footer.test.ts`, `ui-settings.test.ts`, `extension.test.ts`입니다.

### Constraints
- 기본값은 전체적으로 plain이어야 합니다.
- Nerd Font UI는 opt-in이어야 합니다.
- 최소 변경 원칙: footer glyph와 separator만 대상으로 하고 다른 UI 유니코드는 건드리지 않습니다.
- 설정 이름은 `footerGlyphs`, 값은 `plain|nerd`로 확정합니다.

### Success Criteria
- 기본 footer 출력에 Nerd Font/private-use glyph와 ``가 포함되지 않습니다.
- `PI_AGENTIC_FOOTER_GLYPHS=nerd` 또는 `agenticHarness.footerGlyphs: "nerd"` 설정 시 기존 Nerd Font/Powerline footer가 활성화됩니다.
- 기존 `footerPreset` 동작은 유지됩니다.
- 관련 테스트가 plain 기본값과 nerd opt-in을 검증합니다.

### Open Questions
없음.

### Complexity Assessment
| Signal | Score |
|---|---:|
| Scope breadth | 1 |
| File impact | 2 |
| Interface boundaries | 2 |
| Dependency depth | 1 |
| Risk surface | 1 |

**Score:** 7/15  
**Verdict:** Simple  
**Rationale:** footer/settings/tests에 걸친 소규모 변경이며 외부 시스템이나 복잡한 의존성은 없습니다. 다만 사용자-facing 설정이 추가되므로 테스트와 문서 반영이 필요합니다.

### Suggested Next Step
Proceed to `agentic-plan-crafting` — task fits in a single plan cycle.
