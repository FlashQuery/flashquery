# Requirements: FlashQuery Core v3.7 Technical Debt

**Defined:** 2026-05-24
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Source:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Requirements.md`
**Test Plan:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Tech Debt/Codebase Audit (23-May-2026)/Codebase Audit Priority Remediation Requirements/Codebase Audit Priority Remediation Test Plan.md`

## v3.7 Requirements

Requirements for the v3.7 Technical Debt milestone. Each requirement maps to exactly one roadmap phase, and each phase must land implementation and matching tests together.

### Silent Failure Remediation

- [ ] **REQ-001**: `write_memory` plugin-scope lookup failures hard-fail and are typed. `resolvePluginScope` distinguishes resolved scopes from lookup failures, avoids broad double assertions at the lookup site, and prevents failed lookups from inserting global-scoped memories.
- [ ] **REQ-002**: Scanner embed drain reports query failure as partial success. `EMBED-DRAIN` query errors continue the scan but return an explicit failure status such as `drain_query_failed`, with error-level logging and explicit caller/formatter handling.

### Embedding Reliability and Resource Lifecycle

- [ ] **REQ-003**: Background embedding uses a centralized durable helper. Document, memory, record, compound, and stale-hash re-embed paths route through one helper that records deferred/failure state, emits structured logs, and surfaces `warnings: ["embedding_deferred"]` when appropriate.
- [ ] **REQ-004**: Pending embeddings are retried and surfaced operationally. Pending embedding state covers documents, memories, and records; retry processing can populate embeddings and clear or retain failed rows; diagnostics report embedding-null rows without pending retry state.
- [ ] **REQ-005**: Direct `pg` usage for records is pooled. Record embedding updates and semantic `search_records` vector SQL borrow from a process-scoped pool or equivalent abstraction that preserves IPv4 behavior and owns release/shutdown handling.

### Dependency and Tooling Hygiene

- [ ] **REQ-006**: Dependency vulnerabilities and wanted-version drift are remediated. Current `npm audit` and `npm outdated` results are recorded, non-major updates are applied, Chevrotain v12 is handled separately with macro tests, MCP SDK drift is handled after typed wrapping, and remaining advisories are zero or explicitly documented.
- [ ] **REQ-007**: `knip` is configured for actionable local and preflight use. The project has a `knip` script/config that excludes worktrees/build/vendor noise, documents reachability policy, and is included in preflight or explicitly staged.

### MCP Lifecycle, Shutdown, and Architecture

- [ ] **REQ-008**: MCP server registration wrapping is consolidated and typed. Dead `server.tool` wrapping is removed, `registerTool` wrapping uses a typed function shape, and correlation-ID plus native-tool catalog behavior remains covered.
- [ ] **REQ-009**: Shutdown drains in-flight MCP requests with a 15-second deadline. In-flight request tracking waits for active handlers to settle, returns promptly when idle, and warns with remaining count on timeout.
- [ ] **REQ-010**: Document/plugin circular dependency cluster is broken. Shared document primitives move out of MCP tool modules so resolver, plugin propagation, and reconciliation modules no longer depend on `mcp/tools/documents.ts`.
- [ ] **REQ-011**: Macro circular dependency cluster is broken. Macro evaluator/type/helper imports are reorganized, likely through a narrow dependency-light builtin/types module, without changing parser, evaluator, permission, cancellation, or hard-exclusion behavior.

### Config Type Modeling

- [ ] **REQ-012**: Runtime-only config metadata is modeled without broad side-channel casts. Deprecation warnings, startup warnings, host tool exposure, and raw LLM API key refs move to explicit internal typing, symbol metadata, or a `WeakMap`, preserving existing accessors without leaking secrets.

## Future Requirements

Deferred to later milestones unless implementation reveals a small required adjacency.

- **TEST-AUDIT-01**: Audit test hygiene across the full test tree. The 23-May-2026 source audit intentionally scoped product source, not all tests.
- **PERF-01**: Run broader performance benchmarking beyond targeted resource-lifecycle checks for embedding and direct SQL paths.
- **DOCSPLIT-01**: Decompose `tools/documents.ts` beyond the cycle-breaking prerequisite tracked by REQ-010.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Unselected audit findings | v3.7 is scoped to the priority remediation handoff unless a touched file makes tiny incidental cleanup unavoidable. |
| New product features | This milestone is debt remediation before the next feature push. |
| Web UI | FlashQuery remains CLI + MCP only. |
| Accepting or dismissing audit findings | v3.7 implements selected remediations; audit adjudication is outside implementation scope. |

## Test Requirements

Every phase must bundle its own tests with implementation. Completion requires the relevant unit, integration, E2E, directed scenario, integration scenario, and command checks from the companion test plan.

| REQ | Required Test Coverage |
|-----|------------------------|
| REQ-001 | T-U-001..003, T-I-001, T-S-001 |
| REQ-002 | T-U-004..005, T-I-002 |
| REQ-003 | T-U-006..008, T-I-003..004, T-S-002 |
| REQ-004 | T-U-009..010, T-I-005..006 |
| REQ-005 | T-U-011..012, T-I-007..008, T-Y-001 |
| REQ-006 | T-U-013..014, T-C-001..004 |
| REQ-007 | T-U-015, T-C-005..006 |
| REQ-008 | T-U-016..018, T-E-001 |
| REQ-009 | T-U-019..020, T-I-009..011, T-S-003 |
| REQ-010 | T-U-021..022, T-I-012 |
| REQ-011 | T-U-023..025 |
| REQ-012 | T-U-026..029 |

## Traceability

Which phases cover which requirements. Updated during phase execution as statuses change.

| Requirement | Phase | Status |
|-------------|-------|--------|
| REQ-001 | Phase 145 | Pending |
| REQ-002 | Phase 145 | Pending |
| REQ-003 | Phase 146 | Pending |
| REQ-004 | Phase 146 | Pending |
| REQ-005 | Phase 146 | Pending |
| REQ-006 | Phase 147 | Pending |
| REQ-007 | Phase 147 | Pending |
| REQ-008 | Phase 148 | Pending |
| REQ-009 | Phase 148 | Pending |
| REQ-010 | Phase 149 | Pending |
| REQ-011 | Phase 149 | Pending |
| REQ-012 | Phase 150 | Pending |

**Coverage:**
- v3.7 requirements: 12 total
- Mapped to phases: 12
- Unmapped: 0

---
*Requirements defined: 2026-05-24*
*Last updated: 2026-05-24 after starting v3.7 Technical Debt milestone*
