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
- [x] **Phase 159: Lock Timeout + Canonical Key Derivation** - Lock acquisition is bounded and all file/directory keys resolve to canonical path-based identities. (completed 2026-05-27)
- [x] **Phase 160: Folder Locks + Manage Directory Migration** - Folder operations coordinate safely with descendant file writes using shared/exclusive advisory locks. (completed 2026-05-27)
- [x] **Phase 161: Destination Locks + EXDEV Fallback** - Create, copy, and move operations lock destination paths and move safely across devices. (completed 2026-05-27)
- [x] **Phase 162: Version-fingerprint Check** - Reads and writes expose version tokens and callers can opt into conflict detection. (completed 2026-05-27)
- [x] **Phase 163: Multi-file Batch Contract** - Batch tools accept mixed identifier/token inputs and return ordered per-item results. (completed 2026-05-27)
- [ ] **Phase 164: Close gap: document repair and plugin reconciliation lock contract** - Repair and reconciliation write side effects use the same ambient file + ancestor directory lock contract as normal document writes. (planned)

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

**Plans**: 5 plans

Plans:

- [x] 159-01-PLAN.md — Canonical file and directory lock-key derivation with `T-U-006` through `T-U-010`.
- [x] 159-02-PLAN.md — Configurable bounded lock acquisition with `T-U-014` and `T-U-015`.
- [x] 159-03-PLAN.md — Single-document write/copy/move `lock_timeout` response envelopes.
- [x] 159-04-PLAN.md — Batch archive/remove and compound `lock_timeout` response envelopes.
- [x] 159-05-PLAN.md — Integration and directed scenario evidence for `T-I-009`, `T-I-010`, and `D-WCO-02`.

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
  - Required execution evidence: `npm run test:integration -- --grep "folder-lock|manage-directory-advisory"`; passing integration scenario `INT-WCO-01`.

**Plans**: 4 plans

Plans:
**Wave 1**

- [x] 160-01-PLAN.md — Add shared/exclusive directory advisory-lock facade helpers.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 160-02-PLAN.md — Wrap file-writing paths with shared ancestor directory locks and add shared-lock folder integration tests.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 160-03-PLAN.md — Add `manage_directory` rename/move workflow, migrate structural folder operations to exclusive advisory locks, and preserve response shape.

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 160-04-PLAN.md — Add passing `INT-WCO-01` concurrent rename/move scenario coverage and final Phase 160 validation evidence.

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

**Plans**: 4 plans

Plans:

**Wave 1**

- [x] 161-01-PLAN.md — REQ-008 source assertions, sorted multi-lock proof, and create/copy/move lock-order comments.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 161-02-PLAN.md — REQ-022 EXDEV fallback unit coverage and narrow `move_document` hardening.
- [x] 161-03-PLAN.md — REQ-008 destination race integration coverage for create, copy, move, and sorted move locks.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 161-04-PLAN.md — REQ-022 integration coverage, D-WCO-03 directed scenario, and final Phase 161 evidence.

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

**Plans**: 6 plans

Plans:
- [x] 162-01-PLAN.md — Unit contract for response tokens, schemas, conflict envelopes, whole-file hashes, and read-no-lock behavior.
- [x] 162-02-PLAN.md — Integration and directed scenario contracts for Test Plan §4.2.1 through §4.2.7.
- [x] 162-03-PLAN.md — Read-side `version_token` plumbing and token-equals-disk repair invariant.
- [x] 162-04-PLAN.md — Top-level document tool `expected_version` / `if_match` checks and success tokens.
- [x] 162-05-PLAN.md — Compound document tool version checks and targeted conflict regions.
- [x] 162-06-PLAN.md — Scanner zero-write stability, directed scenario closure, and final validation evidence.

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

**Plans**: 4 plans

Plans:

- [x] 163-01-PLAN.md — Shared mixed batch contracts, schema widening, and T-U-026/T-U-027 unit coverage.
- [x] 163-02-PLAN.md — archive_document/remove_document per-item batch envelopes and T-I-034 through T-I-037 coverage.
- [x] 163-03-PLAN.md — insert_doc_link/apply_tags mixed input handling, help updates, and T-I-038 coverage.
- [x] 163-04-PLAN.md — INT-WCO-02/INT-WCO-03 scenario coverage and final Phase 163 evidence.

### Phase 164: Close gap: document repair and plugin reconciliation lock contract

**Goal**: Every FlashQuery-mediated vault-file write that can happen as a side effect of read-triggered repair or plugin reconciliation runs under the same coherency contract as normal document writes: shared ancestor directory locks outside a per-file `withDocumentLock`, then the single durable `writeVaultFile` primitive. `get_document` remains read-lock-free unless a repair write is actually required.
**Depends on**: Phases 155, 156, 157, 160, 162
**Requirements**: REQ-001, REQ-007, REQ-009, REQ-014, REQ-020, REQ-023
**Source Requirements**: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Requirements.md`
**Source Test Plan**: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Vault Write Coherency Locking Research/Vault Write Coherency Locking Test Plan.md`
**Success Criteria** (what must be TRUE):

  1. A `get_document` cache-hit/read-only path still takes no document lock, preserving INV-07 and Test Plan `T-U-037`.
  2. A `get_document` path that triggers `targetedScan` frontmatter repair takes shared ancestor directory locks and the per-file document lock before the repair write reaches `writeVaultFile`.
  3. The repaired file's returned `version_token`, `fqc_documents.content_hash`, and on-disk bytes still match exactly, preserving REQ-014 and Test Plan `T-I-026` through `T-I-028` plus `D-WCO-06`.
  4. Plugin reconciliation frontmatter writes (`atomicWriteFrontmatter` from `plugin-reconciliation.ts`) take the document-path lock contract, not only the plugin coordination lock, before reaching `writeVaultFile`.
  5. `writeVaultFile` remains a primitive with an ambient-lock assertion, not a lock-acquiring API; callers must acquire the correct lock contract before invoking it.
  6. Existing Phase 157 behavior remains intact: memory needs no document lock, record/plugin reconciliation remains serialized where required, and concurrent plugin unregister behavior is unchanged.

**Reasoning**:

  - REQ-001 and REQ-009 make the individual document path the write-locking unit and require document-touching write call sites to use the lock helper. The gap is not in the main `write_document` handler; it is in helper paths that write files indirectly.
  - REQ-007 says file writes hold shared locks on ancestor folders so folder structural operations cannot move a file during a write. Repair/reconciliation frontmatter writes are file writes and must participate.
  - REQ-014 explicitly calls out `get_document` -> `targetedScan` repair: if repair writes, the post-write hash is the value returned and stored. That token correctness must be preserved while adding the missing ambient lock.
  - REQ-020 says all vault writes route through `writeVaultFile`, but `writeVaultFile`'s own contract says callers must already hold `withDocumentLock`; passing `lockConfig` is an assertion hook, not lock acquisition.
  - REQ-023 replaced coarse records/plugins locks with scoped coordination. That protects reconciliation sequencing, but it does not by itself serialize writes against normal document tools touching the same markdown file.

**Test Gate**:

  - Create or update tests aligned to Test Plan §4.1.1, §4.1.7, §4.1.9, §4.2.4, §4.4.1, and §4.5.1.
  - Required targeted coverage:
    - `T-U-037` remains green: `get_document` handler does not acquire locks for pure reads.
    - Add a regression proving read-triggered repair writes hold the document lock before `writeVaultFile` assertion executes.
    - Add a regression proving read-triggered repair also holds shared ancestor directory locks, or a source-order guard equivalent if advisory visibility is environment-gated.
    - Extend `T-I-026`, `T-I-027`, and `T-I-028` so the repair-token round trip still passes with lock assertions enabled.
    - Extend `T-I-040` / `T-U-030` style write-path evidence so `targetedScan` repair and plugin reconciliation frontmatter writes are counted as `writeVaultFile` callers with ambient locks held.
    - Extend `T-I-044` or add focused integration coverage for concurrent `write_record` reconciliation and document writes to the same file: no lost owner/type/frontmatter changes, no missing lock assertion.
  - Required execution evidence: `FQC_LOCK_ASSERT=true npm test -- tests/unit/document-output-version-token.test.ts tests/unit/get-document-no-lock.test.ts tests/unit/single-write-primitive.test.ts`; focused integration for `token-equals-disk`, `atomic-write-frontmatter`, and records reconciliation; `D-WCO-06` if the directed scenario remains applicable.

**Plans**: 3 plans

Plans:

**Wave 1**

- [ ] 164-01-PLAN.md — Lock get_document repair writes while preserving read-lock-free cache-hit paths.
- [ ] 164-02-PLAN.md — Lock plugin reconciliation frontmatter writes while preserving REQ-023 coordination.

**Wave 2** *(blocked on Wave 1 completion)*

- [ ] 164-03-PLAN.md — Run combined focused validation, D-WCO-06 evidence, and final source audit.

## Progress

**Execution Order:**
Phases execute in numeric order: 155 → 156 → 157 → 158 → 159 → 160 → 161 → 162 → 163 → 164

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 155. Per-file Tier 1 + Live-defect Close | 3/3 | Complete   | 2026-05-26 |
| 156. Atomic + Durable Write Primitive Consolidation | 3/3 | Complete    | 2026-05-26 |
| 157. Records / Memory / Plugins Audit + Guards | 0/TBD | Not started | - |
| 158. Tier 2 + Lock-table Retirement + Session Check | 6/6 | Complete   | 2026-05-26 |
| 159. Lock Timeout + Canonical Key Derivation | 5/5 | Complete    | 2026-05-27 |
| 160. Folder Locks + Manage Directory Migration | 4/4 | Complete   | 2026-05-27 |
| 161. Destination Locks + EXDEV Fallback | 4/4 | Complete    | 2026-05-27 |
| 162. Version-fingerprint Check | 6/6 | Complete    | 2026-05-27 |
| 163. Multi-file Batch Contract | 4/4 | Complete    | 2026-05-27 |
| 164. Close gap: document repair and plugin reconciliation lock contract | 0/3 | Not started | - |

## Archived Milestone Details

- [v3.8 ROADMAP archive](milestones/v3.8-ROADMAP.md)
- [v3.8 REQUIREMENTS archive](milestones/v3.8-REQUIREMENTS.md)
- [v3.8 milestone audit](milestones/v3.8-MILESTONE-AUDIT.md)
- [v3.8 phase artifacts](milestones/v3.8-phases/)
- [v3.7 ROADMAP archive](milestones/v3.7-ROADMAP.md)
- [v3.7 REQUIREMENTS archive](milestones/v3.7-REQUIREMENTS.md)
- [v3.7 milestone audit](milestones/v3.7-MILESTONE-AUDIT.md)
