---
status: complete
resolved_at: 2026-05-14T03:05:00Z
---

# Test Suite State — 2026-04-14

## Overview

Results below reflect **two runs**: initial run (no credentials) and post-credentials run after `.env.test` and `flashquery.test.yml` were populated with cloud Supabase credentials.

| Suite | Config | Files | Tests | Passed | Failed | Skipped | Status |
|-------|--------|-------|-------|--------|--------|---------|--------|
| Unit | vitest.config.ts | 54 | 1135 | 1109 | 8 | 18 | FAIL |
| Integration (no creds) | vitest.integration.config.ts | 43 | 434 | 115 | 55 | 263 | FAIL |
| Integration (with creds) | vitest.integration.config.ts | 43 | 434 | **323** | **74** | **37** | FAIL |
| E2E + MCP | vitest.e2e.config.ts | 5 | 40 | 25 | 0 (2 suite-level errors) | 15 | PARTIAL |
| HTTP Transport | vitest.http.config.ts | 1 | 9 | 9 | 0 | 0 | PASS |
| Benchmark | vitest.benchmark.config.ts | 1 | 7 | 7 | 0 | 0 | PASS |

Note on E2E: vitest reports 2 failed test suites (file-level setup errors), but all individual test assertions that executed passed. Tests that failed to run at all are not counted as "failed tests" in the vitest summary.

**Integration with credentials delta:** +208 passing, -226 skipped, +19 newly surfaced failures.

Total (canonical dirs, with credentials): 104 test files, 1627 tests (1448 passed, 90 failed/error, 89 skipped)

---

## Suite Details

### Unit

File list (54 files):
tests/unit/advanced-document-tools.test.ts, auth-middleware.test.ts, authorize-endpoint.test.ts,
backup-command.test.ts, change-notifications.test.ts, compound-tools.test.ts, config.test.ts,
copy-document.test.ts, create-document.test.ts, discovery-coordinator.test.ts,
discovery-orchestrator.test.ts, document-tools.test.ts, embedding.test.ts,
frontmatter-sanitizer.test.ts, get-briefing.test.ts, get-doc-outline.test.ts, get-memory.test.ts,
git-manager.test.ts, health-endpoint.test.ts, logging.test.ts, manifest-loader.test.ts,
mcp-info-endpoint.test.ts, mcp-server-tools.test.ts, mcp/utils/markdown-sections.test.ts,
memory-tools.test.ts, plugin-manager.test.ts, plugin-propagation.test.ts, plugin-skill-invoker.test.ts,
plugin-tools.test.ts, port-checker.test.ts, projects-seeder.test.ts, project-tools.test.ts,
record-tools.test.ts, redaction.test.ts, remove-directory.test.ts, resolve-document.test.ts,
response-formats.test.ts, scanner-change-detection.test.ts, scanner.test.ts, schema-migration.test.ts,
schema-verify.test.ts, search-all.test.ts, search-documents.test.ts, search-memory-list.test.ts,
shutdown.test.ts, supabase.test.ts, tag-validator.test.ts, token-endpoint.test.ts,
update-document.test.ts, uuid.test.ts, vault.test.ts, write-lock.test.ts,
write-lock-tools.test.ts, www-authenticate-headers.test.ts

Notable patterns: All external deps mocked, no I/O, fast (under 3s total). Tests run via `npm test` (vitest run with default config).

Failures (8 tests across 3 files):

config.test.ts (2 failures):
- "loads a valid config file..." — expected './test-vault', received '/tmp/test-vault'. Config loader resolves vault path to absolute; test expects the raw literal from YAML.
- "loads new nested instance.vault structure correctly" — same root cause.

document-tools.test.ts (4 failures):
- "calls writeMarkdown with correct relativePath and frontmatter fields" — mock UUID 'test-uuid-1234-5678-9abc-def012345678' does not match /^[0-9a-f-]{36}$/ regex.
- "caller frontmatter does not override fqc_id or status" — same UUID mock issue.
- "inserts fqc_documents row synchronously with correct fields" — same.
- "passes status:archived to writeMarkdown" — archive_document now calls writeMarkdown with a 4th argument { gitAction, gitTitle }; test expects 3-arg call via objectContaining.

resolve-document.test.ts (2 failures):
- "TSA-03: generates new fqc_id for ENOENT file" — mock UUID 'new-fqc-id-1234-5678-90ab-cdef01234567' fails UUID regex.
- "TSA-03: retries once on EACCES then degrades gracefully" — same.

Root cause pattern: Test fixtures use human-readable mock UUIDs (test-uuid-*, new-fqc-id-*) that do not satisfy the /^[0-9a-f-]{36}$/ regex used in assertions. The archive_document test is out of date with the current writeMarkdown call signature.

### Integration

File list (43 files): apply-tags.test.ts, authorize-endpoint.integration.test.ts,
authorize-token-exchange.integration.test.ts, change-notifications.test.ts,
compound-tools.integration.test.ts, correlation-traces.test.ts, create-doc-tags.test.ts,
crm.integration.test.ts, discovery-coordinator.integration.test.ts, discovery-errors.test.ts,
discovery-multi-plugin.test.ts, discovery-orchestrator.integration.test.ts,
discovery-scenarios.test.ts, document-tools-response-format.test.ts, documents.integration.test.ts,
e2e-workflows.test.ts, embedding.integration.test.ts, http-error-handler.test.ts,
identity-resolution.test.ts, logging.test.ts, phase14.integration.test.ts,
phase36-data-corruption.test.ts, phase38-error-resilience.test.ts,
plugin-propagation.integration.test.ts, plugin-records.integration.test.ts,
plugin-registration.test.ts, save-memory-tags.test.ts, scan-command.integration.test.ts,
scanner-change-notifications.test.ts, schema-migration.test.ts, search-all.integration.test.ts,
server-startup.test.ts, shutdown.integration.test.ts, supabase-schema-verify.test.ts,
supabase.test.ts, tag-match.integration.test.ts, token-endpoint.integration.test.ts,
token-endpoint-roundtrip.integration.test.ts, token-redaction.test.ts, tools-response-format.test.ts,
uat-phase-67.test.ts, update-header-tags.test.ts, write-lock.integration.test.ts

Env-var gate: HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL).

**Credentials status:** `.env.test` created and `flashquery.test.yml` updated with cloud Supabase credentials (2026-04-14). With credentials present: 263 → 37 skipped, 115 → 323 passed, 37 remaining skips are permanent `describe.skip` blocks or Ollama-gated tests.

**Newly surfaced failures after credentials added (additional to the original 55):**

- `update-header-tags.test.ts` (3 tests) — `create_document` response does not contain `fqc_id:` in the text; regex match returns null. Either response format changed or create is silently failing with real Supabase.
- `uat-phase-67.test.ts` (7 tests) — still ECONNREFUSED; these UAT tests need a live FQC server on port 3100 running before the test suite starts. Not a credentials issue.

Failing test files (original 10 + 2 newly surfaced) with root causes:

1. supabase.test.ts — hardcoded hostname db.test.supabase.co; DNS fails (ENOTFOUND). No skipIf guard. Cascade TypeError on cleanup when pg.Client is undefined.

2. token-endpoint-roundtrip.integration.test.ts, authorize-endpoint.integration.test.ts, authorize-token-exchange.integration.test.ts — /token endpoint returns HTTP 500. These tests spin up a local Express server (no Supabase needed), but the token handler throws at runtime — likely missing or null auth_secret in the test config fixture causing the signing step to crash.

3. token-redaction.test.ts (3 Auth failure logging tests) — "res.setHeader is not a function". Mock response object passed to auth middleware is missing setHeader; the middleware now calls res.setHeader for WWW-Authenticate.

4. discovery-coordinator.integration.test.ts, discovery-orchestrator.integration.test.ts — use Mocha-style this.skip() and expect.skip() to conditionally skip when Supabase is absent. Vitest does not support these patterns; they throw TypeError and the tests FAIL instead of skipping.

5. embedding.integration.test.ts (4 tests) — unconditionally tries to reach Ollama at http://localhost:11434; ECONNREFUSED. No skipIf guard.

6. phase14.integration.test.ts (1 test) — TAX-03 test is outside the describe.skipIf(SKIP) block and runs without Supabase, hitting a DB error.

7. uat-phase-67.test.ts (7 tests) — spins up FQC server on port 3100; server fails to start without valid flashquery.yaml config. All HTTP requests get ECONNREFUSED.

### E2E + MCP

File list (5 files):
tests/mcp/http-transport.test.ts
tests/mcp/protocol.test.ts
tests/e2e/authorize-flow.e2e.test.ts
tests/e2e/shutdown.e2e.test.ts
tests/e2e/token-endpoint.e2e.test.ts

Suite-level failures (2 files): authorize-flow.e2e.test.ts and token-endpoint.e2e.test.ts both error with "Server did not become ready within timeout". Both spawn dist/index.js; the server startup times out (likely due to missing credentials).

Passing files:
- shutdown.e2e.test.ts — 2 tests pass (SIGTERM, hard-deadline). Spawns minimal stdio server; no Supabase needed.
- protocol.test.ts — 23 tests pass (MCP protocol over stdio; mocked internals).
- http-transport.test.ts — 9 tests pass (also runs cleanly in HTTP suite).

Skipped (15): Tests in authorize-flow and token-endpoint that could not execute due to suite-level error.

### HTTP Transport

File: tests/mcp/http-transport.test.ts
Result: 9/9 pass. Covers HTTP server startup, DNS rebinding protection, session lifecycle (create, use, delete), and Bearer token authentication (valid, missing, invalid, wrong scheme). All green.

### Benchmark

File: tests/benchmark/discovery-performance.bench.ts
What it measures: Discovery pipeline performance over a synthetic vault. Includes document scanning, lock acquisition, and sequential multi-document discovery.
Result: 7/7 pass in 72 seconds.

---

## Structural Anomalies

### tests/tests/ — Nested Duplicate Directory

- Picked up by any vitest config? NO. None of the five vitest configs include tests/tests/**. These files are entirely dead weight and never executed.
- File count: 50 .test.ts files
- Subdirectory structure: tests/tests/unit/ (26 files), tests/tests/integration/ (22 files), tests/tests/mcp/ (2 files)
- Overlap with canonical dirs: All 50 filenames match files in canonical tests/unit/, tests/integration/, or tests/mcp/.
- Content identity: 29 files are byte-identical to their canonical counterpart. 21 files DIFFER — they represent an older or diverged version.
- Diverging files (21): supabase.test.ts (both unit and integration copies differ), logging.test.ts, crm.integration.test.ts, documents.integration.test.ts, compound-tools.integration.test.ts, protocol.test.ts, search-all.test.ts, tag-validator.test.ts, resolve-document.test.ts, auth-middleware.test.ts, record-tools.test.ts, document-tools.test.ts, git-manager.test.ts, projects-seeder.test.ts, compound-tools.test.ts, get-memory.test.ts, plugin-tools.test.ts, plugin-manager.test.ts, memory-tools.test.ts, scanner.test.ts
- Recommendation: DELETE tests/tests/ entirely. It is never run, it misleads developers into thinking these are active tests, and 21 diverging copies are a future source of confusion. Before deleting, diff the 21 diverging files against their canonical counterparts to confirm no useful in-progress fixes are stranded in tests/tests/.

---

## Skipped Tests Inventory

### Statically skipped (describe.skip — never run regardless of environment)

| File | Block | Skip Mechanism | Reason |
|------|-------|----------------|--------|
| tests/unit/resolve-document.test.ts:310 | ensureProvisioned describe block | describe.skip | No comment; function not yet fully specced |
| tests/unit/document-tools.test.ts:557 | TSA-04: targetedScan integration in document tools | describe.skip | "Workaround: move tests to separate file or refactor mock setup" |
| tests/unit/compound-tools.test.ts:195 | TSA-04: targetedScan integration in compound tools | describe.skip | Same workaround comment |
| tests/integration/write-lock.integration.test.ts:323 | multi-instance write locks | describe.skip | "requires test Supabase" — predates skipIf pattern; redundant |
| tests/integration/tools-response-format.test.ts:21 | entire file | describe.skip | "requires Supabase" — entire file permanently skipped; never migrated to skipIf |

### Environment-gated (describe.skipIf — skip when HAS_SUPABASE is false)

When .env.test is absent, these entire suites skip:
apply-tags, change-notifications, compound-tools.integration, create-doc-tags, crm.integration,
discovery-errors, discovery-multi-plugin, discovery-scenarios, document-tools-response-format,
documents.integration, e2e-workflows (4 nested describe blocks), identity-resolution, phase14.integration,
phase36-data-corruption, phase38-error-resilience, plugin-propagation.integration, plugin-records.integration,
plugin-registration, save-memory-tags, scan-command.integration, scanner-change-notifications,
schema-migration, search-all.integration, tag-match.integration, update-header-tags

Env-var logic (tests/helpers/test-env.ts):
  HAS_SUPABASE = !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && DATABASE_URL)
  OPENAI_API_KEY gates semantic-search sub-suite in plugin-records
  OLLAMA_URL defaults to http://localhost:11434 — no skipIf; tests FAIL not skip when Ollama absent

### Broken skip patterns (fail instead of skip)

| File | Mechanism used | Problem |
|------|----------------|---------|
| tests/integration/discovery-orchestrator.integration.test.ts | this.skip(), expect.skip() | Mocha API; not supported in Vitest |
| tests/integration/discovery-coordinator.integration.test.ts | this.skip(), expect.skip() | Same |

---

## Failing Tests

### Unit Suite

| File | Test Name | Error Summary |
|------|-----------|---------------|
| config.test.ts | loads a valid config file and returns a FlashQueryConfig object | Expected './test-vault', got '/tmp/test-vault' — loader resolves to absolute path |
| config.test.ts | loads new nested instance.vault structure correctly | Same root cause |
| document-tools.test.ts | calls writeMarkdown with correct relativePath and frontmatter fields | Mock UUID 'test-uuid-*' fails /^[0-9a-f-]{36}$/ regex |
| document-tools.test.ts | caller frontmatter does not override fqc_id or status | Same |
| document-tools.test.ts | inserts fqc_documents row synchronously with correct fields | Same |
| document-tools.test.ts | passes status:archived to writeMarkdown | archive_document passes 4 args; test expects 3 |
| resolve-document.test.ts | TSA-03: generates new fqc_id for ENOENT file | Mock UUID 'new-fqc-id-*' fails UUID regex |
| resolve-document.test.ts | TSA-03: retries once on EACCES then degrades gracefully | Same |

### Integration Suite

| File | Test Name | Error Summary |
|------|-----------|---------------|
| supabase.test.ts | Supabase integration (both) | ENOTFOUND db.test.supabase.co; hardcoded fake host |
| token-endpoint-roundtrip.integration.test.ts | Tests 1,4,5,6,7,8,12,13 | /token returns HTTP 500; token signing throws at runtime |
| authorize-endpoint.integration.test.ts | Integration with /token (3 tests) | Same /token 500 |
| authorize-token-exchange.integration.test.ts | All 13 tests | Same /token 500 |
| discovery-coordinator.integration.test.ts | skips integration tests + 3 db tests | TypeError: expect.skip is not a function |
| discovery-orchestrator.integration.test.ts | skips integration tests + 6 db tests | TypeError: this.skip() / expect.skip() |
| embedding.integration.test.ts | All 4 Ollama tests | ECONNREFUSED localhost:11434; no skipIf |
| phase14.integration.test.ts | TAX-03: create_document writes tags | Test outside skipIf block; Supabase unavailable |
| token-redaction.test.ts | 3 Auth failure logging tests | res.setHeader is not a function |
| uat-phase-67.test.ts | Tests 1-4, 6-8 | ECONNREFUSED 127.0.0.1:3100; needs live FQC server on port 3100 |
| update-header-tags.test.ts | normalizes tag updates in vault AND DB | create_document response missing fqc_id: — regex match returns null |
| update-header-tags.test.ts | conflicting status tags returns isError | Cascades from same create failure |
| update-header-tags.test.ts | detects existing document conflicts (D-07) | Cascades from same create failure |

### E2E + MCP Suite

| File | Suite Error | Notes |
|------|-------------|-------|
| tests/e2e/authorize-flow.e2e.test.ts | Server did not become ready within timeout | Spawns dist/index.js; startup fails without credentials |
| tests/e2e/token-endpoint.e2e.test.ts | Server did not become ready within timeout | Same |

---

## Key Observations

1. **Node 20 required; not documented.** System Node v18.19.1 crashes before any test runs (`node:util.styleText` requires Node 20+). Not documented in README or CLAUDE.md. Every contributor without nvm/Node 20 hits this immediately.

2. **Credentials gap closed (2026-04-14).** `.env.test` was created and `flashquery.test.yml` updated with real cloud Supabase credentials. Integration suite went from 115→323 passing, 263→37 skipped. The `.env.test.example` file referenced in CLAUDE.md still doesn't exist — worth adding for new contributors.

3. **`/token` endpoint has a real runtime regression.** Three integration test files (`token-endpoint-roundtrip`, `authorize-endpoint`, `authorize-token-exchange`) fail with HTTP 500 against a locally spun-up Express server — no Supabase needed. Token-signing handler is crashing, likely a null/missing config value. Highest-priority functional bug.

4. **`update-header-tags` failures newly surfaced with credentials.** `create_document` response no longer contains `fqc_id:` in a format the tests expect. Either the response text format changed or the create call is failing silently against real Supabase. Second-highest priority to investigate.

5. **Three "should skip, actually fails" patterns still need one-line fixes each.** (a) `supabase.test.ts` — hardcoded fake hostname, no skipIf; (b) `embedding.integration.test.ts` — unconditional Ollama connect, no skipIf; (c) two discovery files use Mocha `this.skip()`/`expect.skip()` which Vitest doesn't support.

6. **`tests/tests/` is 50 dead files; should be deleted.** No vitest config picks them up. 21 of 50 have diverged from canonical. Diff before deleting to confirm nothing useful is stranded there.

---

## Proposed Reorganization (input for next milestone or phase)

### Goals
- Remove all test tooling config from the project root
- Collapse the misleading `tests/mcp/` tier into `tests/e2e/`
- Delete dead `tests/tests/` tree
- Clean up orphan artifacts in `tests/fixtures/`

### Root files to move

| File | Move to | Notes |
|------|---------|-------|
| `vitest.config.ts` | `tests/config/vitest.unit.config.ts` | Rename for consistency |
| `vitest.integration.config.ts` | `tests/config/vitest.integration.config.ts` | |
| `vitest.e2e.config.ts` | `tests/config/vitest.e2e.config.ts` | Update include paths after mcp/ merge |
| `vitest.http.config.ts` | `tests/config/vitest.http.config.ts` | |
| `vitest.benchmark.config.ts` | `tests/config/vitest.benchmark.config.ts` | |
| `flashquery.test.yml` | `tests/fixtures/flashquery.test.yml` | Normalize extension to .yml (fixtures use .yaml) |

**Keep at root:** `tsconfig.json`, `tsup.config.ts`, `eslint.config.js` — IDE and toolchain convention; moving these requires `--tsconfig` flags everywhere and breaks editor integrations.

Each moved vitest config needs `root: resolve(__dirname, '../..')` added so include globs resolve from the project root. `package.json` scripts updated to `--config tests/config/vitest.*.config.ts`.

### `tests/` hierarchy changes

| Change | Action | Detail |
|--------|--------|--------|
| Delete `tests/tests/` | Delete entire directory | 50 dead files, no config picks them up; diff 21 diverging files first |
| Merge `tests/mcp/` → `tests/e2e/` | Move 2 files | `protocol.test.ts`, `http-transport.test.ts` are e2e tests; `mcp/` tier is misleading |
| Delete `tests/fixtures/tests/` | Delete nested dir | Scaffolding remnant; contains only an empty `fixtures/` subdir |
| Normalize fixture extensions | Rename `flashquery.test.yaml` → `flashquery.test.yml` | Consistency with all other `.yml` files; update references in `tests/unit/config.test.ts` and `tests/integration/supabase*.test.ts` |

### Proposed final layout

```
tests/
├── config/               ← NEW: all vitest configs
│   ├── vitest.unit.config.ts
│   ├── vitest.integration.config.ts
│   ├── vitest.e2e.config.ts
│   ├── vitest.http.config.ts
│   └── vitest.benchmark.config.ts
├── unit/                 (unchanged)
├── integration/          (unchanged)
├── e2e/                  ← absorbs tests/mcp/ (2 files)
├── helpers/              (unchanged)
├── fixtures/             (remove nested tests/ dir; normalize .yaml→.yml)
├── benchmark/            (unchanged)
└── scenarios/            (unchanged — Python framework, separate system)
```

### Files that need reference updates after move

- `package.json` — all 5 `--config` script args
- `tests/config/vitest.*.config.ts` — add `root: resolve(__dirname, '../..')` to each
- `tests/e2e/authorize-flow.e2e.test.ts` — mcp-server-fixture import path (if any)
- `tests/e2e/shutdown.e2e.test.ts` — no mcp/ refs; clean
- `tests/unit/config.test.ts` — fixture path if `.yaml`→`.yml` rename happens
- `tests/integration/supabase.test.ts`, `supabase-schema-verify.test.ts` — fixture path
- `tests/helpers/mcp-server-fixture.ts` — no path changes needed from mcp/ merge

---

## Issue → Phase Map

Every identified issue maps to a specific phase in PLAN.md.

| Issue | Phase | Type |
|-------|-------|------|
| 5 vitest configs cluttering root | Phase 1-A | Infra |
| `flashquery.test.yml` at root | Phase 1-B | Infra |
| `tests/tests/` 50 dead files | Phase 1-C | Infra |
| `tests/fixtures/tests/` scaffolding remnant | Phase 1-C | Infra |
| `tests/mcp/` misleading separate tier | Phase 1-D | Infra |
| `flashquery.test.yaml` extension inconsistency | Phase 1-E | Infra |
| Unit: mock UUIDs fail regex (6 tests) | Phase 2 | Test defect |
| Unit: `archive_document` 3-arg vs 4-arg (1 test) | Phase 2 | Test defect |
| Unit: config vault path absolute vs relative (2 tests) | Phase 2 | Test defect |
| Integration: `supabase.test.ts` hardcoded hostname | Phase 2 | Test defect |
| Integration: `embedding.integration.test.ts` no Ollama skipIf | Phase 2 | Test defect |
| Integration: discovery files use Mocha `this.skip()` | Phase 2 | Test defect |
| Integration: `token-redaction.test.ts` mock missing `setHeader` | Phase 2 | Test defect |
| Integration: `tools-response-format.test.ts` permanent `describe.skip` | Phase 2 | Test defect |
| Integration: `write-lock` multi-instance permanent `describe.skip` | Phase 2 | Test defect |
| `/token` endpoint HTTP 500 (24 failing tests) | Phase 3 | **FQC bug** |
| `create_document` response missing `fqc_id:` (3 tests) | Phase 3 | **FQC bug** |
| E2E server startup timeout (15 skipped tests) | Phase 3 | FQC bug / config |
| Missing `.env.test.example` for contributors | Phase 4 | Contributor UX |
| Node 20 requirement undocumented | Phase 4 | Contributor UX |
| No `engines` field in `package.json` | Phase 4 | Contributor UX |

**Summary by type:**
- Infra reorganization: 6 items (Phase 1)
- Test defects (not FQC bugs): 10 items (Phase 2) → ~31 tests fixed
- FQC bugs surfaced by tests: 3 items (Phase 3) → ~42 tests fixed/unblocked
- Contributor experience: 3 items (Phase 4)
