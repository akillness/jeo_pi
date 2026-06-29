## Context Brief: pi-mcp-adapter Battery Included Adoption

### Goal
`nicobailon/pi-mcp-adapter`를 roach-pi의 bundled extension (Pattern B — 외부 git 의존성)으로 포함시키고, 기본 설정에서 자동으로 MCP 설정 파일을 읽도록 활성화할 수 있는지 보안 및 안정성 관점에서 평가한다.

### Scope
- **In scope**: 저장소 코드 리뷰 (보안, 공급망, 안정성), Pattern B 통합 적합성 평가, Context Brief 작성
- **Out of scope**: 실제 통합 구현 (package.json 수정, README 업데이트, 테스트 작성 등)

### Technical Context

#### 저장소 현황 (2026-05-22 기준)
| 항목 | 상태 |
|------|------|
| 버전 | v2.6.1 (2026-05-13 릴리스) |
| Stars / Forks | 737 / 132 |
| License | MIT |
| Commits | 77 |
| Open Issues | 32 |
| 테스트 | 178+ (vitest) |
| SemVer 준수 | ✅ CHANGELOG.md 상세 관리 |
| Pi API 추적 | ✅ `@earendil-works/*` 이미 마이그레이션 완료 |

#### 의존성 (Supply Chain 분석)

| 패키지 | 역할 | 위험도 |
|--------|------|--------|
| `@modelcontextprotocol/sdk` ^1.25.1 | 공식 MCP SDK | **낮음** — MCP 표준 관리 주체 |
| `@earendil-works/pi-ai` ^0.74.0 | Pi AI 코어 | **낮음** — 현재 프로젝트가 이미 의존 |
| `@earendil-works/pi-tui` ^0.74.0 | Pi TUI | **낮음** — 현재 프로젝트가 이미 의존 |
| `open` ^10.2.0 | 브라우저 열기 (OAuth 콜백용) | **낮음** — 안정적 유틸리티, 1억+ 주간 다운로드 |
| `typebox` ^1.1.24 | 스키마 정의 | **낮음** — Pi 확장 표준 |
| `zod` ^3.25.0 \|\| ^4.0.0 | 런타임 검증 | **낮음** — 널리 사용되는 검증 라이브러리 |
| `@modelcontextprotocol/ext-apps` ^1.2.2 | MCP UI 표준 지원 | **중간** — 비교적 새로운 패키지 |

**의존성 결론**: 모든 핵심 의존성이 잘 알려진 공식 패키지이며, 현재 roach-pi 프로젝트가 이미 사용하는 Pi 코어 패키지와 동일 계열이다. Supply chain 위험은 낮다.

#### 소스 코드 보안 분석

**1. 프로세스 생성 (주요 공격 표면)**
- `server-manager.ts`: `StdioClientTransport`를 통해 MCP 서버 프로세스를 자식으로 생성
- `resolveEnv()`: **전체 `process.env`를 자식 프로세스에 상속** — 이는 표준 패턴이지만, MCP 서버가 호스트 환경변수에 접근 가능함을 의미
- `npx-resolver.ts`: npx 바이너리를 직접 경로로 해석하여 npm 부모 프로세스(~143MB) 생략 — 효율적이나 프로세스 실행 경로

**2. 설정 파일 파싱 (주입 벡터)**
- `config.ts`: 4개 경로에서 JSON 파일 읽기 (`~/.config/mcp/mcp.json`, `~/.pi/agent/mcp.json`, `.mcp.json`, `.pi/mcp.json`)
- `JSON.parse()` 사용 — `eval()` 없음 ✅
- `validateConfig()`: 기본 구조 검증 수행
- 설정 파일이 탈취/변조되면 임의의 `command`/`args`가 실행될 수 있음 — 이는 MCP 설계 자체의 특성

**3. OAuth / 인증**
- `mcp-oauth-provider.ts`: OAuth 토큰을 디스크에 저장 (`~/.pi/agent/` 경로)
- `mcp-callback-server.ts`: localhost HTTP 콜백 서버 구동
- `mcp-auth-flow.ts`: PKCE + Dynamic Client Registration 지원
- 토큰 저장 시 별도 암호화 없음 — 로컬 파일 권한에 의존 (표준 패턴이나 민감한 정보 노출 위험)

**4. 번들된 JS**
- `app-bridge.bundle.js` (408KB): MCP SDK + Zod를 번들링한 브라우저 통신용
- CDN 의존을 피하기 위한 설계 결정 — 합리적이나 번들 내용에 대한 신뢰 필요

**5. 네트워크 접근**
- HTTP MCP 서버 연결 (`StreamableHTTPClientTransport`, `SSEClientTransport` fallback)
- Bearer token / OAuth 기반 인증
- localhost 콜백 서버 (OAuth 리다이렉트)

#### 코드 품질 평가

| 항목 | 평가 |
|------|------|
| 에러 처리 | ✅ 전반적으로 우수, try/catch 적절히 사용 |
| 리소스 정리 | ✅ `gracefulShutdown()`, `closeAll()`, transport cleanup |
| 타입 안전성 | ✅ TypeScript strict, typebox/zod 검증 |
| 테스트 커버리지 | ✅ 178+ 테스트, OAuth/lifecycle/UI 전반 |
| 동시성 처리 | ✅ Connect dedup, in-flight tracking, generation check |
| 알려진 이슈 | ⚠️ 32개 open issues (OAuth EADDRINUSE, config merge, import cycle 등) |

#### 현재 프로젝트와의 호환성

| 항목 | 상태 |
|------|------|
| Pi 확장 구조 | ✅ `pi.extensions: ["./index.ts"]` 정확히 일치 |
| 의존성 버전 | ✅ `@earendil-works/*` 0.74.x 사용 |
| 통합 패턴 | ✅ Pattern B (`node_modules/` git 의존성) 선례 있음 — `pi-lsp-client` |
| 기존 MCP 상태 | 현재 없음 (과거 의도적 제외 → 이제 표준으로 재평가) |

### Constraints

- **보안**: 사용자의 주요 관심사. Supply chain + 코드 안전성 모두 확인 필요
- **활성화 모드**: Enabled by default (설치 시 MCP 설정 파일 자동 읽기)
- **통합 패턴**: Pattern B (외부 git 의존성 번들링)
- **과거 결정**: 2026-04-24 MCP를 의도적으로 제외했었음 → 이제 Pi 생태계에서 사실상 표준이 되었고 lazy/direct tools로 토큰 비용 문제 해결되었다고 판단

### Success Criteria

1. 저장소의 보안 위험이 허용 가능한 수준임을 확인
2. Supply chain에 이상 징후가 없음을 확인
3. Pattern B 통합이 기술적으로 가능함을 확인
4. Enabled by default 모드의 공격 표면을 이해하고 문서화

### Open Questions

1. `@modelcontextprotocol/ext-apps` (MCP UI)의 안정성 — 비교적 새 패키지이므로 UI 기능 비활성화 옵션 검토 가능
2. OAuth 토큰 디스크 저장 시 암호화 부재 — 로컬 개발 환경에서 허용 가능한지 팀 합의 필요

### Security Verdict: ✅ 조건부 승인

**전체 평가: 포함해도 안전함 (conditionally safe to include)**

**승인 근거:**
- 모든 핵심 의존성이 공식/신뢰 패키지
- 코드 품질 높음, 에러 처리 우수, 활발한 유지보수
- Supply chain 이상 징후 없음
- Pi 확장 API를 정확히 따르는 표준 구조

**권장 완화 조치:**
1. **환경변수 범위 제한 검토**: `resolveEnv()`가 전체 `process.env`를 상속 — 민감한 변수 제외 옵션 검토
2. **MCP UI opt-out**: `@modelcontextprotocol/ext-apps` 의존성 제거 또는 비활성화 옵션 고려 (408KB 번들 + 추가 공격 표면)
3. **OAuth credential 보호**: 토큰 저장 경로에 대한 파일 권한 확인 로직 추가 검토
4. **Config file 검증**: `enabled by default` 모드이므로 설정 파일 무결성 확인 로직 강화

### Complexity Assessment

| Signal | Low (1) | Medium (2) | High (3) |
|--------|---------|-----------|----------|
| **Scope breadth** | ✅ 단일 확장 추가 | | |
| **File impact** | | ✅ 4-8 files (package.json, README, bundledDependencies, pi.extensions) | |
| **Interface boundaries** | ✅ 기존 인터페이스 내 동작 | | |
| **Dependency depth** | ✅ 선형 의존 (패키지 추가 + 등록) | | |
| **Risk surface** | | ✅ 외부 저장소 의존 + MCP 프로토콜 통합 | |

**Score:** 8 (Simple 상한)
**Verdict:** Simple
**Rationale:** Pattern B 선례가 이미 존재하며 (`pi-lsp-client`), 확장이 Pi 표준 구조를 따르므로 통합 작업 자체는 간단함. 보안 평가는 이 Brief에서 이미 완료.

### Suggested Next Step

Proceed to `agentic-plan-crafting` — task fits in a single plan cycle.

통합 구현은 Pattern B 선례(`pi-lsp-client`)를 그대로 따르면 되며, `package.json`에 의존성 추가 + `bundledDependencies` 등록 + `pi.extensions` 배열에 경로 추가 + README 업데이트가 주요 작업입니다.
