# Integration Tests

Integration tests verify multi-step, cross-domain behaviors in FlashQuery: write a document and a memory, confirm both are discoverable, archive one, confirm the other is unaffected. Where scenario tests exercise individual MCP tool chains in Python, integration tests express these workflows in a compact YAML DSL and run them through a direct interpreter — no code generation, no compilation. The YAML is the test.

The distinction from scenario tests is one of scope and authoring style. Scenario tests are Python programs with fine-grained control over every assertion. Integration tests are declarative step sequences that describe a workflow and check its outcomes. They're faster to write, easier to read as a behavioral specification, and they map directly to a coverage matrix of named behaviors — making it clear at a glance what the test suite does and does not cover.

## Where to go for what

- **What behaviors are covered** — [`INTEGRATION_COVERAGE.md`](./INTEGRATION_COVERAGE.md). The coverage matrix is the source of truth for what the integration suite verifies. It is updated automatically after each run.
- **The YAML test format** — [YAML Format](#yaml-format) section below, or look at any file under `tests/` as a working example.
- **Running the suite** — `run_integration.py` discovers and runs all YAML tests under `tests/`, produces a timestamped markdown report, and updates the coverage matrix. `python3 run_integration.py --help` for the full flag list.
- **Shared test framework** — `../framework/`. Integration tests reuse `TestContext`, `TestRun`, FlashQuery Client, and `TestCleanup` from the parent scenario framework unchanged. See [`../README.md`](../README.md) for the full framework docs.

## ⚠️ Database Warning

**The integration test runner deletes every row in every `fqc_*` table before and after each test.** This is intentional — it guarantees that tests don't see each other's data. The consequence is that any data in those tables is permanently destroyed.

**Only ever point these tests at a throwaway Supabase or PostgreSQL instance created specifically for testing.** Never use a development, staging, or production database. If your `DATABASE_URL` in `.env` or `.env.test` points at anything other than a dedicated test database, stop and fix that before running anything here.

## Prerequisites

Same as the parent scenario suite — see [Prerequisites in the scenarios README](../README.md#prerequisites). In short:

```bash
pip install requests pyyaml python-dotenv
```

`flashquery.yml` and `.env` (or their `.test` variants) must be present at the project root for auto-discovery to work. If you're already running FlashQuery locally, they're already there.

For `--managed` mode, `dist/index.js` must exist. `run_integration.py` checks this automatically and rebuilds if the source is newer — you don't need to run `npm run build` manually before each run.

## How to Run

All commands below assume you're at the `tests/scenarios/integration/` directory, or adjust paths accordingly. Run `python3 run_integration.py --help` for the full flag reference; the recipes below cover the common cases.

### Quick start

To run all the tests without spinning up FlashQuery first (the runner will build and start it):

```bash
python3 run_integration.py --managed
```

To run all the tests when you are already hosting FlashQuery locally, or in a container:

```bash
python3 run_integration.py --url http://localhost:3100
```

### Run specific tests

```bash
# By filename or stem (extension optional)
python3 run_integration.py write_then_search.yml
python3 run_integration.py write_then_search

# Plain word — treated as a substring match (no wildcards needed)
# Runs all tests whose filename contains "archive"
python3 run_integration.py archive

# Explicit glob pattern
python3 run_integration.py "*search*"

# Multiple patterns (any combination of the above)
python3 run_integration.py write_then_search cross_domain_search

# Absolute or relative path from CWD
python3 run_integration.py tests/write_then_search.yml
```

If no match is found, the runner lists available tests and exits.

### Useful flags

```bash
# Stop after the first failing test
python3 run_integration.py --managed --stop-on-fail

# Shuffle execution order with a reproducible seed (surfaces order-dependent tests)
python3 run_integration.py --managed --seed 42

# Enable git in the managed server's vault (for git-behavior tests)
python3 run_integration.py --managed --enable-git

# Enable write-lock contention handling (for locking-behavior tests)
python3 run_integration.py --managed --enable-locking

# Use a specific port range for the managed server (if the default 9100–9199 conflicts)
python3 run_integration.py --managed --port-range 9200 9299

# Point at a specific FlashQuery server instead of using auto-discovered config
python3 run_integration.py --url http://localhost:3001/mcp --secret mysecret

# Emit structured JSON on stdout (human progress still goes to stderr)
python3 run_integration.py --json
```

## Directory Structure

```
tests/scenarios/integration/
├── README.md                   This file
├── INTEGRATION_COVERAGE.md     Coverage matrix — updated after each run
├── run_integration.py          Test runner: interprets YAML tests, generates reports
│
├── tests/                      YAML integration test cases (see INTEGRATION_COVERAGE.md)
│
└── reports/                    Generated markdown reports (gitignored)
    └── integration-report-YYYY-MM-DD-HHMMSS.md
```

The `tests/` directory is the only place `run_integration.py` looks for tests by default. Drop a new `.yml` or `.yaml` file there and it will be picked up automatically on the next run.

---

## YAML Format

Each YAML file describes one test. The top-level keys are:

```yaml
name: write_then_search           # required — used in reports and coverage matrix
description: >                    # optional — appears in run output and report header
  Human-readable explanation of what this test verifies.
coverage: [IS-01, IS-02]          # optional — IDs updated in INTEGRATION_COVERAGE.md
deps: [embeddings]                # optional — capabilities this test requires (see Deps)

steps:
  - ...                           # flat list of action and assert steps
```

`coverage` and `deps` each accept either a single string or a list:

```yaml
coverage: IS-01           # single ID — equivalent to coverage: [IS-01]
deps: embeddings          # single dep — equivalent to deps: [embeddings]
```

---

### Action steps

Action steps perform operations against the live FlashQuery server. The `action:` key names the operation; remaining keys are tool arguments.

```yaml
- label: "Write a document"       # optional — shown in run output and report
  action: vault.write             # required — operation to perform
  name: ocean_doc                 # optional — binds response fields for later steps
  path: "nature/ocean.md"         # tool argument
  title: "The Ocean at Dawn"      # tool argument
  content: "The bioluminescent waves crash against the shore."
  tags: [nature, wts-tag]
```

**Reserved keys** — `action`, `label`, `name`, and `args` are consumed by the runner and never forwarded to the tool. Do not use these as tool argument names in an inline step. If a tool genuinely requires an argument named one of these, use an explicit `args:` block instead (see below).

**Supported action shortcuts:**

| `action:` value | MCP tool called | Notes |
|---|---|---|
| `vault.write` | `create_document` | Path is auto-prefixed with `_integration/` (see below) |
| `memory.write` | `save_memory` | — |
| `archive_document` | `archive_document` | — |
| `update_document` | `update_document` | — |
| `scan_vault` | `force_file_scan` | `background` is always forced to `false` |
| any other string | called as-is | Direct MCP tool name |

**Path auto-prefixing.** `vault.write` paths are automatically prefixed with `_integration/` if they don't already start with it. This scopes all integration test files under a dedicated subdirectory and keeps them out of real vault content. The prefixed path (not the original) is what ends up in the response and in any bound variables.

**Explicit `args:` block.** When a step has an `args:` key, only its contents are used as tool arguments — all other top-level step keys are ignored for argument purposes. Use this for tools with argument names that collide with reserved keys, or simply when you prefer the explicit style:

```yaml
- label: "Archive the document"
  action: archive_document
  args:
    identifiers: "${ocean_doc.fqc_id}"
```

**`memory.write` args.** The underlying tool is `save_memory`. Pass `content` and optionally `tags`:

```yaml
- label: "Write a memory"
  action: memory.write
  name: mountain_mem
  content: "Mountain peaks covered in snow remind me of clarity."
  tags: [wts-tag]
```

**`scan_vault`.** No arguments needed — the runner forces `background: false` automatically:

```yaml
- label: "Scan the vault"
  action: scan_vault
```

**Failure behavior.** If an action step fails, the test is aborted immediately. Subsequent steps that reference the failed step's bound variables would error, so there is no value in continuing. The failure and all prior step results are recorded in the report.

---

### Assert steps

Assert steps call an MCP tool and check the result against one or more expectations.

```yaml
- label: "Document is searchable"   # optional
  assert:
    op: search_all                  # required — MCP tool to call
    args:                           # optional — tool arguments (inside assert:, not at step level)
      query: "The Ocean at Dawn"
      entity_types: [documents]
    expect_path: "nature/ocean.md"
    expect_contains: "The Ocean at Dawn"
```

Note the structure: `args:` is nested inside the `assert:` block, not at the step level like action args. This is different from action steps.

**All `expect_*` keys on a step are evaluated simultaneously.** They are ANDed — the step fails if any one of them fails. You can combine as many as needed on a single step:

```yaml
- assert:
    op: search_all
    args:
      query: "Spiral Galaxies"
      entity_types: [documents]
    expect_path: "cosmos/galaxies.md"
    expect_not_contains: "Nebulae"
    expect_count_eq: 1
```

**Assert failures do not abort the test.** Unlike action failures, all assert steps run regardless of earlier assertion failures. This gives you a full picture of what passed and what didn't in a single run.

**Full assertion vocabulary:**

| Key | Type | Behavior |
|---|---|---|
| `expect_contains` | string | Response text must contain this string (case-sensitive substring match) |
| `expect_not_contains` | string | Response text must NOT contain this string |
| `expect_path` | string | Shorthand: response text must contain this string, labeled as a path check |
| `expect_path_contains` | string | Shorthand: response text must contain this string, labeled as a partial path check |
| `expect_empty` | `true` | Result count must be 0 |
| `expect_count_eq` | integer | Result count must equal N |
| `expect_count_gte` | integer | Result count must be ≥ N |
| `expect_count_lte` | integer | Result count must be ≤ N |

`expect_path` and `expect_path_contains` are purely label-cosmetic aliases for `expect_contains` — they both do a plain substring match against the full response text and don't do any path parsing. The only difference is the label shown in the report: `"path 'x' in results"` vs `"path containing 'x' in results"`.

**How result counting works.** The `expect_count_*` and `expect_empty` checks count `Title:` lines in the response text. FlashQuery document results each include a `Title:` line; memory results do not. This means count checks reliably count documents, but will always count 0 memories regardless of how many are returned. Use `expect_contains` / `expect_not_contains` to assert on memory content.

**Common assert `op:` values:**

| `op:` | Useful for |
|---|---|
| `search_all` | Cross-domain search; works without embeddings via title/path fallback |
| `search_documents` | Document-only semantic search; requires embeddings for content queries |
| `list_memories` | Tag-based memory retrieval; does not require embeddings |
| `get_document` | Retrieve a specific document by `fqc_id` |
| `list_documents` | List documents matching optional filters |

Any MCP tool can be used as `op:`. Refer to the FlashQuery MCP tool documentation for the full list and their argument schemas.

---

### Variable binding

Any action step with a `name:` key stores its response fields in a variable registry. Later steps (both actions and asserts) can reference those fields with `${name.field}` syntax.

```yaml
- action: vault.write
  name: sunset_doc              # binds response fields under the name "sunset_doc"
  path: "journal/sunsets.md"
  title: "Watching the Sunset"
  content: "The crimson horizon."
  tags: [arc-tag]

- action: archive_document
  args:
    identifiers: "${sunset_doc.fqc_id}"    # resolved at runtime

- assert:
    op: get_document
    args:
      identifier: "${sunset_doc.fqc_id}"
    expect_contains: "archived"
```

**Variable names must be unique within a test.** If two steps share the same `name:`, the second will overwrite the first.

**Available fields by action:**

| Action | Bound fields |
|---|---|
| `vault.write` | `fqc_id`, `path`, `title`, `status` |
| `memory.write` | `memory_id`, `content` |

The `path` field for `vault.write` reflects the auto-prefixed path (e.g. `_integration/journal/sunsets.md`), not the path as written in the YAML.

Only `vault.write` and `memory.write` support variable binding. Other actions do not extract fields and `name:` on them has no effect.

**Substitution is recursive.** References are resolved inside strings, dict values, and list items. A reference to an undefined name or a field that wasn't returned causes an immediate step failure with a descriptive error message.

---

### Deps

The `deps:` key declares runtime capabilities the test requires. If any dep is unavailable, the test is recorded as `SKIP` (exit code 0) rather than `FAIL`.

```yaml
deps: [embeddings]
```

Currently recognized deps:

| Dep | What it checks |
|---|---|
| `embeddings` | Whether the connected FlashQuery server has an embedding provider configured. Probed with a read-only `search_all` call before the test runs. |
| `git` | Declared but not yet probed; reserved for future git-behavior tests. |
| `locking` | Declared but not yet probed; reserved for future locking-behavior tests. |

For external server mode, the runner probes before executing any dep-declaring test. For `--managed` mode, dep checking happens at server startup — if `embeddings` is declared and no API key is configured, the managed server raises an error that the runner converts to a skip.

---

### Complete annotated example

The following test exercises all the major constructs: two named actions, variable binding, a dependency, multiple assert styles, and coverage IDs.

```yaml
name: archive_removes_from_search
description: >
  Archiving a document removes it from search results while a co-created
  memory remains accessible. Confirms archive is scoped to documents only.
coverage: [IA-01, IA-02, IA-03, IX-02]

steps:
  # --- Setup ---

  - label: "Write a document about sunsets"
    action: vault.write
    name: sunset_doc                         # binds fqc_id, path, title, status
    path: "journal/sunsets.md"               # stored as _integration/journal/sunsets.md
    title: "Watching the Sunset"
    content: "The crimson horizon fades as the sun dips below the treeline."
    tags: [nature, sunset, arc-tag]

  - label: "Write a memory about sunsets"
    action: memory.write
    name: sunset_mem                         # binds memory_id, content
    content: "Sunsets over the bay are best viewed from the east dock."
    tags: [arc-tag]

  # --- Verify initial state ---

  - label: "Document is findable before archive"
    assert:
      op: search_all
      args:
        query: "Watching the Sunset"
      expect_path: "journal/sunsets.md"      # _integration/ prefix is fine to omit here

  - label: "Memory is accessible before archive"
    assert:
      op: list_memories
      args:
        tags: [arc-tag]
      expect_contains: "east dock"

  # --- Archive ---

  - label: "Archive the document"
    action: archive_document
    args:
      identifiers: "${sunset_doc.fqc_id}"    # variable reference resolved at runtime

  # --- Verify post-archive state ---

  - label: "Document no longer appears in search"
    assert:
      op: search_all
      args:
        query: "Watching the Sunset"
      expect_not_contains: "Watching the Sunset"

  - label: "Memory still accessible after document archive"
    assert:
      op: list_memories
      args:
        tags: [arc-tag]
      expect_contains: "east dock"           # memory is unaffected by document archive
```

---

## Coverage Matrix

[`INTEGRATION_COVERAGE.md`](./INTEGRATION_COVERAGE.md) tracks named behaviors across four categories:

| Prefix | Category |
|---|---|
| `IS-` | Search Coherence — write then find, entity-type filtering, cross-domain visibility |
| `IA-` | Archive / State Transitions — archive removes from search, memory survives archive |
| `IX-` | Cross-Domain — behaviors that span documents and memories together |
| `IC-` | Content Operations — update, scan, path handling, tag behavior |

After each run, `run_integration.py` updates the `Covered By`, `Date Updated`, and `Last Passing` columns for every ID listed in the passing tests' `coverage:` arrays. Failed tests update `Covered By` and `Date Updated` only — `Last Passing` is left intact so you can see when the behavior last worked. SKIP entries leave all columns unchanged.

---

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | All tests passed (or skipped), cleanup was clean |
| `2` | One or more tests failed |
| `3` | Tests passed but cleanup had errors |

Skipped tests (unmet deps) count as `0` — they are not failures.

---

## Reports

Every run writes a timestamped markdown report to `reports/`. The report includes:

- Run date, server mode, test order (seed if shuffled), duration, pass/fail/skip summary
- Per-test sections with the YAML description, coverage IDs, and file path
- A step summary table showing pass/fail status and timing for each step
- Per-step detail blocks: MCP tool name, full JSON arguments, raw response text, server URL on failure, each expectation with pass/fail outcome
- For failed tests: full server log capture from the managed FlashQuery process (startup through last request)

Reports are gitignored — they stay local. The `reports/` directory itself is tracked via `.gitkeep`.

---

## Debugging a Failure

1. **Read the stderr output** — the step number and failure reason are printed inline as the test runs.
2. **Open the latest report under `reports/`** — per-step detail blocks contain the exact JSON arguments sent, the full response text, and which expectations failed. For `--managed` runs, server logs are appended at the end of any failing test section.
3. **Check whether the failure is a dep boundary.** Body-content searches require embeddings; without them, only title and path matching works. An `expect_contains` on body text against `search_all` or `search_documents` will silently return no content rather than an error.
4. **Check count assertions against the right domain.** `expect_count_*` counts `Title:` lines — documents only. Use `expect_contains` / `expect_not_contains` to assert on memory results.

---

## Writing a New Test

Create a `.yml` file under `tests/`. A minimal passing test:

```yaml
name: my_new_test
description: "What this test verifies."
coverage: [IC-01]

steps:
  - label: "Write a document"
    action: vault.write
    name: test_doc
    path: "mytest/example.md"
    title: "Example Document"
    content: "Some content."
    tags: [mytest-tag]

  - label: "Document is findable"
    assert:
      op: search_all
      args:
        query: "Example Document"
      expect_path: "mytest/example.md"
```

**Conventions to follow:**

**Use a unique tag on every resource** (e.g. `mytest-tag`). Cleanup tracks resources by the IDs returned in action responses. Tags don't affect cleanup directly, but they prevent one test's memories from appearing in another test's `list_memories` call if tests happen to share a tag string.

**Use exact title queries, not body content queries, when embeddings aren't a declared dep.** Without embeddings, `search_all` and `search_documents` fall back to title and path matching — body content won't be indexed and won't appear in results.

**Action failures abort; assert failures don't.** Design your steps so that setup actions come first. If a `vault.write` step fails, the test stops immediately and the report shows what happened up to that point.

**Add the test's coverage IDs to `INTEGRATION_COVERAGE.md` before running.** The runner updates rows that exist; it doesn't create new ones.

**Before adding a test, check whether a coverage ID already exists for the behavior.** If `INTEGRATION_COVERAGE.md` already has a row for what you're testing, add your test's name to that row's `Covered By` column rather than creating a duplicate. The runner will keep it up to date from there.

---

## Quick Reference

### Action shortcuts

| `action:` | Tool | Variable fields |
|---|---|---|
| `vault.write` | `create_document` | `fqc_id`, `path`, `title`, `status` |
| `memory.write` | `save_memory` | `memory_id`, `content` |
| `archive_document` | `archive_document` | — |
| `update_document` | `update_document` | — |
| `scan_vault` | `force_file_scan` | — |
| *(any MCP tool name)* | called directly | — |

### Assertion keys

| Key | Checks |
|---|---|
| `expect_contains: "str"` | response text contains `"str"` |
| `expect_not_contains: "str"` | response text does not contain `"str"` |
| `expect_path: "str"` | response text contains `"str"` (labeled as path check) |
| `expect_path_contains: "str"` | response text contains `"str"` (labeled as partial path check) |
| `expect_empty: true` | document count == 0 |
| `expect_count_eq: N` | document count == N |
| `expect_count_gte: N` | document count >= N |
| `expect_count_lte: N` | document count <= N |

### Variable substitution

```
${step_name.field}      resolved from the variable registry at runtime
```

Works inside strings, dict values, and list items. Available in both action args and assert args.

### Reserved step keys (never forwarded as tool args)

`action` · `label` · `name` · `args`
