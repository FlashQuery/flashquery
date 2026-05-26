---
type: test_plan
created: 2026-05-25
status: draft
feature: 'Vault Write Coherency Locking'
spec_doc: 'Vault Write Coherency Locking Requirements.md'
research_doc: 'Vault Write Coherency Locking Research.md'
poc_path: ''
depends_on: []
relates_to:
  - Research/Multi-Vault.md
tags:
  - '#type/test_plan'
---

# Vault Write Coherency Locking — Test Plan

## 1. Purpose & Sources

This Test Plan covers the Vault Write Coherency Locking feature as specified in the linked Requirements document. Each REQ in `Vault Write Coherency Locking Requirements.md` §6 maps to one or more test cases below, distributed across FlashQuery's five test layers. Acceptance criteria are not restated here — they live in the Requirements doc and are referenced by REQ ID and Spec section.

**Sources.**

- Requirements document: [Vault Write Coherency Locking Requirements.md](./Vault%20Write%20Coherency%20Locking%20Requirements.md)
- Research document: [Vault Write Coherency Locking Research.md](./Vault%20Write%20Coherency%20Locking%20Research.md)
- No POC.

---

## 2. Test Layer Strategy

### 2.1 Unit (Vitest)

Location: `flashquery/tests/unit/` (with subfolders under `mcp/`, `tool-search/`, etc., where it makes sense). Run: `npm test` (config `tests/config/vitest.unit.config.ts`). Scope: per-function and per-module behavior in isolation. The lock subsystem, key derivation, write primitive, and Zod schema changes have heavy unit coverage. Pool-level Postgres mocking uses `__setPgPoolFactoryForTesting` from `src/utils/pg-client.ts` so Tier 2 logic can be tested without a live database.

### 2.2 Integration (Vitest)

Location: `flashquery/tests/integration/`. Run: `npm run test:integration` (config `tests/config/vitest.integration.config.ts`). Scope: multi-component flows that exercise the real lock primitive against a real (test) Supabase, the real vault filesystem, and the real MCP tool handlers. The existing `tests/integration/archive-document-lock.test.ts` is the structural model — uses `randomUUID()`-namespaced `instance.id`, builds a real `FlashQueryConfig`, registers tool handlers, exercises `acquireLock` / new helpers.

### 2.3 E2E

Location: `flashquery/tests/e2e/`. Scope: full-stack, transport included. Not heavily used for this feature — the two-tier lock and the version-token mechanism are fully exercisable at the integration layer.

### 2.4 Directed Scenario (Python)

Location: `flashquery/tests/scenarios/directed/testcases/`. Run: `python3 tests/scenarios/directed/run_suite.py --managed <pattern>`. Coverage matrix: `tests/scenarios/directed/DIRECTED_COVERAGE.md` (this Test Plan proposes a new "Phase NNN Vault Write Coherency" section). Framework: `fqc_test_utils` (`tests/scenarios/framework/`). Authoring skill: `flashquery-directed-testgen`. Used for the highest-leverage end-to-end behavioral verifications — per-file lock granularity through the MCP surface, the live-defect regression, the version-token round trip, the read-triggered-repair regression.

### 2.5 Integration Scenario (YAML)

Location: `flashquery/tests/scenarios/integration/tests/`. Run: `python3 tests/scenarios/integration/run_integration.py --managed`. Coverage matrix: `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. README at `tests/scenarios/integration/README.md` (note: **the runner wipes every `fqc_*` table before and after each test** — only point at a throwaway Supabase). Authoring skill: `flashquery-integration-testgen`. Used for cross-domain workflow verification — folder-lock coordination, batch envelope with mixed tokens, version-token retry pattern.

(No §2.6 differential-against-reference subsection — no POC exists.)

---

## 3. Test Conventions

- **Unit/integration filenames.** `<feature-area>.test.ts` for unit; `<feature-area>.integration.test.ts` or `<feature-area>-<aspect>.test.ts` for integration. Examples this plan adds: `tests/unit/document-lock-tier1.test.ts`, `tests/integration/per-file-lock.test.ts`.
- **Describe / it blocks.** `describe('REQ-NNN — short name', () => …)` at the top level when the test file covers one REQ; otherwise group by behavior under the REQ.
- **Setup / teardown.** `beforeAll` for one-time setup (test config, Supabase init, vault dir mkdtemp), `afterEach` for per-test cleanup (lock-table cleanup before §4 ships REQ-004), `afterAll` for vault rm and pool close. Model: `tests/integration/archive-document-lock.test.ts`.
- **Test isolation.** Every integration test uses a `randomUUID()`-suffixed `instance.id` so concurrent test runs and parallel CI never collide on shared Postgres state.
- **Pool injection.** Unit tests that exercise Tier 2 logic call `__setPgPoolFactoryForTesting(factory)` with a hand-rolled fake pool returning canned advisory-lock-acquire results; restore with `__setPgPoolFactoryForTesting(null)` in `afterEach`.
- **Scenario-test conventions.** Directed scenarios follow `tests/scenarios/directed/testcases/test_batch_get_document.py` as the model (declares `COVERAGE = ["D-WCO-NN"]`, exit codes 0/2/3 = PASS/FAIL/DIRTY, `--managed` mode). Integration scenarios follow the YAML pattern in `tests/scenarios/integration/tests/`.
- **Coverage-matrix updates** happen when tests land. Use `flashquery-directed-covgen` to add directed `D-WCO-NN` entries; `flashquery-integration-covgen` for `INT-WCO-NN`.

---

## 4. Test Cases by Area

### 4.1 Lock subsystem (Spec §6.1)

#### 4.1.1. REQ-001 tests (Spec §6.1.1) — Per-file granularity

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-001 | `tests/unit/document-lock-registry.test.ts` | The Tier 1 registry returns distinct mutexes for distinct canonical-path keys and the same mutex for the same key. | Positive |
| T-U-002 | `tests/unit/document-lock-registry.test.ts` | Lock striping caps registry size at the configured stripe count (1024); 5000 distinct keys allocate at most 1024 mutexes. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-001 | `tests/integration/per-file-lock.test.ts` | Two `write_document` calls to two different vault files complete in parallel — neither blocks the other (measured by overlap of acquire/release timestamps). | Positive |
| T-I-002 | `tests/integration/per-file-lock.test.ts` | Two `write_document` calls to the same vault file serialize; the second writer's `readFile` inside its lock sees the first writer's bytes (INV-10 preserved). | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-001 | `D-WCO-01` | `tests/scenarios/directed/testcases/test_per_file_lock_parallel.py` | Two parallel `write_document` calls to two files complete without contention through the MCP public surface. | Positive |

**Notes.** Failure mode covered: no coarse-lock fallback remains. A grep verification step in Phase 1 confirms no `acquireLock('documents', …)` literal survives.

#### 4.1.2. REQ-002 tests (Spec §6.1.2) — Two-tier lock

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-003 | `tests/unit/document-lock-tier1.test.ts` | Tier 1 in isolation: two async contexts contend on the same key, the loser blocks until the winner releases, FIFO within the process. | Positive |
| T-U-004 | `tests/unit/document-lock-tier2.test.ts` | Tier 2 acquire/release flow against an injected fake `PoolClient`: `pg_advisory_lock(bigint)` is called on the checked-out client; `pg_advisory_unlock(bigint)` is called before client release. | Positive |
| T-U-005 | `tests/unit/document-lock-tier2.test.ts` | Tier 1 loser does NOT re-call Tier 2 — Tier 2 acquire/release pair is observed exactly once per same-process burst of contenders. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-003 | `tests/integration/two-tier-lock.integration.test.ts` | Two FlashQuery processes (simulated via two `withPgClient` checkouts on the same DB) contending the same file: only one acquires Tier 2 at a time; the other blocks until release. | Positive |
| T-I-004 | `tests/integration/two-tier-lock.integration.test.ts` | A simulated process crash (kill the holding `PoolClient`) releases the advisory lock automatically — another process acquires within the next attempt without manual recovery. | Positive |

#### 4.1.3. REQ-003 tests (Spec §6.1.3) — Canonical lock-key derivation

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-006 | `tests/unit/lock-key-derivation.test.ts` | `realpath` unifies two paths that point at the same file via a symlink — they produce the same lock key. | Positive |
| T-U-007 | `tests/unit/lock-key-derivation.test.ts` | Derivation for a not-yet-existing destination uses `realpath(parent) + '/' + basename`. | Positive |
| T-U-008 | `tests/unit/lock-key-derivation.test.ts` | On a case-insensitive filesystem (detected at startup), `Notes/Plan.md` and `notes/plan.md` produce the same lock key. | Positive |
| T-U-009 | `tests/unit/lock-key-derivation.test.ts` | The namespace prefix differs between file and directory keys — `file:<path>` and `dir:<path>` hash to different bigints. | Positive |
| T-U-010 | `tests/unit/lock-key-derivation.test.ts` | A vault-relative path passed to the helper is rejected or canonicalized — the lock key is never a vault-relative string. | Negative |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-002 | `D-WCO-02` | `tests/scenarios/directed/testcases/test_case_variant_path_locking.py` | On macOS APFS, two writes to `Notes/Plan.md` and `notes/plan.md` (the same file on disk) correctly serialize. | Positive |

#### 4.1.4. REQ-004 tests (Spec §6.1.4) — Retire `fqc_write_locks`

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-005 | `tests/integration/fqc-write-locks-drop.integration.test.ts` | FlashQuery startup against a Supabase that has `fqc_write_locks` drops the table; a follow-up `SELECT … FROM fqc_write_locks` returns "relation does not exist." | Positive |
| T-I-006 | `tests/integration/fqc-write-locks-drop.integration.test.ts` | A `flashquery.yml` with `ttl_seconds: 30` loads successfully and emits one `warn` log line about the deprecated key. | Positive |

**Build-time checks** (run as part of CI; not standalone tests).

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-011 | `tests/unit/no-legacy-write-lock-imports.test.ts` | grep / static check: `src/` contains no `from '.*/services/write-lock'` import, no `acquireLock`/`releaseLock` symbol references, no `fqc_write_locks` string outside this test file's documentation. | Negative |

#### 4.1.5. REQ-005 tests (Spec §6.1.5) — Session-capable connection + startup self-test

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-012 | `tests/unit/lock-startup-self-test.test.ts` | The self-test takes a throwaway advisory lock on connection A, sees it from connection B via `pg_locks`, releases. Returns `{ok: true}`. | Positive |
| T-U-013 | `tests/unit/lock-startup-self-test.test.ts` | When the fake pool simulates transaction-mode behavior (each query returns a different backend's connection), the self-test cannot observe the lock from connection B and returns `{ok: false, reason: 'session_not_stable'}`. | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-007 | `tests/integration/lock-startup.integration.test.ts` | Against the real test Supabase (session-capable), the self-test passes and FlashQuery startup proceeds. | Positive |
| T-I-008 | `tests/integration/lock-startup.integration.test.ts` | With `__setPgPoolFactoryForTesting` returning a stub that simulates transaction-mode, FlashQuery startup exits with a non-zero status and a message naming the suspected pooler. | Negative |

#### 4.1.6. REQ-006 tests (Spec §6.1.6) — Bounded-wait timeout

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-014 | `tests/unit/lock-timeout.test.ts` | A configured `lock_timeout_seconds: 5` translates to the corresponding `lock_timeout` setting on the Tier 2 client (or to the `pg_try_advisory_lock` retry-loop duration). | Positive |
| T-U-015 | `tests/unit/lock-timeout.test.ts` | Absent `lock_timeout_seconds`, the default 10 s applies. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-009 | `tests/integration/lock-timeout.integration.test.ts` | One writer holds the lock for 12 s; a second writer with the default 10 s timeout returns a `conflict` envelope with `details.reason: "lock_timeout"`. | Negative |
| T-I-010 | `tests/integration/lock-timeout.integration.test.ts` | With `lock_timeout_seconds: 30`, the same scenario succeeds (the second writer acquires after the first releases at 12 s). | Positive |

#### 4.1.7. REQ-007 tests (Spec §6.1.7) — Folder locks

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-011 | `tests/integration/folder-lock.integration.test.ts` | A `write_document` to `Notes/A.md` holds a shared advisory lock on `Notes/`; a concurrent `manage_directory` rename of `Notes/` waits for the write to complete. | Positive |
| T-I-012 | `tests/integration/folder-lock.integration.test.ts` | Two concurrent `write_document` calls to `Notes/A.md` and `Notes/B.md` both acquire the shared lock on `Notes/` without blocking each other. | Positive |
| T-I-013 | `tests/integration/folder-lock.integration.test.ts` | `manage_directory` creating a new sub-folder takes no exclusive lock (verified by no `pg_locks` exclusive entry during the call). | Positive |

**Integration scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-Y-001 | `INT-WCO-01` | `tests/scenarios/integration/tests/folder_coordination.yml` | Write to a doc in `_wco/notes/`, then attempt to rename `_wco/notes/` while the write is in flight — the rename queues behind the write, completes after. | Positive |

#### 4.1.8. REQ-008 tests (Spec §6.1.8) — Destination-path locks

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-014 | `tests/integration/destination-lock.integration.test.ts` | Two concurrent `copy_document` calls to the same destination: exactly one succeeds; the other returns `conflict` (`path_exists` or `lock_timeout`). | Negative |
| T-I-015 | `tests/integration/destination-lock.integration.test.ts` | `move_document` from `A.md` to `B.md` takes locks on both, in sorted canonical-path order (verified by lock-acquisition trace). | Positive |
| T-I-016 | `tests/integration/destination-lock.integration.test.ts` | Concurrent `move A.md → C.md` and `move B.md → C.md`: exactly one succeeds; the other returns `conflict`. | Negative |
| T-I-048 | `tests/integration/destination-lock.integration.test.ts` | Two concurrent create-mode `write_document` calls to the same not-yet-existing destination: exactly one creates the file; the other returns `conflict` (`path_exists` or `lock_timeout`). Covers REQ-008 AC #3. | Negative |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-003 | `D-WCO-03` | `tests/scenarios/directed/testcases/test_copy_destination_race.py` | Two parallel `copy_document` calls to the same destination produce exactly one success and one structured conflict. | Negative |

#### 4.1.9. REQ-009 tests (Spec §6.1.9) — `withDocumentLock` helper

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-016 | `tests/unit/with-document-lock.test.ts` | `withDocumentLock(path, fn)` canonicalizes the path, acquires Tier 1 + Tier 2 (verified via mocks), runs `fn`, releases in reverse order on success and on error. | Positive |
| T-U-017 | `tests/unit/with-document-lock.test.ts` | `withDocumentLocks([pathB, pathA], fn)` acquires locks in sorted canonical order (A then B). | Positive |
| T-U-018 | `tests/unit/with-document-lock.test.ts` | When Tier 2 acquire times out, the helper throws a typed `LockTimeoutError`, releases Tier 1, and the response builder converts it to the REQ-006 envelope shape. | Negative |

**Build-time checks.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-019 | `tests/unit/lock-helper-only.test.ts` | The lower-level lock primitives (`acquireTier1`, `acquireTier2`, `pg_advisory_lock` callers) are not exported from any module outside `src/services/document-lock.ts` — static check. | Negative |

#### 4.1.10. REQ-010 tests (Spec §6.1.10) — Live-defect close

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-017 | `tests/integration/apply-tags-concurrent.integration.test.ts` | Two concurrent `apply_tags` calls on the same document with disjoint tag sets: the resulting `tags` array contains the union of both inputs — no tag is lost. | Positive |
| T-I-018 | `tests/integration/insert-doc-link-race.integration.test.ts` | An `insert_doc_link` racing a `write_document` on the same source document: both writers' frontmatter / body changes survive the serialized writes (INV-10). | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-004 | `D-WCO-04` | `tests/scenarios/directed/testcases/test_apply_tags_no_lost_update.py` | Regression for the §3.8 live defect — two concurrent `apply_tags` no longer lose updates. | Positive |

#### 4.1.11. REQ-025 tests (Spec §6.1.11) — `call_macro` uniform pattern

**Build-time checks.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-038 | `tests/unit/macro-no-lock-imports.test.ts` | Static / build-time check: `src/mcp/tools/macro.ts` and `src/macro/evaluator.ts` MUST NOT import or call `withDocumentLock`, the lower-level lock primitives, or any macro-level lock helper (REQ-025 AC #1). Failure shape: a single greppable assertion. | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-049 | `tests/integration/call-macro-per-step-lock.integration.test.ts` | Two parallel `call_macro` invocations whose macros both `write_document` the same file produce no torn file; the second macro's tool re-reads inside the per-file lock and writes on top of the first's bytes (REQ-025 AC #2; INV-10). | Positive |
| T-I-050 | `tests/integration/call-macro-per-step-lock.integration.test.ts` | A macro that reads file A and threads `expected_version: $a.version_token` into a later `write_document` of A is refused with the REQ-015 conflict envelope when a concurrent macro modifies A between the read and the write (REQ-025 AC #4). | Positive |
| T-I-051 | `tests/integration/call-macro-per-step-lock.integration.test.ts` | A macro that reads file A then writes A *without* `expected_version` writes unconditionally (last-writer-wins) when a concurrent macro modifies A between the steps — REQ-012's opt-in stance applies to macros unchanged (REQ-025 AC #3). Documents intentional opt-in semantics; not desired safety behavior. | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-008 | `D-WCO-08` | `tests/scenarios/directed/testcases/test_parallel_macros_per_file_lock.py` | Two parallel `call_macro` invocations stepping over the same vault files through the MCP public surface — the uniform per-file lock pattern is verified end-to-end; no torn files, no lost structural changes. | Positive |

**Notes.** Failure modes from Spec §6.1.11: a future change introducing a macro-spanning lock is caught by T-U-038; macro-author expectations of transactional macro semantics are addressed by the `help: true` documentation update (verified manually). The deferred macro-engine auto-threading (Spec §3.3 #4) and the deferred atomic-execution opt-in (Spec §3.3 #5) are intentionally **not** tested here — they will get their own test plans when they ship.

### 4.2 Version-fingerprint check (Spec §6.2)

#### 4.2.1. REQ-011 tests (Spec §6.2.1) — `version_token` in responses

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-020 | `tests/unit/document-output-version-token.test.ts` | `get_document` response envelope contains a `version_token: string` field of 64 lowercase hex characters. | Positive |
| T-U-021 | `tests/unit/document-output-version-token.test.ts` | Every write-tool success response contains `version_token` (except `remove_document` success, where it is omitted). | Positive |
| T-U-037 | `tests/unit/get-document-no-lock.test.ts` | Static / build-time check: `get_document` handler does not call `withDocumentLock` or any lock primitive — reads never acquire write locks (INV-07). | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-019 | `tests/integration/version-token-shape.integration.test.ts` | A `get_document` of a known fixture returns a `version_token` equal to the SHA-256 of the file's bytes on disk. | Positive |

#### 4.2.2. REQ-012 tests (Spec §6.2.2) — `expected_version` precondition

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-022 | `tests/unit/expected-version-schema.test.ts` | Zod schemas for every file-affecting tool accept the optional `expected_version` (and alias `if_match`) parameter. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-020 | `tests/integration/version-token-precondition.integration.test.ts` | `write_document` with a matching `expected_version` succeeds and returns the new token. | Positive |
| T-I-021 | `tests/integration/version-token-precondition.integration.test.ts` | `write_document` with a non-matching `expected_version` is refused with the REQ-015 conflict envelope; the file on disk is unchanged. | Negative |
| T-I-022 | `tests/integration/version-token-precondition.integration.test.ts` | `write_document` without `expected_version` proceeds unconditionally (backward compatibility). | Positive |
| T-I-023 | `tests/integration/version-token-precondition.integration.test.ts` | Destructive tools (`remove_document`, `move_document`, `archive_document`, `copy_document`) honor `expected_version` — a mismatch on the relevant file refuses the operation. | Negative |
| T-I-024 | `tests/integration/version-token-precondition.integration.test.ts` | `if_match` is accepted as an alias for `expected_version` and produces identical behavior. | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-005 | `D-WCO-05` | `tests/scenarios/directed/testcases/test_version_token_round_trip.py` | Full read-edit-write round-trip using `version_token` — read returns token, write with `expected_version` succeeds; second write with the now-stale token is refused. | Positive + Negative |

#### 4.2.3. REQ-013 tests (Spec §6.2.3) — Check inside the lock

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-025 | `tests/integration/version-check-inside-lock.integration.test.ts` | TOCTOU resistance: an intervening write between a caller's `get_document` and `write_document` triggers a conflict on the `write_document` even when the intervening write happened microseconds before. | Positive |

#### 4.2.4. REQ-014 tests (Spec §6.2.4) — Token-equals-disk invariant

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-026 | `tests/integration/token-equals-disk.integration.test.ts` | After a `get_document` that triggers a `targetedScan` repair (a file with missing `fq_id`), the returned `version_token` SHA-256-matches the bytes now on disk, **not** the bytes before repair. | Positive |
| T-I-027 | `tests/integration/token-equals-disk.integration.test.ts` | A subsequent `write_document` with `expected_version` equal to the just-returned token is accepted (the regression for the OQ27 bug). | Positive |
| T-I-028 | `tests/integration/token-equals-disk.integration.test.ts` | After any write path, `fqc_documents.content_hash` for that document equals the returned `version_token` equals the SHA-256 of the file's on-disk bytes. INV-05 verification. | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-006 | `D-WCO-06` | `tests/scenarios/directed/testcases/test_read_triggered_repair_token.py` | Regression for OQ27 — a `get_document` on a file with stale identity frontmatter triggers a repair, returns the post-repair token, and a follow-up no-op write with that token is accepted. | Positive |

#### 4.2.5. REQ-015 tests (Spec §6.2.5) — Refused-write envelope

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-023 | `tests/unit/conflict-envelope.test.ts` | The refused-write envelope has `error: "conflict"`, `details.reason: "version_mismatch"`, `version_token: <string>`, `targeted_region: <object>`. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-029 | `tests/integration/refused-write-envelope.integration.test.ts` | Per-tool targeted region: `replace_doc_section` conflict carries the section; `apply_tags` carries the frontmatter; `write_document` carries the whole document; `insert_in_doc` carries the anchor region; destructive tools carry the whole document. | Positive |
| T-I-030 | `tests/integration/refused-write-envelope.integration.test.ts` | If the racing change **removed** the caller's target section, the refusal envelope sets `targeted_region.not_found: true`. | Negative |
| T-I-031 | `tests/integration/refused-write-envelope.integration.test.ts` | The region representation in the refusal is byte-identical to what `get_document` would return for that region (no formatting drift). | Positive |

#### 4.2.6. REQ-016 tests (Spec §6.2.6) — Whole-file hash

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-024 | `tests/unit/version-token-shape.test.ts` | `version_token` is computed over the raw file bytes (frontmatter + body, no normalization). Editing a single byte anywhere in the file changes the token. | Positive |
| T-U-025 | `tests/unit/version-token-shape.test.ts` | `get_document` with `include: ['section']` still returns the whole-file token (not a section-scoped hash). | Positive |

#### 4.2.7. REQ-017 tests (Spec §6.2.7) — Scanner zero-writes invariant

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-032 | `tests/integration/scanner-zero-writes.integration.test.ts` | Run `scanner.runScanOnce()` twice in a row on a fixture vault; count `writeMarkdown` invocations between the two runs — must be zero. | Positive |
| T-I-033 | `tests/integration/scanner-zero-writes.integration.test.ts` | Add a file with missing `fq_id`; one scan writes it (repair); a second scan writes zero. | Positive |

**Directed scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-S-007 | `D-WCO-07` | `tests/scenarios/directed/testcases/test_scanner_token_stability.py` | Two consecutive `--managed` scans of an untouched vault produce zero file writes — verified by `fq_updated` timestamps unchanged across runs. | Positive |

### 4.3 Multi-file batch contract (Spec §6.3)

#### 4.3.1. REQ-018 tests (Spec §6.3.1) — Per-item result envelope

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-034 | `tests/integration/batch-envelope.integration.test.ts` | A `remove_document` batch with 3 inputs returns an ordered 3-entry array, in input order, each entry one of `succeeded` / `conflicted` / `failed`. | Positive |
| T-I-035 | `tests/integration/batch-envelope.integration.test.ts` | A batch where one item's `expected_version` mismatches produces a `conflicted` entry at that index, with the new token and per-tool targeted region; other entries succeed. | Mixed |
| T-I-036 | `tests/integration/batch-envelope.integration.test.ts` | A batch where one identifier is not found produces a `failed` entry at that index with `error: "not_found"`; other entries succeed. | Mixed |
| T-I-037 | `tests/integration/batch-envelope.integration.test.ts` | The batch is not transactional — when one item fails, the others' writes persist on disk. | Positive |

**Integration scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-Y-002 | `INT-WCO-02` | `tests/scenarios/integration/tests/batch_envelope_per_item.yml` | A 4-item `archive_document` batch with one expected conflict; the runner asserts the array shape, the per-item statuses, and the surviving DB state. | Mixed |

#### 4.3.2. REQ-019 tests (Spec §6.3.2) — Mixed input shape

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-026 | `tests/unit/batch-input-shape.test.ts` | Zod schema for each batch tool accepts `string`, `string[]`, and `Array<string | { identifier, version_token }>`. | Positive |
| T-U-027 | `tests/unit/batch-input-shape.test.ts` | Parallel positional `version_tokens?: string[]` is rejected — not part of the schema. | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-038 | `tests/integration/batch-input-shape.integration.test.ts` | A batch input mixing bare strings and object elements in one call processes each correctly — object elements honor the version check, bare strings skip it. | Mixed |

**Integration scenarios.**

| Test ID | Coverage ID | Test file | Behavior | Type |
|---|---|---|---|---|
| T-Y-003 | `INT-WCO-03` | `tests/scenarios/integration/tests/batch_mixed_input.yml` | A 3-item batch with [bare, object-with-token, object-with-mismatching-token]; assert one succeeded (untokened), one succeeded (token matched), one conflicted. | Mixed |

### 4.4 Atomic + durable writes (Spec §6.4)

#### 4.4.1. REQ-020 tests (Spec §6.4.1) — Single primitive

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-028 | `tests/unit/vault-write-primitive.test.ts` | `writeVaultFile(path, bytes)` returns `{ contentHash }` equal to the SHA-256 of `bytes`. | Positive |
| T-U-029 | `tests/unit/vault-write-primitive.test.ts` | A simulated `writeFile` failure surfaces as a thrown error to the caller (no silent-debug-log fallback). | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-039 | `tests/integration/atomic-write-frontmatter.integration.test.ts` | `atomicWriteFrontmatter` propagates errors — a write to a read-only file produces a real error to the caller (closing the §3.5 silent-failure defect). | Negative |
| T-I-040 | `tests/integration/atomic-write-frontmatter.integration.test.ts` | All vault writes observed during a representative MCP-tool exercise originate from `writeVaultFile` (verified by an instrumented primitive that records its callers). | Positive |

**Build-time checks.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-030 | `tests/unit/single-write-primitive.test.ts` | Static check: no `writeFile` / `appendFile` / `rename` calls in `src/storage/` `src/utils/` `src/mcp/` `src/services/` target a vault path outside `writeVaultFile`. | Negative |

#### 4.4.2. REQ-021 tests (Spec §6.4.2) — Atomic + durable sequence

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-031 | `tests/unit/vault-write-durable.test.ts` | The write sequence calls (in order): `writeFile(temp)` → `filehandle.sync()` → `rename(temp, dest)` → `fs.open(dir)` → `fd.sync()` → close. Verified via spies on `fs.promises` methods. | Positive |
| T-U-032 | `tests/unit/vault-write-durable.test.ts` | Temp filename is unique per call — includes pid and a monotonic counter; two concurrent calls to the same `absPath` produce two different temp filenames. | Positive |
| T-U-033 | `tests/unit/vault-write-durable.test.ts` | On macOS (`process.platform === 'darwin'`), the primitive uses `F_FULLFSYNC` semantics. | Positive |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-041 | `tests/integration/vault-write-durable.integration.test.ts` | After `cleanStaleTempFiles()` runs at startup, any `<file>.fqc-tmp-<pid>-<counter>` matching the unique-name pattern is removed. | Positive |

#### 4.4.3. REQ-022 tests (Spec §6.4.3) — EXDEV fallback

**Unit tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-034 | `tests/unit/move-exdev-fallback.test.ts` | With `fs.rename` mocked to throw `EXDEV`, `move_document` invokes `writeVaultFile` against the destination directory before `unlink(source)`. | Positive |
| T-U-035 | `tests/unit/move-exdev-fallback.test.ts` | If the EXDEV-path `writeVaultFile` throws, the source is **not** unlinked. | Negative |

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-042 | `tests/integration/move-exdev-fallback.integration.test.ts` | An EXDEV-simulated move leaves no partial destination after a mid-fallback crash (mocked) — either source survives intact or destination is durably committed and source is unlinked. | Positive |

### 4.5 Records, memory, plugins (Spec §6.5)

#### 4.5.1. REQ-023 tests (Spec §6.5.1) — Coordination after `fqc_write_locks` retirement

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-043 | `tests/integration/memory-no-coarse-lock.integration.test.ts` | Two concurrent `write_memory` updates to the same memory chain converge correctly via the `fqc_memory_create_version` RPC's `SELECT … FOR UPDATE` — no coarse lock is required, no race produces `is_latest = true` on two rows. | Positive |
| T-I-044 | `tests/integration/records-reconciliation.integration.test.ts` | Two concurrent `write_record` calls into the same plugin instance: the reconciliation preamble is either idempotent under concurrent runs (validated by the code-review notes) or serialized by the per-plugin advisory lock — no double-applied reconciliation action observed. | Positive |
| T-I-045 | `tests/integration/unregister-plugin-races.integration.test.ts` | Two concurrent `unregister_plugin` calls on the same plugin produce one success and one structured "not found" / "not registered" — no partial-delete state remains in any `fqc_*` table. | Positive |

**Build-time checks.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-U-036 | `tests/unit/no-coarse-resource-locks.test.ts` | grep / static check: no `acquireLock(.*'records'\|'memory'\|'plugins'` literal remains in `src/`. | Negative |

#### 4.5.2. REQ-024 tests (Spec §6.5.2) — `manage_directory` migration

**Integration tests.**

| Test ID | File | Description | Type |
|---|---|---|---|
| T-I-046 | `tests/integration/manage-directory-advisory-lock.integration.test.ts` | `manage_directory` takes an **exclusive** advisory lock on the operated folder's canonical path; verified via `pg_locks` inspection during the call. | Positive |
| T-I-047 | `tests/integration/manage-directory-advisory-lock.integration.test.ts` | Two concurrent `manage_directory` calls on the same folder: exactly one succeeds; the other returns the `conflict` / `lock_contention` envelope shape unchanged from today. | Negative |

---

## 5. Coverage Matrix

### 5.1 Requirements → Tests

| REQ | Unit | Integration | E2E | Directed | Integration Scenario |
|---|---|---|---|---|---|
| REQ-001 | T-U-001, T-U-002 | T-I-001, T-I-002 | — | T-S-001 | — |
| REQ-002 | T-U-003, T-U-004, T-U-005 | T-I-003, T-I-004 | — | — | — |
| REQ-003 | T-U-006, T-U-007, T-U-008, T-U-009, T-U-010 | — | — | T-S-002 | — |
| REQ-004 | T-U-011 | T-I-005, T-I-006 | — | — | — |
| REQ-005 | T-U-012, T-U-013 | T-I-007, T-I-008 | — | — | — |
| REQ-006 | T-U-014, T-U-015 | T-I-009, T-I-010 | — | — | — |
| REQ-007 | — | T-I-011, T-I-012, T-I-013 | — | — | T-Y-001 |
| REQ-008 | — | T-I-014, T-I-015, T-I-016, T-I-048 | — | T-S-003 | — |
| REQ-009 | T-U-016, T-U-017, T-U-018, T-U-019 | — | — | — | — |
| REQ-010 | — | T-I-017, T-I-018 | — | T-S-004 | — |
| REQ-011 | T-U-020, T-U-021, T-U-037 | T-I-019 | — | — | — |
| REQ-012 | T-U-022 | T-I-020, T-I-021, T-I-022, T-I-023, T-I-024 | — | T-S-005 | — |
| REQ-013 | — | T-I-025 | — | — | — |
| REQ-014 | — | T-I-026, T-I-027, T-I-028 | — | T-S-006 | — |
| REQ-015 | T-U-023 | T-I-029, T-I-030, T-I-031 | — | — | — |
| REQ-016 | T-U-024, T-U-025 | — | — | — | — |
| REQ-017 | — | T-I-032, T-I-033 | — | T-S-007 | — |
| REQ-018 | — | T-I-034, T-I-035, T-I-036, T-I-037 | — | — | T-Y-002 |
| REQ-019 | T-U-026, T-U-027 | T-I-038 | — | — | T-Y-003 |
| REQ-020 | T-U-028, T-U-029, T-U-030 | T-I-039, T-I-040 | — | — | — |
| REQ-021 | T-U-031, T-U-032, T-U-033 | T-I-041 | — | — | — |
| REQ-022 | T-U-034, T-U-035 | T-I-042 | — | — | — |
| REQ-023 | T-U-036 | T-I-043, T-I-044, T-I-045 | — | — | — |
| REQ-024 | — | T-I-046, T-I-047 | — | — | — |
| REQ-025 | T-U-038 | T-I-049, T-I-050, T-I-051 | — | T-S-008 | — |

### 5.2 Test → Requirement

| Test ID | REQ |
|---|---|
| T-U-001, T-U-002 | REQ-001 |
| T-U-003, T-U-004, T-U-005 | REQ-002 |
| T-U-006, T-U-007, T-U-008, T-U-009, T-U-010 | REQ-003 |
| T-U-011 | REQ-004 |
| T-U-012, T-U-013 | REQ-005 |
| T-U-014, T-U-015 | REQ-006 |
| T-U-016, T-U-017, T-U-018, T-U-019 | REQ-009 |
| T-U-020, T-U-021, T-U-037 | REQ-011 (T-U-037 also verifies INV-07) |
| T-U-022 | REQ-012 |
| T-U-023 | REQ-015 |
| T-U-024, T-U-025 | REQ-016 |
| T-U-026, T-U-027 | REQ-019 |
| T-U-028, T-U-029, T-U-030 | REQ-020 |
| T-U-031, T-U-032, T-U-033 | REQ-021 |
| T-U-034, T-U-035 | REQ-022 |
| T-U-036 | REQ-023 |
| T-I-001, T-I-002 | REQ-001 |
| T-I-003, T-I-004 | REQ-002 |
| T-I-005, T-I-006 | REQ-004 |
| T-I-007, T-I-008 | REQ-005 |
| T-I-009, T-I-010 | REQ-006 |
| T-I-011, T-I-012, T-I-013 | REQ-007 |
| T-I-014, T-I-015, T-I-016, T-I-048 | REQ-008 |
| T-I-017, T-I-018 | REQ-010 |
| T-I-019 | REQ-011 |
| T-I-020, T-I-021, T-I-022, T-I-023, T-I-024 | REQ-012 |
| T-I-025 | REQ-013 |
| T-I-026, T-I-027, T-I-028 | REQ-014 |
| T-I-029, T-I-030, T-I-031 | REQ-015 |
| T-I-032, T-I-033 | REQ-017 |
| T-I-034, T-I-035, T-I-036, T-I-037 | REQ-018 |
| T-I-038 | REQ-019 |
| T-I-039, T-I-040 | REQ-020 |
| T-I-041 | REQ-021 |
| T-I-042 | REQ-022 |
| T-I-043, T-I-044, T-I-045 | REQ-023 |
| T-I-046, T-I-047 | REQ-024 |
| T-U-038 | REQ-025 |
| T-I-049, T-I-050, T-I-051 | REQ-025 |
| T-S-008 | REQ-025 |
| T-S-001 | REQ-001 |
| T-S-002 | REQ-003 |
| T-S-003 | REQ-008 |
| T-S-004 | REQ-010 |
| T-S-005 | REQ-012 |
| T-S-006 | REQ-014 |
| T-S-007 | REQ-017 |
| T-Y-001 | REQ-007 |
| T-Y-002 | REQ-018 |
| T-Y-003 | REQ-019 |

---

## 6. Coverage Gaps

Full coverage — every requirement has at least one automated test at an appropriate layer.

E2E is not used by this feature: the two-tier lock, the version-token mechanism, and the batch contract are fully exercisable at the integration layer (with real Supabase, real vault, real handlers), and the existing integration test `archive-document-lock.test.ts` confirms the layer is the right fit for lock work. If post-implementation review surfaces a behavior that genuinely needs E2E, it should be added at that time.

---

## 7. Coverage IDs to Add

The following new coverage IDs are proposed for the matrices. The dev/test agent adds them via `flashquery-directed-covgen` and `flashquery-integration-covgen` when the corresponding tests land.

### 7.1 New directed-coverage IDs (`DIRECTED_COVERAGE.md`)

Recommended as a new "Phase NNN Vault Write Coherency" section in `DIRECTED_COVERAGE.md`.

| Coverage ID | Behavior | Test Plan ref |
|---|---|---|
| `D-WCO-01` | Two parallel `write_document` calls to two files complete without contention through the MCP public surface (per-file granularity). | §4.1.1 (T-S-001) |
| `D-WCO-02` | On a case-insensitive filesystem (macOS APFS), two writes to case-variant paths to one physical file correctly serialize. | §4.1.3 (T-S-002) |
| `D-WCO-03` | Two parallel `copy_document` calls to the same destination produce exactly one success and one structured conflict. | §4.1.8 (T-S-003) |
| `D-WCO-04` | Regression for the §3.8 live defect — two concurrent `apply_tags` calls no longer lose updates. | §4.1.10 (T-S-004) |
| `D-WCO-05` | Full read-edit-write round-trip using `version_token` — token from `get_document`, write with matching `expected_version` succeeds, write with stale token is refused. | §4.2.2 (T-S-005) |
| `D-WCO-06` | Regression for OQ27 — `get_document` that triggers a `targetedScan` repair returns a token a follow-up no-op write accepts. | §4.2.4 (T-S-006) |
| `D-WCO-07` | Two consecutive scans of an untouched vault produce zero file writes (scanner token-stability invariant). | §4.2.7 (T-S-007) |
| `D-WCO-08` | Two parallel `call_macro` invocations stepping over the same vault files — uniform per-file lock pattern verified end-to-end (no torn files, no lost structural changes). | §4.1.11 (T-S-008) |

### 7.2 New integration-scenario coverage IDs (`INTEGRATION_COVERAGE.md`)

| Coverage ID | Behavior | Test Plan ref |
|---|---|---|
| `INT-WCO-01` | Folder coordination — file write in flight queues a folder rename behind it; rename completes after the write. | §4.1.7 (T-Y-001) |
| `INT-WCO-02` | Batch envelope — a 4-item `archive_document` batch with one expected version conflict produces an ordered per-item array with correct statuses. | §4.3.1 (T-Y-002) |
| `INT-WCO-03` | Batch mixed-input shape — `[bare-string, object-with-token, object-with-stale-token]` produces succeeded / succeeded / conflicted in input order. | §4.3.2 (T-Y-003) |

---

## 8. Test Status Checklist

The dev/test agent ticks each entry as the test lands, appending a one-liner summary (and any nuance / follow-up the next reader should know).

**Lock subsystem.**

- [ ] T-U-001 — Tier 1 registry returns distinct mutexes for distinct keys
- [ ] T-U-002 — Tier 1 striping caps registry size at 1024
- [ ] T-U-003 — Tier 1 in isolation: contenders block until winner releases
- [ ] T-U-004 — Tier 2 acquire/release on a fake `PoolClient`
- [ ] T-U-005 — Tier 1 loser does not re-acquire Tier 2
- [ ] T-U-006 — `realpath` unifies symlinked paths
- [ ] T-U-007 — Destination key uses `realpath(parent) + basename`
- [ ] T-U-008 — Case-fold unifies case-variant paths on insensitive filesystems
- [ ] T-U-009 — `file:` and `dir:` namespaces produce distinct keys
- [ ] T-U-010 — Vault-relative path is rejected or canonicalized
- [ ] T-U-011 — Static check: no legacy `write-lock` imports remain
- [ ] T-U-012 — Self-test passes on a session-capable connection
- [ ] T-U-013 — Self-test fails on a simulated transaction-mode pooler
- [ ] T-U-014 — Configured `lock_timeout_seconds` is wired through
- [ ] T-U-015 — Default 10 s applies when key is absent
- [ ] T-U-016 — `withDocumentLock` acquires/releases in order, even on error
- [ ] T-U-017 — `withDocumentLocks` acquires in sorted canonical order
- [ ] T-U-018 — Tier 2 timeout produces a typed `LockTimeoutError`
- [ ] T-U-019 — Static check: lower-level lock primitives are not exported
- [ ] T-I-001 — Two writes to different files complete in parallel
- [ ] T-I-002 — Two writes to one file serialize; INV-10 preserved
- [ ] T-I-003 — Two `PoolClient` checkouts contend on Tier 2
- [ ] T-I-004 — Crashed client releases its advisory lock automatically
- [ ] T-I-005 — Startup drops `fqc_write_locks` if present
- [ ] T-I-006 — Legacy `ttl_seconds` config key is silently ignored with a warn log
- [ ] T-I-007 — Self-test passes against the test Supabase
- [ ] T-I-008 — Self-test fails loudly against simulated transaction-mode pooler
- [ ] T-I-009 — Default 10 s timeout produces structured `lock_timeout` envelope
- [ ] T-I-010 — Configurable 30 s timeout succeeds where 10 s would fail
- [ ] T-I-011 — File write blocks folder rename
- [ ] T-I-012 — Concurrent file writes don't block each other on shared folder lock
- [ ] T-I-013 — Folder creation takes no exclusive lock
- [ ] T-I-014 — Two `copy_document` to same destination: one wins, one conflicts
- [ ] T-I-015 — `move_document` takes both source + destination locks in sorted order
- [ ] T-I-016 — Two `move` operations into same destination: one wins, one conflicts
- [ ] T-I-048 — Two concurrent create-mode `write_document` to same dest: one wins, one conflicts
- [ ] T-I-017 — Two concurrent `apply_tags`: tags merge (no lost update)
- [ ] T-I-018 — `insert_doc_link` racing `write_document`: both changes survive
- [ ] T-S-001 — `D-WCO-01` per-file parallel writes through MCP
- [ ] T-S-002 — `D-WCO-02` case-variant paths serialize correctly
- [ ] T-S-003 — `D-WCO-03` copy destination race produces one conflict
- [ ] T-S-004 — `D-WCO-04` `apply_tags` no-lost-update regression
- [ ] T-Y-001 — `INT-WCO-01` folder coordination workflow
- [ ] T-U-038 — Static check: `macro.ts` / `evaluator.ts` have no lock imports
- [ ] T-I-049 — Two parallel `call_macro` on same file: per-step lock works (no torn file)
- [ ] T-I-050 — `call_macro` with threaded `version_token` catches concurrent modification
- [ ] T-I-051 — `call_macro` without threaded `version_token` writes unconditionally (opt-in)
- [ ] T-S-008 — `D-WCO-08` parallel `call_macro` uniform-pattern scenario

**Version-fingerprint check.**

- [ ] T-U-020 — `version_token` shape in `get_document` response
- [ ] T-U-021 — `version_token` on every write success (except `remove_document`)
- [ ] T-U-037 — Static check: `get_document` acquires no lock (INV-07)
- [ ] T-U-022 — Zod schema accepts `expected_version` / `if_match`
- [ ] T-U-023 — Refused-write envelope shape
- [ ] T-U-024 — Single-byte file edit changes the token
- [ ] T-U-025 — Section read still returns whole-file token
- [ ] T-I-019 — `version_token` equals on-disk SHA-256 for a known fixture
- [ ] T-I-020 — Matching `expected_version` succeeds
- [ ] T-I-021 — Mismatching `expected_version` is refused, file unchanged
- [ ] T-I-022 — Omitted `expected_version` writes unconditionally (back-compat)
- [ ] T-I-023 — Destructive tools honor `expected_version`
- [ ] T-I-024 — `if_match` alias works identically
- [ ] T-I-025 — TOCTOU resistance: intervening write triggers a conflict
- [ ] T-I-026 — Read-triggered repair returns post-repair token
- [ ] T-I-027 — Post-repair token accepted by follow-up no-op write
- [ ] T-I-028 — File / DB row / token all agree on all paths (INV-05)
- [ ] T-I-029 — Per-tool targeted region in refusal envelope
- [ ] T-I-030 — `targeted_region.not_found: true` when target was removed
- [ ] T-I-031 — Refusal region is byte-identical to `get_document` region output
- [ ] T-I-032 — Two consecutive scans on untouched vault: zero writes
- [ ] T-I-033 — Scan repairs a missing-fq_id file once; second scan writes zero
- [ ] T-S-005 — `D-WCO-05` version_token round-trip
- [ ] T-S-006 — `D-WCO-06` read-triggered-repair token regression (OQ27)
- [ ] T-S-007 — `D-WCO-07` scanner token-stability across two scans

**Multi-file batch contract.**

- [ ] T-U-026 — Zod schema accepts mixed `Array<string | { identifier, version_token }>`
- [ ] T-U-027 — Parallel positional `version_tokens[]` is rejected
- [ ] T-I-034 — Batch returns ordered per-item array in input order
- [ ] T-I-035 — Conflicted entry carries new token + targeted region
- [ ] T-I-036 — Not-found item produces `failed` entry; others succeed
- [ ] T-I-037 — Batch is not transactional: surviving items persist
- [ ] T-I-038 — Mixed-input array handles bare and object elements correctly
- [ ] T-Y-002 — `INT-WCO-02` 4-item archive batch with conflict
- [ ] T-Y-003 — `INT-WCO-03` batch mixed-input shape end-to-end

**Atomic + durable writes.**

- [ ] T-U-028 — `writeVaultFile` returns SHA-256 of bytes written
- [ ] T-U-029 — Simulated `writeFile` failure surfaces as thrown error
- [ ] T-U-030 — Static check: no vault writes outside `writeVaultFile`
- [ ] T-U-031 — Write sequence calls fsync(temp) → rename → fsync(dir) in order
- [ ] T-U-032 — Unique temp filenames per call
- [ ] T-U-033 — macOS uses `F_FULLFSYNC` semantics
- [ ] T-U-034 — EXDEV fallback routes through `writeVaultFile` against destination
- [ ] T-U-035 — EXDEV destination write failure does not unlink source
- [ ] T-I-039 — `atomicWriteFrontmatter` propagates errors (no silent debug log)
- [ ] T-I-040 — Representative MCP-tool exercise: all writes via `writeVaultFile`
- [ ] T-I-041 — `cleanStaleTempFiles` recognizes unique-name pattern
- [ ] T-I-042 — EXDEV crash-resilience: no partial destination after mid-fallback crash

**Records, memory, plugins.**

- [ ] T-U-036 — Static check: no coarse `'records'` / `'memory'` / `'plugins'` resource locks remain
- [ ] T-I-043 — Concurrent `write_memory` updates converge via the RPC's row lock
- [ ] T-I-044 — Concurrent `write_record` reconciliation: no double-applied actions
- [ ] T-I-045 — Concurrent `unregister_plugin`: no partial-delete state
- [ ] T-I-046 — `manage_directory` takes an exclusive advisory directory lock
- [ ] T-I-047 — Two concurrent `manage_directory` on one folder: one wins, one conflicts

---

## 9. Open Questions for QA

No open questions.

A few items the QA agent may want to consider during implementation:

- **Concurrent-pressure soak.** The integration tests verify correctness under bounded concurrency (typically 2–4 simultaneous callers). A soak test that runs N×M operations over time could surface advisory-lock-key bigint-collision false-sharing rates and tail-latency under timeout pressure — useful but not blocking for v1.
- **`pg_locks` visibility.** Several tests (T-I-004, T-I-013, T-I-046) inspect `pg_locks` to verify advisory-lock state. The QA agent should standardize on one helper that queries `pg_locks` and returns a filtered view (by lock-class and the FlashQuery-derived bigint key).

---

## 10. Related

- **Requirements document:** [Vault Write Coherency Locking Requirements.md](./Vault%20Write%20Coherency%20Locking%20Requirements.md)
- **Research document:** [Vault Write Coherency Locking Research.md](./Vault%20Write%20Coherency%20Locking%20Research.md)
- **Existing similar tests** (structural models): `tests/integration/archive-document-lock.test.ts`, `tests/scenarios/directed/testcases/test_batch_get_document.py`.

---

## Review Notes

Recorded during the six-pass self-review (Step 7 of `fq-devspec`), 2026-05-25.

- **Pass 1 (Coverage):** Walked the research doc and every REQ in the companion Spec. Every REQ has at least one Test Plan §4 entry; every layer used in §2 has tests in §4 (E2E is intentionally not used — see §6 Coverage Gaps).
- **Pass 2 (Codebase accuracy):** Verified the test-infrastructure citations — `tests/integration/archive-document-lock.test.ts` is the structural model and exists; `tests/scenarios/directed/testcases/test_batch_get_document.py` is the directed-scenario model and exists; `__setPgPoolFactoryForTesting` is exported from `src/utils/pg-client.ts` line ~94 and is the right injection point for Tier 2 unit tests; the `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` matrices exist at their cited paths.
- **Pass 3 (Ambiguity):** Each test case has a clear file path, a clear behavior, and a Type column. Tests that rely on `pg_locks` inspection are flagged in §9 Open Questions for QA to standardize a helper.
- **Pass 4 (Self-consistency):** All `Spec §X.Y` cross-references resolve in the Requirements doc. Test IDs are unique and sequentially numbered within each layer prefix (T-U-001..037, T-I-001..048, T-S-001..007, T-Y-001..003). §5.1 and §5.2 are mutually consistent — every REQ-to-test forward edge has a matching test-to-REQ reverse edge.
- **Pass 5 (Gap analysis, two rounds):** First round confirmed §5.1 has no empty rows (all 24 REQs have tests). Second round caught two gaps: INV-07 (reads don't lock) had no dedicated test — added T-U-037 as a static-check unit test under §4.2.1 / REQ-011 (the read-side REQ); REQ-008 AC #3 (create-mode `write_document` destination race) was not explicitly tested — added T-I-048 to §4.1.8 / REQ-008. §5.1, §5.2, and the §8 checklist updated to include both.
- **Pass 6 (Per-phase tests):** Re-verified against Spec §8 — every phase's "Tests required" line points at one or more §4 sections that contain real tests for the phase's REQs. No phase deferring its tests to a later phase.

### Post-review addendum — `call_macro` coverage (2026-05-25)

After the initial six-pass review, a conversation about `call_macro` and parallel-macro concurrency surfaced a gap the spec hadn't explicitly addressed: whether `call_macro` itself takes a macro-spanning lock or relies on the uniform per-file pattern at each step. The decision (Option A — uniform per-file pattern; auto-threading and atomic execution deferred — recorded in Research §3.17 and Spec §6.1.11 / §3.3 #4–#5) was added to all three documents on 2026-05-25, with this Test Plan gaining §4.1.11 (REQ-025 tests — T-U-038, T-I-049, T-I-050, T-I-051, T-S-008), a new `D-WCO-08` coverage ID in §7.1, and the corresponding §5.1, §5.2, and §8 checklist entries. The macro path now has the same uniform-pattern guarantee as every other caller, with a static-check test guarding against future regression. Total counts after addendum: 37 unit tests, 50 integration tests, 8 directed scenarios, 3 integration scenarios.
