# FlashQuery — Scenario Tests

This folder contains two complementary test suites that together verify FlashQuery's behavior across the full stack. Both suites run against a live FlashQuery server (managed or external) and share the same `framework/` and `dbtools/` infrastructure.

## ⚠️ Database Warning

**Both test runners delete every row in every `fqc_*` table before and after each test.** This guarantees a clean slate between runs. The consequence is that any data in those tables is permanently destroyed.

**Only ever point these tests at a throwaway Supabase or PostgreSQL instance created specifically for testing.** Never use a development, staging, or production database.

## The Two Suites

### [`directed/`](./directed/) — Directed Scenario Tests

Python-authored tests, each focused on a specific behavior or coverage point. Deep assertions — file content on disk, frontmatter field values, exact tool response format. Organized against a coverage matrix (`directed/DIRECTED_COVERAGE.md`) that tracks which behaviors are verified and by which test.

Run with:
```bash
python3 tests/scenarios/directed/run_suite.py --managed
```

See [`directed/README.md`](./directed/README.md) for the full guide.

### [`integration/`](./integration/) — Integration Tests

YAML-authored tests that exercise multi-step cross-domain workflows: write a document, write a memory, archive one, verify the other survives. Coarser assertions than the directed suite; faster to author and read. Organized against a separate coverage matrix (`integration/INTEGRATION_COVERAGE.md`).

Run with:
```bash
python3 tests/scenarios/integration/run_integration.py --managed
```

See [`integration/README.md`](./integration/README.md) for the full guide.

## Shared Infrastructure

| Folder | Purpose |
|--------|---------|
| `framework/` | MCP client, TestContext, TestRun, FlashQuery server, vault and git helpers. Used by both suites. |
| `dbtools/` | Debug and operational scripts for the test database. Shared. See [`dbtools/README.md`](./dbtools/README.md). |
| `mcp/` | Standalone CLI wrappers for individual MCP tools — useful for ad-hoc debugging. |
