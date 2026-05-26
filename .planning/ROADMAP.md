# Roadmap: FlashQuery Core

## Milestones

- ✅ **v1.0 MVP** — Phases 1-9 (shipped 2026-03-25)
- ✅ **v1.5 Full MVP** — Phases 10-16 (shipped 2026-03-27)
- ✅ **v1.6 Prep for Open Source** — Phases 17-21 (shipped 2026-03-30)
- ✅ **v1.7 Issues Resolution & Pre-Release Hardening** — Phases 22-25 (shipped 2026-03-31)
- ✅ **v1.8 Bug Fixes: Plugin Scope & Token Security** — Phases 28-29 (shipped 2026-04-01)
- ✅ **v1.9 MCP Tool Overhaul** — Phases 30-33 (shipped 2026-04-06)
- ✅ **v2.0 Doc Sync Overhaul** — Phases 36-40 (shipped 2026-04-07)
- ✅ **v2.1 Test Suite Recovery** — Phases 41-44 (shipped 2026-04-07)
- ✅ **v2.2 Status Model Refactor & Infrastructure Hardening** — Phases 45-48 (shipped 2026-04-08)
- ✅ **v2.3 HTTP Authentication & Interoperability** — Phases 49-52 (shipped 2026-04-09)
- ✅ **v2.4 Plugin Discovery & Document Interoperability** — Phases 54-60b + code review (shipped 2026-04-12)
- ✅ **v2.5 New MCP Document Tools** — Phases 61-68 (shipped 2026-04-13)
- ✅ **v2.5.1 Gap Closure & Test Maintenance** — Phases 69-71 (shipped 2026-04-14)
- ✅ **v2.6 Test Infrastructure & Quality** — Phases 72-80 (shipped 2026-04-15)
- ✅ **v2.7 Name Change & Pre-Launch Preparation** — Phase 83 (shipped 2026-04-16)
- ✅ **v2.8 Plugin Callback Overhaul** — Phases 84-89 (shipped 2026-04-21)
- ✅ **v2.9 Filesystem Primitive Tools** — Phases 90-97 (shipped 2026-04-25)
- ✅ **v3.0 Native LLM Access** — Phases 98-106 (shipped 2026-04-30)
- ✅ **v3.1 Call Model With Reference** — Phases 107-111 (shipped 2026-05-05)
- ✅ **v3.2 Agentic LLM Tools** — Phases 112-120 (shipped 2026-05-07)
- ✅ **v3.3 MCP Tools Consolidation** — Phases 121-129 (shipped 2026-05-14)
- ✅ **v3.4 macro-support** — Phases 130-138 (shipped 2026-05-17)
- ✅ **v3.5 MCP Broker** — Phases 139-143 (shipped 2026-05-19)
- ✅ **v3.6 Bug Fixes & Host Parity** — Phase 144 (shipped 2026-05-24)
- ✅ **v3.7 Technical Debt** — Phases 145-150 (shipped 2026-05-25)
- ✅ **v3.8 Codebase Audit Remaining Remediation** — Phases 151-154 (shipped 2026-05-26)
- 🚧 **v3.9 Vault Write Coherency Locking** — Phases 155-163 (planned)

## Current Milestone

### v3.9 Vault Write Coherency Locking

**Milestone Goal:** Rebuild FlashQuery's vault write coherency layer with per-file locking, Postgres advisory cross-process exclusion, durable atomic writes, opt-in version-token conflict detection, and uniform batch semantics.

## Phases

- [x] **Phase 155: Per-file Tier 1 + Live-defect Close** - Same-process document writes serialize per file, and unlocked compound document mutations stop losing updates. (completed 2026-05-26)
- [x] **Phase 156: Atomic + Durable Write Primitive Consolidation** - Every vault write uses one durable atomic write path that surfaces failures. (completed 2026-05-26)
- [x] **Phase 157: Records / Memory / Plugins Audit + Guards** - Non-file subsystems remain coherent after the legacy lock table is removed. (completed 2026-05-26)
- [x] **Phase 158: Tier 2 + Lock-table Retirement + Session Check** - Cross-process writes use session-scoped Postgres advisory locks and the old lock table/CLI disappears. (completed 2026-05-26)
- [ ] **Phase 159: Lock Timeout + Canonical Key Derivation** - Lock acquisition is bounded and all file/directory keys resolve to canonical path-based identities.
- [ ] **Phase 160: Folder Locks + Manage Directory Migration** - Folder operations coordinate safely with descendant file writes using shared/exclusive advisory locks.
- [ ] **Phase 161: Destination Locks + EXDEV Fallback** - Create, copy, and move operations lock destination paths and move safely across devices.
- [ ] **Phase 162: Version-fingerprint Check** - Reads and writes expose version tokens and callers can opt into conflict detection.
- [ ] **Phase 163: Multi-file Batch Contract** - Batch tools accept mixed identifier/token inputs and return ordered per-item results.

## Phase Details

### Phase 155: Per-file Tier 1 + Live-defect Close

**Goal**: Users can run concurrent document mutations without same-process writes to unrelated files blocking each other or compound tag/link updates silently overwriting changes.
**Depends on**: Phase 154
**Requirements**: REQ-001, REQ-009, REQ-010, REQ-025
**Success Criteria** (what must be TRUE):

  1. Two concurrent writes to different documents can both complete without a shared global document lock.
  2. Two concurrent writes to the same document serialize so the later write observes the earlier write's bytes.
  3. Concurrent `apply_tags` or `insert_doc_link` calls on one document never silently lose updates.
  4. `call_macro` relies on the called tools' per-file locks and exposes no macro-spanning lock behavior.

**Test Gate**:

  - Create or update the Test Plan §4.1.1, §4.1.9, §4.1.10, and §4.1.11 cases: `T-U-001`, `T-U-002`, `T-U-016` through `T-U-019`, `T-U-038`, `T-I-001`, `T-I-002`, `T-I-017`, `T-I-018`, `T-I-049` through `T-I-051`, `T-S-001`, `T-S-004`, and `T-S-008`.
  - Include Phase 155 scaffolding checks for basic lock-key behavior from Test Plan §4.1.3 where needed, but full REQ-003 completion remains Phase 159.
  - Required execution evidence: `npm test -- --grep "document-lock|with-document-lock|macro-no-lock"`; `npm run test:integration -- --grep "per-file|apply-tags|insert-doc-link|call-macro-per-step"`; directed scenarios for `D-WCO-01`, `D-WCO-04`, and `D-WCO-08` when those scenarios land.

**Plans**:

  - `155-01-PLAN.md` — Document-lock facade, helper tests, and scanner repair integration.
  - `155-02-PLAN.md` — Document/compound call-site migration and macro no-lock guard.
  - `155-03-PLAN.md` — Directed scenarios, coverage rows, and final Phase 155 evidence.

### Phase 156: Atomic + Durable Write Primitive Consolidation

**Goal**: Users never see torn vault files, and any failed vault write is reported instead of disappearing behind a swallowed error.
**Depends on**: Phase 155
**Requirements**: REQ-020, REQ-021
**Success Criteria** (what must be TRUE):

  1. A successful vault write leaves either the previous complete file or the new complete file visible, never a partial file.
  2. Frontmatter repair, scanner repair, document writes, and plugin reconciliation writes all use the same durable write behavior.
  3. A simulated filesystem write, fsync, or rename failure returns an error to the caller.
  4. Successful write responses can be tied to the SHA-256 hash of the bytes actually committed.

**Test Gate**:

  - Create or update the Test Plan §4.4.1 and §4.4.2 cases: `T-U-028` through `T-U-033`, `T-I-039`, `T-I-040`, and `T-I-041`.
  - Execution must verify both primitive-level behavior and representative caller routing through the primitive.
  - Required execution evidence: `npm test -- --grep "vault-write|atomic-write|durable"`; `npm run test:integration -- --grep "frontmatter-write|vault-write-durable|atomic-write"`.

**Plans**: 3 plans
Plans:

- [x] 156-01-PLAN.md — Durable `writeVaultFile` primitive, unit coverage, and macOS F_FULLFSYNC decision checkpoint.
- [x] 156-02-PLAN.md — Migrate VaultManager, frontmatter, resolver repair, and plugin reconciliation write paths.
- [x] 156-03-PLAN.md — Static write-path guard, integration routing/cleanup evidence, and final Phase 156 audit summary.

### Phase 157: Records / Memory / Plugins Audit + Guards

**Goal**: Users can keep using records, memory, and plugin operations safely after the old coarse lock table is removed.
**Depends on**: Phase 156
**Requirements**: REQ-023
**Success Criteria** (what must be TRUE):

  1. Concurrent memory writes rely on the existing transactional/versioning behavior and do not need the old lock table.
  2. Record operations that run plugin reconciliation do not produce inconsistent reconciliation state under concurrency.
  3. Concurrent plugin unregister operations leave either a complete unregister result or a clear conflict/error, not half-deleted plugin state.

**Test Gate**:

  - Create or update the Test Plan §4.5.1 cases: `T-U-036`, `T-I-043`, `T-I-044`, and `T-I-045`.
  - Execution must include the concurrency review artifact required by REQ-023 and prove no coarse `records`, `memory`, or `plugins` lock literals remain.
  - Required execution evidence: `npm test -- --grep "no-coarse-resource-locks"`; `npm run test:integration -- --grep "memory-no-coarse-lock|records-reconciliation|unregister-plugin"`.

**Plans**: 3 plans
Plans:

- [x] 157-01-PLAN.md — Remove redundant memory coarse lock and prove RPC-backed concurrent updates.
- [x] 157-02-PLAN.md — Add records reconciliation audit, scoped plugin coordination guard, and records race coverage.
- [x] 157-03-PLAN.md — Guard concurrent plugin unregister and add final no-coarse-resource-locks gate.

### Phase 158: Tier 2 + Lock-table Retirement + Session Check

**Goal**: Users running multiple FlashQuery processes against one vault get real cross-process exclusion through Postgres advisory locks, with stale table locks and manual unlocks gone.
**Depends on**: Phases 155, 156, 157
**Requirements**: REQ-002, REQ-004, REQ-005
**Success Criteria** (what must be TRUE):

  1. Two FlashQuery processes writing the same file serialize through a session-scoped Postgres advisory lock.
  2. FlashQuery startup removes the obsolete `fqc_write_locks` table if present and no tool depends on it.
  3. A transaction-mode Postgres pooler configuration fails startup with a clear session-capability error.
  4. The `flashquery unlock` command is no longer available because crashed advisory locks release with the database session.

**Test Gate**:

  - Create or update the Test Plan §4.1.2, §4.1.4, and §4.1.5 cases: `T-U-003` through `T-U-005`, `T-U-011` through `T-U-013`, and `T-I-003` through `T-I-008`.
  - Execution must prove advisory-lock acquire/release behavior, startup self-test pass/fail behavior, and full retirement of `fqc_write_locks` / `flashquery unlock`.
  - Required execution evidence: `npm test -- --grep "advisory-lock|lock-startup|legacy-write-lock"`; `npm run test:integration -- --grep "two-tier|fqc-write-locks-drop|lock-startup|session-capable"`.

**Plans**: 6 plans
Plans:
**Wave 1**

- [x] 158-01-PLAN.md — Native Tier 2 advisory-lock implementation and REQ-002 tests.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 158-02-PLAN.md — Legacy `fqc_write_locks`, `write-lock`, unlock CLI, schema, and TTL config retirement.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 158-03-PLAN.md — Session-capable startup self-test, failure behavior, docs, and REQ-005 tests.
- [x] 158-04-PLAN.md — Stale legacy write-lock behavior test cleanup.
- [x] 158-05-PLAN.md — Config/schema/fixture expectation cleanup after lock-table retirement.
- [x] 158-06-PLAN.md — Phase 157 gap-fix test alignment with legacy lock retirement.

### Phase 159: Lock Timeout + Canonical Key Derivation

**Goal**: Contended writes return predictably instead of hanging, and all lock participants agree on the same canonical file or directory identity.
**Depends on**: Phase 158
**Requirements**: REQ-003, REQ-006
**Success Criteria** (what must be TRUE):

  1. A writer waiting longer than the configured lock timeout receives a structured `lock_timeout` or resource-busy response.
  2. Existing-file paths that differ by symlink, `.`/`..`, or case on case-insensitive filesystems resolve to the same file lock.
  3. Not-yet-existing destinations lock by real parent path plus basename.
  4. File and directory locks use separate namespaces so the same path cannot collide across resource types.

**Test Gate**:

  - Create or update the Test Plan §4.1.3 and §4.1.6 cases: `T-U-006` through `T-U-010`, `T-U-014`, `T-U-015`, `T-I-009`, `T-I-010`, and `T-S-002`.
  - Execution must prove full canonical key derivation, default/configured timeout behavior, and the case-variant directed scenario where supported by the filesystem.
  - Required execution evidence: `npm test -- --grep "canonical-key|case-fold|symlink|lock-timeout"`; `npm run test:integration -- --grep "lock-timeout"`; directed scenario `D-WCO-02` when the environment supports the case-insensitive path behavior.

**Plans**: TBD

### Phase 160: Folder Locks + Manage Directory Migration

**Goal**: Users can perform folder operations without racing in-flight descendant file writes, while unrelated file writes continue concurrently.
**Depends on**: Phase 158
**Requirements**: REQ-007, REQ-024
**Success Criteria** (what must be TRUE):

  1. A folder rename, move, or delete waits for an in-flight write under that folder or returns the configured timeout response.
  2. Concurrent writes under the same folder can proceed together because they hold compatible shared directory locks.
  3. Two structural operations on the same folder do not both proceed at once.
  4. `manage_directory` preserves its caller-visible contention/conflict response shape after moving to advisory directory locks.

**Test Gate**:

  - Create or update the Test Plan §4.1.7 and §4.5.2 cases: `T-I-011` through `T-I-013`, `T-I-046`, `T-I-047`, and `T-Y-001`.
  - Execution must prove shared file-write directory locks, exclusive structural directory locks, and unchanged `manage_directory` conflict semantics.
  - Required execution evidence: `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"`; integration scenario `INT-WCO-01` when the YAML scenario lands.

**Plans**: TBD

### Phase 161: Destination Locks + EXDEV Fallback

**Goal**: Users cannot accidentally overwrite destination paths through races, and cross-device moves preserve atomic durable semantics.
**Depends on**: Phases 158, 160
**Requirements**: REQ-008, REQ-022
**Success Criteria** (what must be TRUE):

  1. Concurrent creates, copies, or moves to the same destination produce one success and one conflict/timeout, not two writers racing into the path.
  2. Moving a document locks both source and destination in deterministic canonical order.
  3. A cross-device move commits the destination durably before removing the source.
  4. Destination existence checks happen inside the destination lock.

**Test Gate**:

  - Create or update the Test Plan §4.1.8 and §4.4.3 cases: `T-U-034`, `T-U-035`, `T-I-014` through `T-I-016`, `T-I-042`, `T-I-048`, and `T-S-003`.
  - Execution must prove destination race prevention for create/copy/move, sorted multi-lock acquisition, and EXDEV fallback safety.
  - Required execution evidence: `npm test -- --grep "move-exdev-fallback"`; `npm run test:integration -- --grep "destination-lock|move-exdev"`; directed scenario `D-WCO-03` when it lands.

**Plans**: TBD

### Phase 162: Version-fingerprint Check

**Goal**: Users can detect read-to-write conflicts with `version_token` while existing callers can continue using last-writer-wins behavior when they omit the token.
**Depends on**: Phases 155, 156, 158
**Requirements**: REQ-011, REQ-012, REQ-013, REQ-014, REQ-015, REQ-016, REQ-017
**Success Criteria** (what must be TRUE):

  1. `get_document` and successful file-affecting writes return a `version_token` matching the current on-disk bytes.
  2. A write with a matching `expected_version` or `if_match` succeeds, while a stale token refuses the write without modifying the file.
  3. Conflict responses include the current token and the caller-relevant current region needed to retry safely.
  4. Version checks run after lock acquisition against fresh disk bytes, including external file changes.
  5. Two consecutive scans of an unchanged vault perform no file writes.

**Test Gate**:

  - Create or update the Test Plan §4.2.1 through §4.2.7 cases: `T-U-020` through `T-U-025`, `T-U-037`, `T-I-019` through `T-I-033`, and `T-S-005` through `T-S-007`.
  - Execution must prove response shape, opt-in write preconditions, check-inside-lock behavior, token-equals-disk invariants, conflict envelopes, whole-file hash semantics, and scanner zero-write stability.
  - Required execution evidence: `npm test -- --grep "version-token|expected-version|conflict-envelope|get-document-no-lock"`; `npm run test:integration -- --grep "version-token|version-check|token-equals-disk|refused-write|scanner-zero-writes"`; directed scenarios `D-WCO-05`, `D-WCO-06`, and `D-WCO-07` when they land.

**Plans**: TBD

### Phase 163: Multi-file Batch Contract

**Goal**: Users get predictable best-effort batch behavior with item-level success, conflict, or failure results in input order.
**Depends on**: Phase 162
**Requirements**: REQ-018, REQ-019
**Success Criteria** (what must be TRUE):

  1. Batch calls return one ordered result entry for every input item.
  2. Each batch item reports `succeeded`, `conflicted`, or `failed` with the appropriate token or error envelope.
  3. Batch inputs can mix bare identifiers and `{ identifier, version_token }` objects in one call.
  4. Existing callers that pass strings or string arrays continue to work unchanged.

**Test Gate**:

  - Create or update the Test Plan §4.3.1 and §4.3.2 cases: `T-U-026`, `T-U-027`, `T-I-034` through `T-I-038`, `T-Y-002`, and `T-Y-003`.
  - Execution must prove ordered best-effort item results, mixed bare/object input support, item-level version conflicts, and backward compatibility for existing string inputs.
  - Required execution evidence: `npm test -- --grep "batch-input-shape"`; `npm run test:integration -- --grep "batch-envelope|batch-input-shape"`; integration scenarios `INT-WCO-02` and `INT-WCO-03` when they land.

**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 155 → 156 → 157 → 158 → 159 → 160 → 161 → 162 → 163

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. Per-file Tier 1 + Live-defect Close | 3/3 | Complete   | 2026-05-26 |
| 156. Atomic + Durable Write Primitive Consolidation | 3/3 | Complete    | 2026-05-26 |
| 157. Records / Memory / Plugins Audit + Guards | 0/TBD | Not started | - |
| 158. Tier 2 + Lock-table Retirement + Session Check | 6/6 | Complete   | 2026-05-26 |
| 159. Lock Timeout + Canonical Key Derivation | 0/TBD | Not started | - |
| 160. Folder Locks + Manage Directory Migration | 0/TBD | Not started | - |
| 161. Destination Locks + EXDEV Fallback | 0/TBD | Not started | - |
| 162. Version-fingerprint Check | 0/TBD | Not started | - |
| 163. Multi-file Batch Contract | 0/TBD | Not started | - |

## Archived Milestone Details

- [v3.8 ROADMAP archive](milestones/v3.8-ROADMAP.md)
- [v3.8 REQUIREMENTS archive](milestones/v3.8-REQUIREMENTS.md)
- [v3.8 milestone audit](milestones/v3.8-MILESTONE-AUDIT.md)
- [v3.8 phase artifacts](milestones/v3.8-phases/)
- [v3.7 ROADMAP archive](milestones/v3.7-ROADMAP.md)
- [v3.7 REQUIREMENTS archive](milestones/v3.7-REQUIREMENTS.md)
- [v3.7 milestone audit](milestones/v3.7-MILESTONE-AUDIT.md)
