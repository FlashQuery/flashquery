---
name: flashquery-integration-testgen
description: >
  Create, validate, run, and register FlashQuery YAML integration tests against the
  integration coverage matrix. Use this skill whenever the user wants to write a new
  integration test, add coverage for a multi-step or cross-domain behavior, reference
  INTEGRATION_COVERAGE.md goals, or says anything like "write an integration test for X",
  "cover IS-06", "test that archive removes from search", "add a YAML test for this behavior",
  or "let's cover more of the integration matrix". Also trigger for requests like "write a
  test that verifies documents and memories interact correctly", "cover this workflow end-to-end",
  or "add a test for this multi-step scenario". Integration tests use a declarative YAML DSL
  (not Python) — this skill handles the full lifecycle: writing the YAML, running it, debugging
  failures, and registering it against INTEGRATION_COVERAGE.md.
---

# FlashQuery Integration TestGen

You are writing a FlashQuery integration test. Integration tests verify multi-step,
cross-domain behaviors — write a document and a memory, confirm both are discoverable,
archive one, confirm the other is unaffected — expressed as a compact YAML step sequence
and run through a direct interpreter. The YAML *is* the test; no Python, no compilation.

The companion skill for running tests is `flashquery-integration-run`. The companion skill
for managing the coverage matrix is `flashquery-integration-covgen`.

## Project layout

```
tests/scenarios/integration/
  README.md                      ← Complete YAML format reference (always read before writing)
  INTEGRATION_COVERAGE.md        ← Coverage matrix (read first to find target IDs)
  run_integration.py             ← Test runner
  tests/
    *.yml                        ← Integration test files (your output goes here)
  reports/
    integration-report-*.md      ← Generated reports from runs
```

The shared Python framework (`../framework/`) powers the runner but you don't write against
it directly. Cleanup, server lifecycle, and variable binding are all handled by the runner.

## Workflow

### Phase 1: Identify coverage targets

Read `tests/scenarios/integration/INTEGRATION_COVERAGE.md`. Find the IDs the user is
asking about, or identify uncovered rows worth targeting.

Coverage categories:
- **IS-** Search Coherence — write then find, entity filtering, cross-domain visibility
- **IA-** Archive / State Transitions — archive removes from search, memory survives archive
- **IX-** Cross-Domain — behaviors spanning documents and memories together
- **IC-** Content Operations — update, scan, path handling, tag behavior after mutation

If any target ID involves semantic body-text search (`search_documents` or `search_all` by
content, not title), the test needs `deps: [embeddings]`. Flag this upfront — without an
embedding provider configured, the test will be skipped automatically (not failed).

### Phase 2: Read the format reference

Read `tests/scenarios/integration/README.md` before writing anything. It is the authoritative
format guide. Pay particular attention to:

- The difference between action arg placement (top-level keys) and assert arg placement
  (nested inside `assert:`)
- The `expect_count_*` limitation: only counts `Title:` lines, so it counts documents but
  always returns 0 for memories. Use `expect_contains` / `expect_not_contains` for memory assertions.
- Reserved keys (`action`, `label`, `name`, `args`) — these are consumed by the runner and
  must never be used as inline tool argument names. Use an explicit `args:` block if needed.
- Path auto-prefixing: `vault.write` paths are automatically prepended with `_integration/`.
  Write `path: "journal/notes.md"` and it becomes `_integration/journal/notes.md`.

### Phase 3: Look at existing tests

Before writing, read one or two `.yml` files from `tests/scenarios/integration/tests/` that
are adjacent to what you're building. The existing tests are the canonical style reference.

### Phase 4: Write the YAML test

Create a new `.yml` file under `tests/scenarios/integration/tests/`. Follow the conventions
below. Read the complete annotated example in `README.md` for the full picture.

#### File structure

```yaml
name: <snake_case_test_name>        # required — matches filename (without .yml)
description: >                      # optional but strongly recommended
  Human-readable explanation. One paragraph. What does this test verify?
  What assumption is it based on? Any relevant dep notes (e.g., "requires embeddings").
coverage: [IS-01, IS-02]            # list of INTEGRATION_COVERAGE.md IDs this test covers

deps: [embeddings]                  # omit if no special capabilities are needed

steps:
  - ...
```

`coverage` and `deps` each accept a single string or a list.

#### Action steps

```yaml
- label: "Write a document about stars"    # optional label — always include one
  action: vault.write                       # required
  name: star_doc                            # optional — binds response fields for later use
  path: "astronomy/stars.md"               # tool argument (inline, not nested)
  title: "The Stars at Midnight"
  content: "Stars are ancient suns..."
  tags: [astronomy, stars, mytest-tag]     # always include a unique per-test tag
```

**Action shortcuts and their variable fields:**

| `action:` | MCP tool | Binds |
|-----------|----------|-------|
| `vault.write` | `create_document` | `fqc_id`, `path`, `title`, `status` |
| `memory.write` | `save_memory` | `memory_id`, `content` |
| `archive_document` | `archive_document` | — |
| `update_document` | `update_document` | — |
| `scan_vault` | `force_file_scan` | — |
| *(any MCP tool name)* | called directly | — |

Only `vault.write` and `memory.write` support variable binding (`name:` on other actions has no effect).

**When to use `args:` block.** If a tool argument collides with a reserved key (`action`,
`label`, `name`, `args`), or if you prefer the explicit style, use `args:`:

```yaml
- label: "Archive by fqc_id"
  action: archive_document
  args:
    identifiers: "${star_doc.fqc_id}"
```

#### Assert steps

```yaml
- label: "Document appears in search"
  assert:
    op: search_all          # required — MCP tool to call
    args:                   # args are nested inside assert:, NOT at top-level
      query: "The Stars at Midnight"
      entity_types: [documents]
    expect_path: "astronomy/stars.md"
    expect_not_contains: "Mercury"
    expect_count_eq: 1
```

All `expect_*` keys on a step are ANDed. All assert steps run regardless of earlier failures.

**Full assertion vocabulary:**

| Key | Type | Behavior |
|-----|------|----------|
| `expect_contains` | string | Response text must contain this substring |
| `expect_not_contains` | string | Response text must NOT contain this substring |
| `expect_path` | string | Same as `expect_contains` — labeled as a path check |
| `expect_path_contains` | string | Same as `expect_contains` — labeled as partial path check |
| `expect_empty` | `true` | Document count must be 0 |
| `expect_count_eq` | integer | Document count must equal N |
| `expect_count_gte` | integer | Document count must be ≥ N |
| `expect_count_lte` | integer | Document count must be ≤ N |

**Memory count limitation.** `expect_count_*` and `expect_empty` count `Title:` lines in
the response text — documents produce `Title:` lines; memories do not. Count assertions
work reliably for documents. For memories, always use `expect_contains` / `expect_not_contains`.

#### Variable binding

```yaml
- action: vault.write
  name: sunset_doc
  path: "journal/sunsets.md"
  title: "Watching the Sunset"
  content: "..."
  tags: [mytest-tag]

- action: archive_document
  args:
    identifiers: "${sunset_doc.fqc_id}"    # resolved at runtime
```

Available fields: `vault.write` → `fqc_id`, `path`, `title`, `status` |
`memory.write` → `memory_id`, `content`

The `path` field reflects the auto-prefixed path (e.g. `_integration/journal/sunsets.md`).

#### Key conventions

**Always include a unique per-test tag.** Every `vault.write` and `memory.write` step should
include a short tag that's unique to this test (e.g. `arc-tag`, `wts-tag`). Use it in
`list_memories` args to scope retrieval to this test's memories only. The runner handles
cleanup via IDs, but a unique tag prevents cross-test bleed in list/search operations.

**Use title queries by default, not body-content queries.** Without `deps: [embeddings]`,
`search_all` and `search_documents` fall back to title and path matching. Body content
won't appear in results. If you need to assert on body content via search, declare
`deps: [embeddings]` — the test will then skip on servers without embedding config,
rather than fail misleadingly.

**Design action steps first, then assertions.** Action failures abort the test; assert
failures don't. Set up all prerequisite state before asserting anything about it.

**Add the test's coverage IDs to INTEGRATION_COVERAGE.md before running.** The runner
updates rows that already exist; it doesn't create new ones. If a row doesn't exist for
your target ID, the coverage update is silently skipped.

### Phase 5: Validate

```bash
python3 -c "import yaml; yaml.safe_load(open('tests/scenarios/integration/tests/<name>.yml'))"
```

Fix any parse errors before running.

### Phase 6: Run

```bash
python3 tests/scenarios/integration/run_integration.py --managed <test_name>
```

The test name is the filename without `.yml`. Check stderr for the live step-by-step output.
If the run generates a report in `tests/scenarios/integration/reports/`, read it for full detail.

**Common failure patterns:**

- **`expect_path` fails on a newly written doc**: Add a `scan_vault` action step between the
  `vault.write` and the first assert. The indexer may not have caught up.
  ```yaml
  - action: scan_vault
  ```
- **`expect_contains` fails on memory content via `search_all`**: This requires embeddings.
  Either add `deps: [embeddings]`, or switch to `list_memories` with a tag filter.
- **`expect_count_eq: 1` fails with 0**: Check whether you're asserting on a memory result
  (count is always 0 for memories). Switch to `expect_contains`.
- **Variable reference error**: Confirm the step that binds the variable has `name:` set,
  and that the field name matches what's available (only `fqc_id`, `path`, `title`, `status`
  for `vault.write`; `memory_id`, `content` for `memory.write`).
- **Action fails with "not found"**: An earlier action step failed and its variable is
  unresolved. Check the report for which step failed and why.

If a failure looks like FlashQuery is doing something incorrect (the test is properly written but
FlashQuery returns wrong data), stop and report it. Do not modify the test to pass incorrect behavior.
Update `INTEGRATION_COVERAGE.md` with `FAIL (YYYY-MM-DD)` and note the test name with `*`.

### Phase 7: Update INTEGRATION_COVERAGE.md

The runner auto-updates `Covered By`, `Date Updated`, and `Last Passing` for passing tests
on each run, so you don't need to touch those columns manually after a successful run. What
you *do* need to do:

1. **Before running**: ensure rows exist for all `coverage:` IDs in the test. Add any missing
   rows following the existing format (see `flashquery-integration-covgen` if you need to add
   new categories or IDs).
2. **On pass**: the runner handles the columns. Verify after the run that the matrix reflects
   the new passing date.
3. **On fail (FlashQuery defect)**: manually set `Last Passing` to `FAIL (YYYY-MM-DD)` and suffix
   the test name in `Covered By` with `*`.

### Phase 8: Offer a git commit

After the matrix is updated and the test passes, offer to commit:

```
test(integration): add <test_name> covering <comma-separated IDs>

Covers: <ID list>
All steps passing as of <YYYY-MM-DD>.
```

Do not push — leave that to the user.
