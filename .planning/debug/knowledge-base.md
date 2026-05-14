---
status: resolved
updated: 2026-05-14T03:05:00Z
---

# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## test-failures-24-tests — 24 unit tests failing due to v1.7 schema refactoring (removed projects/areas model)
- **Date:** 2026-03-31
- **Error patterns:** 24 tests failing, result.isError, vault_path, project field, config.defaults.project, fqc_projects, compound-tools.test.ts, document-tools.test.ts, expected true to be undefined
- **Root cause:** Phase 22 removed the projects/areas model and fqc_projects table, changing schema from vault_path to path, from project field to tags. However, handlers and test mocks still referenced the old schema: get_document() used config.defaults.project (removed), test makeConfig() used old config structure, test mocks expected vault_path instead of path, and get_briefing tried to query removed fqc_projects table.
- **Fix:** Removed docProject calculation from get_document. Changed fqc_documents insert to use path instead of vault_path. Removed project field from fqc_documents insert/update. Simplified get_briefing to not query fqc_projects. Updated test mocks to use path instead of vault_path and corrected query chain filters. Updated compound-tools test makeConfig() to use correct v1.7 config structure.
- **Files changed:** flashquery-core/src/mcp/tools/compound.ts, flashquery-core/src/mcp/tools/documents.ts, flashquery-core/tests/unit/compound-tools.test.ts, flashquery-core/tests/unit/document-tools.test.ts
---

## supabase-backup-not-triggering — backup never runs because dump_schedule key absent from example config; verification doc described old design
- **Date:** 2026-03-26
- **Error patterns:** backup, supabase, dump, .fqc, supabase-dump.sql, no files, missing folder, scheduleDump, dump_schedule
- **Root cause:** Backup feature is opt-in via `dump_schedule` config key under `git:`. The key was absent from flashquery.example.yaml with no documentation, so users copying the example config never trigger backups. Implementation also diverged from original plan — actual output is `.fqc/backup.json` (JSON via pg.Client), not `.fqc/supabase-dump.sql` (SQL via supabase CLI).
- **Fix:** Added commented `dump_schedule` entry to flashquery.example.yaml. Corrected 3 stale references in 11-VERIFICATION.md (truth #5, GIT-03 row, human verify step) to reflect actual implementation.
- **Files changed:** flashquery-core/flashquery.example.yaml, .planning/phases/11-git-integration/11-VERIFICATION.md
---

## fqc-documents-duplicate-rows — update_document MCP tool creates duplicate rows instead of updating existing row
- **Date:** 2026-03-26
- **Error patterns:** duplicate rows, fqc_documents, fqc_id, update_document, create_document, uuidv4, INSERT, new row, overwrite
- **Root cause:** Two-part root cause. (1) No update_document tool existed — model fell back to create_document which always generates a new uuidv4() fqcId and INSERTs a new row. (2) create_document accepted an explicit `path` parameter and when called with a path to an existing FQC file, silently overwrote the file's fqc_id with a new UUID and inserted a duplicate DB row.
- **Fix:** Added update_document tool to documents.ts. Added guard in create_document: when an explicit path is given and the file already exists with a valid fqc_id in its frontmatter, returns isError directing caller to use update_document instead.
- **Files changed:** flashquery-core/src/mcp/tools/documents.ts, flashquery-core/tests/unit/document-tools.test.ts
---

## e2e-tests-drop-supabase-tables — integration tests drop all core Supabase tables on teardown
- **Date:** 2026-03-26
- **Error patterns:** tables gone, drop table, teardown, supabase, fqc_event_log, fqc_routing_rules, fqc_plugin_registry, fqc_projects, fqc_memory, match_memories, missing tables after tests
- **Root cause:** teardownTestSupabase() in tests/helpers/supabase.ts executed DROP TABLE DDL for six core fqc_ tables and DROP FUNCTION match_memories. supabase.test.ts called this in afterAll on every integration test run, destroying all core tables except fqc_documents on the live Supabase instance.
- **Fix:** Replaced teardownTestSupabase() with cleanupTestRows(client, instanceId) that issues row-level DELETE WHERE instance_id = $1 for each core table. Old function kept as a tombstone that throws to prevent reintroduction. supabase.test.ts updated to call cleanupTestRows() with TEST_INSTANCE_ID = 'test-fqc'.
- **Files changed:** flashquery-core/tests/helpers/supabase.ts, flashquery-core/tests/integration/supabase.test.ts
---

## setup-sh-uat-issues — Dockerfile UID 1000 collision, .env not loaded by docker-compose, prompts lack self-hosted examples
- **Date:** 2026-03-30
- **Error patterns:** adduser, uid 1000 in use, DATABASE_URL variable is not set, Defaulting to a blank string, docker-compose, env_file, .env not found, self-hosted, Supabase prompt
- **Root cause:** Three issues: (1) node:20-alpine base image already has UID 1000 (node user), so `adduser -D -u 1000` fails. (2) docker-compose.fqc-only.yml had no `env_file` directive; Docker Compose resolves .env relative to compose file location (docker/), not CWD, so flashquery-core/.env was never read. (3) Prompts only showed Supabase Cloud examples with no self-hosted format including ports.
- **Fix:** (1) Removed hardcoded `-u 1000` from Dockerfile adduser. (2) Added `env_file: ../flashquery-core/.env` to all docker-compose files. (3) Enhanced prompts with self-hosted examples and .env backup strategy.
- **Files changed:** flashquery-core/Dockerfile, docker/docker-compose.fqc-only.yml, docker/docker-compose.yml, docker/docker-compose.db-only.yml, flashquery-core/setup.sh
---

## setup-sh-docker-and-ux — deprecated docker-compose v1 CLI and confusing nested deployment options
- **Date:** 2026-03-30
- **Error patterns:** docker-compose not found, docker-compose, deprecated, deployment options, nested prompt, 4 options, docker compose v2
- **Root cause:** setup.sh used `docker-compose` (hyphenated v1 CLI) throughout, which fails on systems with only Docker Compose v2 plugin. Deployment UX presented 3 options with a nested Supabase sub-prompt instead of 4 clear upfront choices.
- **Fix:** Replaced all `docker-compose` CLI calls with `docker compose` (v2 syntax). Restructured deployment prompt to 4 clear upfront options including FQC-in-Docker + external Supabase.
- **Files changed:** flashquery-core/setup.sh
---

## supabase-match-memories-signature — PostgreSQL 42P13 error when upgrading schema: cannot change return type of existing function
- **Date:** 2026-03-30
- **Error patterns:** 42P13, cannot change return type of existing function, Row type defined by OUT parameters is different, match_memories, DROP FUNCTION, Phase 23
- **Root cause:** Phase 23 modified match_memories function signature from 8 RETURNS TABLE columns (id, content, project, tags, category, source_context, similarity, created_at) to 7 columns (removed category, source_context; added plugin_scope). PostgreSQL 42P13 blocks CREATE OR REPLACE when RETURNS TABLE structure differs. Upgrading pre-Phase 23 databases hit this error because old function existed with incompatible signature.
- **Fix:** Added DROP FUNCTION IF EXISTS match_memories(vector, double precision, integer, text, text[], text) CASCADE before CREATE OR REPLACE FUNCTION in buildSchemaDDL(). PostgreSQL requires dropping incompatible functions before recreating with new signatures.
- **Files changed:** flashquery-core/src/storage/supabase.ts
---

## setup-generates-invalid-config — npm run setup generates invalid flashquery.yml with deprecated projects and defaults sections
- **Date:** 2026-03-30
- **Error patterns:** npm setup, flashquery.yml, projects, areas, defaults, project, invalid config, npm dev fails, Config error removed in v1.7
- **Root cause:** setup.sh was generating deprecated 'projects:' and 'defaults:' sections that were removed in v1.7. These sections are explicitly rejected by config/loader.ts with error message "Config error: 'projects' configuration removed in v1.7 ... Remove the 'projects:' section from your config file."
- **Fix:** Removed lines 303-304 from flashquery-core/setup.sh that generated the deprecated sections in the YAML template. Generated flashquery.yml now contains only valid v1.7 sections: instance, server, supabase, git, mcp, embedding, logging.
- **Files changed:** flashquery-core/setup.sh
---

## startup-crash-undefined-areas — npm run dev crashes immediately after Git initialization with "Cannot read properties of undefined (reading 'areas')"
- **Date:** 2026-03-30
- **Error patterns:** areas undefined, reading 'areas', Cannot read properties, startup crash, Git initialized, config.projects, initProjects
- **Root cause:** initProjects() in flashquery-core/src/projects/seeder.ts was called on startup (line 292 of index.ts) immediately after Git initialization. The function accessed config.projects.areas on line 7, but config.projects field no longer exists in v1.7 config schema (removed in Phase 22 when projects/areas model was eliminated). Phase 22 removed fqc_projects table from database schema and removed 'projects' config field, but did not remove the initProjects call or update the seeder function.
- **Fix:** Removed the call to initProjects() from line 292 of flashquery-core/src/index.ts and removed the import statement for initProjects from line 15. Since fqc_projects table was removed in Phase 22, the seeder function is no longer needed in v1.7.
- **Files changed:** flashquery-core/src/index.ts
---

## force-file-scan-embed-drain — force_file_scan returns before in-flight embedding promises complete, causing semantic search to find 0 results
- **Date:** 2026-04-16
- **Error patterns:** force_file_scan, search_all, 0 results, no documents found, embedding, in-flight, background embed, SA-01, semantic search, embeddings, fire-and-forget, race condition, timing
- **Root cause:** runScanOnce fired all embedding calls as void fire-and-forget promises and returned without awaiting them. Additionally, create_document spawns background embeds that the scanner has no reference to. When force_file_scan(background=False) was used as a synchronization point, it returned before any in-flight embeds completed, leaving documents with NULL embedding vectors in the DB. Semantic search returned 0 results for those documents until the embeds eventually landed (~2500ms later).
- **Fix:** Collected all scanner embed promises into an embedPromises array, queried DB for NULL-embedding docs after the scan loop to catch create_document's in-flight embeds, then awaited Promise.allSettled with a 30s timeout before returning. Added embeddingStatus and embedsAwaited to ScanResult and surfaced them in the MCP response.
- **Files changed:** src/services/scanner.ts, src/mcp/tools/scan.ts
---

## shutdown-http-server-error — graceful shutdown crashes with "this.httpServer.close is not a function" when Ctrl+C is pressed
- **Date:** 2026-04-09
- **Error patterns:** shutdown, httpServer.close is not a function, Shutdown failed, Ctrl+C, SIGINT, graceful shutdown, Express app, http.Server
- **Root cause:** src/mcp/server.ts initMCP function at line 579 returned the Express app instance instead of the underlying http.Server object. Return type annotation declared Promise<http.Server | undefined>, but the HTTP path returned `app` (Express app has no .close() method). The http.Server is created internally by app.listen() but the reference was never captured or returned. ShutdownCoordinator received the Express app and crashed when calling this.httpServer.close().
- **Fix:** Modified src/mcp/server.ts lines 572-580 to capture the http.Server object returned by app.listen(). Changed Promise type from <void> to <http.Server>, captured the server reference with `const server = app.listen(...)`, attached error handler to server, and returned httpServer instead of app.
- **Files changed:** flashquery-core/src/mcp/server.ts
---
