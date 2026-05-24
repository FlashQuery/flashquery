# Phase 147 Final Validation

**Plan:** 147-04  
**Captured:** 2026-05-24T16:47:52Z  
**Purpose:** Close REQ-006 and REQ-007 with final audit, outdated, Knip, type/lint, macro, and preflight evidence.

## Command Evidence

### T-C-001: `npm audit`

- **Command:** `npm audit`
- **Exit code:** 0
- **Result:** Passed; `found 0 vulnerabilities`.
- **REQ coverage:** REQ-006

### T-C-002: `npm audit --omit=dev`

- **Command:** `npm audit --omit=dev`
- **Exit code:** 0
- **Result:** Passed; `found 0 vulnerabilities`.
- **REQ coverage:** REQ-006

### T-C-003: `npm outdated`

- **Command:** `npm outdated`
- **Exit code:** 1
- **Result:** Documented residual drift only.

| Package | Current | Wanted | Latest | Dependency path | Rationale |
|---------|---------|--------|--------|-----------------|-----------|
| `@modelcontextprotocol/sdk` | 1.27.1 | 1.29.0 | 1.29.0 | `flashquery -> @modelcontextprotocol/sdk` | Wanted drift deferred to Phase 148 because typed MCP `registerTool` wrapper consolidation has not landed. Updating now would hide SDK signature drift behind broad `(server as any).registerTool` wrapping or smuggle REQ-008 into Phase 147. |
| `uuid` | 13.0.2 | 13.0.2 | 14.0.0 | `flashquery -> uuid` | No wanted drift remains; this is latest-major-only drift and REQ-006 does not require major updates when the wanted tree is clean and audit is green. |

### T-C-004: `npm run typecheck` and `npm run lint`

| Command | Exit code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | Passed; `tsc --noEmit` completed with no errors. |
| `npm run lint` | 0 | Passed; `eslint src/ --max-warnings 0` completed with no warnings or errors. |

### T-C-005: `npm run knip`

- **Command:** `npm run knip`
- **Exit code:** 0
- **Result:** Passed; `knip --include files,dependencies,unlisted,binaries,unresolved --no-config-hints` produced no actionable findings.
- **Policy:** This is the staged file/dependency/unlisted/binary/unresolved-import gate from Plan 147-02. Full export reporting remains documented in `147-dependency-baseline.md` for later API-surface triage.
- **REQ coverage:** REQ-007

### T-C-006: `npm run preflight`

- **Command:** `npm run preflight`
- **Exit code:** 0
- **Result:** Passed.
- **Knip inclusion evidence:** `preflight` ran `npm run lint && npm run typecheck && npm run knip && npm run preflight:test && npm run preflight:pack && npm run preflight:docker`.
- **Preflight test result:** 142 test files passed, 1,971 tests passed.
- **Package dry-run result:** `Package contents OK`.
- **Docker result:** `Docker not found — skipping compose validation`.
- **REQ coverage:** REQ-007

### T-U-013: Macro parser regression

- **Command:** `npm test -- --run tests/unit/macro-parser.test.ts`
- **Exit code:** 0
- **Result:** Passed; 1 test file, 35 tests.
- **REQ coverage:** REQ-006

### T-U-014: Macro framework regression

- **Command:** `npm run test:macro-framework`
- **Exit code:** 0
- **Result:** Passed; 1 test file, 518 tests.
- **REQ coverage:** REQ-006

## MCP SDK Decision Evidence

- `@modelcontextprotocol/sdk` remains declared as `^1.27.1` and installed at `1.27.1`.
- `src/mcp/server.ts` still contains the broad correlation wrapper branch that wraps `server.tool` and assigns `(server as any).registerTool`.
- `.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` keep REQ-008 and REQ-009 pending in Phase 148.
- The detailed decision is recorded in `147-dependency-baseline.md` under `Plan 147-04: MCP SDK deferred to Phase 148`.

## Residual Advisory and Drift Review

| Category | Status | Rationale |
|----------|--------|-----------|
| Full npm audit | Green | `npm audit` found 0 vulnerabilities. |
| Production npm audit | Green | `npm audit --omit=dev` found 0 vulnerabilities. |
| Wanted-version drift | Documented residual | Only `@modelcontextprotocol/sdk` has wanted drift, intentionally deferred to Phase 148 per REQ-006. |
| Latest-major drift | Documented residual | `uuid` v14 is latest-major-only drift while current and wanted are both 13.0.2; no advisory remains. |
| Knip | Green staged gate | `npm run knip` passed; full export reporting is documented but not part of the current preflight gate. |
| Preflight | Green | `npm run preflight` passed and directly included Knip. |
