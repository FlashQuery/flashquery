---
name: flashquery-integration-run
description: >
  Run FlashQuery YAML integration tests (one, several, or the full suite), triage
  every failure, and hand each one off to the right place. Use this skill whenever the
  user wants to execute integration tests, investigate failing integration tests, triage
  results, or "run and debug" integration tests. Trigger on phrases like "run the integration
  suite", "run the integration tests", "why is this integration test failing", "triage the
  integration failures", "work through the integration failures", "debug the integration suite",
  "run run_integration.py", or any request that combines running integration tests with
  understanding what's broken. Even casual mentions like "let's run the integration tests and
  see" or "check if the integration suite still passes" should trigger this skill. This is the
  sister skill to flashquery-integration-testgen (which writes tests) and
  flashquery-integration-covgen (which defines what to test).
---

# FlashQuery Integration Run

This skill executes FlashQuery YAML integration tests and triages the results. It is the
runner-and-coordinator alongside two authoring skills:

- **`flashquery-integration-covgen`** decides *what behaviors to test* — maintains `INTEGRATION_COVERAGE.md`
- **`flashquery-integration-testgen`** writes *YAML tests that exercise those behaviors*
- **`flashquery-integration-run`** (this skill) *runs the tests, categorizes failures, and routes work*

## Companion references

- `tests/scenarios/integration/README.md` — complete format reference and debugging guide
- `tests/scenarios/integration/INTEGRATION_COVERAGE.md` — the coverage matrix
- `.claude/skills/flashquery-integration-testgen/SKILL.md` — where test bugs get fixed
- `.claude/skills/flashquery-integration-covgen/SKILL.md` — where spec ambiguities get resolved

## Default configuration

```bash
python3 tests/scenarios/integration/run_integration.py --managed
```

`--managed` starts a fresh FlashQuery subprocess per test with captured logs. Use it by default.

**Override when the situation demands:**

| Flag | When to use |
|------|-------------|
| `--stop-on-fail` | Fast feedback — stop after first failure |
| `--seed N` | Investigate order-dependent flakiness reproducibly |
| `--enable-git` | Suite includes tests with `deps: [git]` |
| `--enable-locking` | Suite includes tests with `deps: [locking]` |
| `--url`/`--secret` | Against an already-running external server |
| `--port-range MIN MAX` | When default ports 9100–9199 conflict |
| `--json` | Machine-readable output for scripting |

Note: there is no `--strict-cleanup` or `--per-test-server` in the integration runner. Cleanup
(wiping all `fqc_*` tables) is built-in and automatic — it runs before and after every test
unconditionally. Each managed run already uses a fresh server per test.

Also note: there is no `--require-embedding`. Embedding capability is declared per-test in
the YAML (`deps: [embeddings]`). Tests with unmet deps are automatically skipped (exit code 0),
not failed — so you don't need to configure the runner for embedding tests; the YAML handles it.

## Workflow

### Phase 1 — Scope the run

Confirm what the user wants: all tests, a pattern, or a specific file.

Patterns are substring matches on filename by default (`archive` matches all files containing
"archive"). Explicit globs work too (`"*search*"`). The `test_` prefix is not used — filenames
are like `write_then_search.yml`.

A short "I'm about to run these tests with these flags — proceed?" is enough, unless the
user's phrasing is unambiguous.

### Phase 2 — Capture environment

Before executing, note:
- Python version (`python3 --version`)
- Node.js version (`node --version`) — needed for `--managed` builds
- FlashQuery version (from `package.json`)
- OS (`uname -a` or `platform`)

Include this in any failure analysis. The integration suite runs on Linux and macOS; the
same test can pass on one and fail on another.

### Phase 3 — Execute

From the flashquery-core project root:

```bash
python3 tests/scenarios/integration/run_integration.py --managed [patterns...]
```

Wait for the run to finish and the report in `tests/scenarios/integration/reports/` to appear.

If the runner itself fails to start (can't build, Supabase unreachable, missing config),
that's an environment problem — surface it and pause rather than trying to salvage it.

### Phase 4 — Collect signals

Once complete:
- Per-test status: PASS / FAIL / SKIP
- The timestamped report at `tests/scenarios/integration/reports/integration-report-<timestamp>.md`
- For each failure: the step label, tool call, expected vs actual response

SKIP is expected for any test with an unmet `deps:` declaration — it's not a failure.

### Phase 5 — Categorize failures

Every failure gets one of these categories:

**YAML/test bug.** The test is wrong.
- Wrong assertion string (doesn't match FlashQuery's actual response format)
- Missing `scan_vault` before an assert on a newly written document
- Using `expect_count_eq` on a memory result (always 0 — use `expect_contains`)
- Asserting on body content without `deps: [embeddings]`
- Variable reference to a field that doesn't exist for that action type
- Reserved key used as an inline tool argument

**Environment issue.** The test is correct but the environment can't support it.
- `deps: [embeddings]` test ran without embedding API key — should be SKIP, not FAIL
- Node build missing (`dist/index.js` not present)
- DB unreachable (Supabase down, credentials expired, wrong URL)
- OS-specific behavior (path handling, timing)

**FlashQuery defect.** The test is correctly written, the environment is fine, and FlashQuery is doing
something different from what it should.
- Tool returns wrong status or missing fields
- A documented behavior doesn't hold (archived doc still appears in search)
- Response text format changed in a way that breaks valid assertions

**Spec ambiguity.** The test and FlashQuery disagree but neither is clearly wrong — the behavior
hasn't been pinned down.

**Flaky.** Passes sometimes. Symptoms: timing (indexer lag), ordering (tests interact).
Re-run the specific test 3 times to confirm. If consistently flaky, reclassify.

### Phase 6 — Present and confirm

For each failure, show:
- Test name, failing step label, and the assertion that failed
- Proposed category with a one-line reason
- The relevant excerpt from the report (tool call + expected + actual)
- Any open spec questions

Wait for the user to confirm before taking any action.

### Phase 7 — Plan and execute per-failure actions

| Category | Action |
|----------|--------|
| YAML/test bug | Hand off to `flashquery-integration-testgen` with the failing step, the report excerpt, and the proposed fix direction |
| Environment (test-fixable) | Hand off to testgen (e.g., "add `scan_vault` before this assert", "add `deps: [embeddings]`") |
| Environment (user-fixable) | Tell the user exactly what to configure. Pause until done. |
| FlashQuery defect | Mark in `INTEGRATION_COVERAGE.md` with `FAIL (YYYY-MM-DD)` and `*`-suffix on test name. Discuss next steps. |
| Spec ambiguity | Hand off to `flashquery-integration-covgen` to clarify. |
| Flaky | Rerun 3–5 times to confirm, then reclassify as test bug or FlashQuery defect. |

Get approval before each handoff. Batch when multiple failures share a root cause.

### Phase 8 — Re-run to verify

After fixes are applied:

```bash
python3 tests/scenarios/integration/run_integration.py --managed <pattern>
```

If still failing, return to Phase 5 with fresh eyes. Don't loop without going through the
user checkpoint again.

### Phase 9 — Close out

**On a clean run (all PASS or SKIP):** the runner has already updated `INTEGRATION_COVERAGE.md`
automatically with today's date and passing test names. Verify the matrix reflects the run,
then offer a commit.

**On failures:** summarize which were fixed, which need GSD attention, which remain open.
List any rows you've marked `FAIL` in the matrix.

Offer a `git commit` for any changed files. Use `chore(integration):` style for matrix-only
updates.

## Common failure patterns

**"No results" on a `search_all` assert right after `vault.write`.** The indexer hasn't
caught up. Fix: add a `scan_vault` action step between the write and the assert.

**`expect_count_eq: 1` fails with count 0 on a memory result.** Count assertions count
`Title:` lines — memories don't produce `Title:` lines. Fix: switch to `expect_contains`.

**Body content not found in `search_all`.** Body-content search requires embeddings. If the
test doesn't declare `deps: [embeddings]`, the assert will fail. Either add the dep (causing
skips on servers without embedding config) or switch to a title-only query.

**"Cannot resolve variable ${name.field}".** The named step either didn't have `name:` set,
or the field (`fqc_id`, `path`, etc.) wasn't returned because the action failed before that.
Check the step preceding the variable reference.

**Test SKIP when it should run.** The server doesn't have the capability declared in `deps:`.
For `embeddings`, this means no `EMBEDDING_API_KEY` or equivalent in `.env.test`. Confirm
with the user whether the environment should have it.

## Principles

**Never fix code directly.** This skill coordinates. Fixes go to testgen (YAML), covgen
(spec), GSD or user (FlashQuery code). The only `INTEGRATION_COVERAGE.md` writes this skill owns
are: marking `FAIL` on defects, and verifying post-run auto-updates are correct.

**Categorization is a user gate.** No handoff without confirmed category.

**SKIP is not failure.** Tests with unmet `deps:` skip cleanly — that's by design.

**Capture report context at triage time.** The managed server's logs are in the report and
they're ephemeral. Quote the relevant bits in your analysis before they're gone.
