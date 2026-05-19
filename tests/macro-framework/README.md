# Macro Testing Framework

The sixth Vitest tier — peer of `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/scenarios/{directed,integration}/`, `tests/benchmark/` — built to exhaustively validate the FlashQuery macro engine's behaviour space. YAML-authored permutation tests drive the production engine in-process, comparing structured outputs to expectations captured at testgen time from a separate "golden" implementation.

The authoritative spec is `flashquery-product/Roadmap/Features/Macro Testing Framework/Macro Testing Framework Requirements.md`. Section references throughout this README point there.

## 1. Overview

**What it tests.** Macro grammar, evaluator semantics, control flow, tool dispatch, lifecycle (dry-run / real-run / trace / progress / cancel), error taxonomy, and per-invocation isolation. The seven `MTF-*` coverage categories (G/S/C/D/L/E/I) map one-to-one to language subsystems, plus a framework-self-test category `MTF-FW`. See §5.3.

**Where it sits.** Per §3.5 this layer complements (does not replace) the other test tiers:

| Tier | Purpose |
|---|---|
| `tests/unit/` | Pure functions, no IO |
| `tests/integration/` | Real Supabase + real handlers, broader product surface |
| `tests/e2e/` | Full MCP wire transport |
| `tests/scenarios/directed/` | Realistic single-user flows (Python) |
| `tests/scenarios/integration/` | Realistic multi-system flows (Python) |
| `tests/benchmark/` | Latency / throughput |
| **`tests/macro-framework/`** | **Exhaustive engine-behaviour permutations (this layer).** |

**Who uses it.** Engine maintainers (regression coverage), the `flashquery-macro-testgen` skill (generates new pilots), and CI (regresses on engine drift).

## 2. Architecture summary

- **Golden-as-snapshot** (§5.6) — A separate TypeScript implementation lives in `macro-golden-model/` and serves as the executable oracle. Each test embeds a snapshot of the golden's output captured at authoring time; the runner never invokes the golden. INV-MTF-04: golden is read-only at runtime.
- **Structured-comparison invariant** (INV-MTF-07) — The runner compares structured fields only: return envelopes, trace entries (kind sequence), side-effect manifests, error envelopes, progress milestones. Never raw stdout/stderr.
- **Fake-broker + real-Supabase stack** (INV-MTF-06 / §9.7) — Native FQ handlers run real against a real Supabase test instance. Brokered tools are fakes drawn from an archetype library (`fixtures/fake-broker/archetypes.ts`, per §5.7). Per-test latency target ≤50ms median.
- **Author-declared pass mode** (§5.4) — Each test declares `expect.comparison` as `match_all` (default), `match_some`, or `match_none`. The runner's comparator is dumb-simple; only the verdict changes by mode.

## 3. Running tests

```sh
# Full suite (20 pilots today)
npm run test:macro-framework

# Verbose per-case output
npm run test:macro-framework -- --reporter=verbose

# Filter to a single test by id substring
npm run test:macro-framework -- --testNamePattern=mtf-c-04

# Filter to a category (test names are namespaced `macro-framework/<category>`)
npm run test:macro-framework -- --testNamePattern='macro-framework/grammar'
```

The Vitest config is at `tests/config/vitest.macro-framework.config.ts` — single fork, `maxWorkers: 1` to avoid Supabase singleton races (per §9.7).

The `cases.test.ts` entrypoint imports `runner.ts`, calls `loadCases()` at module-load time, then groups tests by category and registers a `describe(macro-framework/<category>)` per group with one `it(<test-id>)` per pilot. Vitest sees the concrete test ids — that's what makes `--testNamePattern` work.

## 4. Test case file layout (the YAML schema)

Tests live at `cases/<MTF-category>/NN-<descriptive-slug>.yml`. Categories: `grammar/`, `semantics/`, `control-flow/`, `dispatch/`, `lifecycle/`, `errors/`, `isolation/`. The directory grouping is for human navigation; the runner discovers all `*.yml` files recursively (file names starting with `_` are also discovered).

Canonical schema is documented in §5.4 of the requirements doc. Header fields:

```yaml
id: mtf-c-04-while-with-fail            # unique test id
name: While loop with mid-loop fail     # short human-readable name
description: |                          # multi-line context
  ...
covers: [MTF-C-005, MTF-C-006]          # MTF-* cells this test contributes to (§9.4)
generator:                              # provenance — only on AI-generated tests
  skill: flashquery-macro-testgen
  model: <model-id>
  generated_at: <ISO timestamp>
  targeted_cells: [...]
  grounding_refs: [...]
golden_version: "0.3.0"                 # macro-golden-model package version
golden_run_at: 2026-05-19T01:00:00Z     # when the snapshot was captured
```

Inputs:

```yaml
macro: |                                # the macro source under test
  total = 0
  for i in 1..4 do
    total = add $total $i
  done
  exit { sum: $total }
input_vars: {}                          # bound at runtime
vault: {}                               # seed vault state (built per-test in tmpdir)
tools:                                  # tool surface — fq: real | fake, plus brokered archetypes
  fq: real
  brave_search:
    archetype: ScriptedTool
    tool_name: web_search
    responses: [...]
```

Expectations (compared at runtime per INV-MTF-07):

```yaml
expect:
  comparison: match_all                 # match_all (default) | match_some | match_none
  outcome: success                      # success | fail | needs_user_input
  return_result: {sum: 10}
  error: {code: ..., message_contains: ...}
  side_effects:
    vault_writes: [...]
    tool_calls: [...]
    git_commits: 2
  trace_kinds_in_order: [...]
  progress_milestones: [...]
```

Snapshot + optional state-notes assertions:

```yaml
golden_snapshot:                        # debug context only; not live-compared
  state_notes: [...]                    # see §5.6.1
expect_state_notes:                     # author-curated load-time integrity check
  - {kind: loop, iter: 2, ...}
```

The fastest way to learn the schema is to read an existing pilot — for example `cases/control-flow/04-while-with-fail.yml` exercises a brokered fail-fast and demonstrates a typical `tools:` block, an `expect:` block, and an embedded `golden_snapshot.state_notes` table.

## 5. Where results and artifacts live

| Artifact | Path | Notes |
|---|---|---|
| Test pass/fail | stdout (Vitest) | Standard reporter; use `--reporter=verbose` for per-case lines |
| Failure-triage records | `failures/<YYYY-MM-DD>-<HHMMSS>-<test-id>.md` | Per §9.6. YAML frontmatter (`status`, `classification`, `confidence`, `covers`, `test_file`, `golden_version_used`, ...) + structured body (rationale, expected vs. actual, golden state-notes table, suggested remediation, action log). Committed to git |
| Coverage state (machine) | `coverage/coverage.json` | Authoritative per §9.4. Histogram counts, last-verified timestamps, density observations |
| Coverage state (per-cell) | `coverage/MTF_COVERAGE.md` | Flat table rendered via `tablemark` |
| Coverage state (heatmap) | `coverage/MTF_INTERACTIONS.md` | Category × category interaction heatmap rendered via `markdown-table` |
| Coverage cell manifest | `coverage/manifest.ts` | TypeScript source of truth for the MTF-* cell list, descriptions, density targets, status |
| Stale-test report | stdout | `npm run run:macro-framework -- --stale-check` |

Failure-record lifecycle: `open` → (`resolved` | `escalated` | `invalidated`). Stale-expectations records auto-resolve when `flashquery-macro-testgen --mode=refresh` succeeds against the test.

## 6. The three operator skills + four npm scripts

Three `.claude/skills/` skills wrap the framework (mirroring the directed/integration triad):

| Skill | What it does |
|---|---|
| `flashquery-macro-covgen` | Regenerate the coverage matrix after test changes; reads YAML cases + manifest, writes `coverage.json` + the two MD renders. Use after authoring or editing tests. |
| `flashquery-macro-testgen` | Generate new pilots in one of three modes: `committed` (PR-reviewable, writes under `cases/<category>/`), `fresh` (gitignored breadth coverage in `cases-fresh/`), `refresh` (re-capture snapshots after a golden version bump). See §5.5 / §9.5. |
| `flashquery-macro-run` | Execute the suite, perform first-pass §5.8 classification on any failures (stale-expectations / engine-bug / golden-bug / generator-misread / spec-ambiguity), write triage records. Also supports `--triage <record-path>` re-classification and `--stale-check` pre-run report. |

The skills shell out to four npm scripts in `flashquery/package.json`:

| Script | Underlying command |
|---|---|
| `npm run test:macro-framework` | `vitest run --config tests/config/vitest.macro-framework.config.ts` |
| `npm run coverage:macro-framework` | `tsx tests/macro-framework/coverage/render.ts` |
| `npm run testgen:macro-framework -- --mode=...` | `tsx tests/macro-framework/golden-bridge/testgen-cli.ts` |
| `npm run run:macro-framework [-- --stale-check \| --triage <path>]` | `tsx tests/macro-framework/triage/run-cli.ts` |

## 7. Authoring a new test by hand

1. Pick a target MTF-* cell from `coverage/manifest.ts` (look for `status: actionable` with low `density_target` headroom — `coverage/MTF_COVERAGE.md` is the rendered view).
2. Create `cases/<category>/NN-<slug>.yml` per the §5.4 schema. The pilot files in `cases/` are good templates.
3. Capture the golden snapshot for embedding via `golden-bridge/capture-placeholder.ts` (single-shot helper) or use the testgen skill / `npm run testgen:macro-framework -- --mode=committed --target=<cell>` (preferred — runs full validation).
4. Declare `covers: [MTF-...]` matching the cells the test exercises.
5. Run `npm run test:macro-framework` to verify it passes.
6. Run `npm run coverage:macro-framework` to update the coverage matrix.

## 8. Authoring via the generator skill

Use `flashquery-macro-testgen` (or directly: `npm run testgen:macro-framework -- --mode=committed --target=MTF-G-006`). The skill reads cell metadata + grounding refs, synthesizes a macro, captures the golden's snapshot, embeds it, validates by re-driving the production engine, and writes the YAML. See §5.5 / §9.5.

## 9. Extending coverage for new features

When a new macro feature lands (new builtin, new fence attribute, new error code, etc.), follow §6.4: add cells to `coverage/manifest.ts` with `status: planned` if the feature isn't yet shipped or `actionable` if it is; declare `density_target`; provide `source_citations`; commit. The next `flashquery-macro-testgen` pass will pick up the new actionable cells as candidates.

## 10. The golden model

`macro-golden-model/` is a versioned, separate-`package.json` TypeScript implementation of the macro language. Per §9.2 it co-evolves with the spec — the golden adopts new behaviour first; the production engine follows. Current version is read from `macro-golden-model/src/version.ts` and surfaced as `GOLDEN_VERSION` from `golden-bridge/load.ts`.

**Operator-gated bumps** (per §11.6): patch the golden, run its own meta-tests, bump `package.json` version, then either:

- run `flashquery-macro-testgen --mode=refresh` to re-capture snapshots across affected tests, or
- let the stale-expectations classification flag tests one at a time as they hit them.

The golden is read-only at framework runtime (INV-MTF-04). Only `golden-bridge/*.ts` and the testgen pipeline import from it.

## 11. What's committed vs. gitignored

**Committed** (per §9.4 + §9.6):

- `cases/**/*.yml` — pilot tests
- `cases-ts/` — TypeScript escape-hatch tests (empty placeholder today)
- `coverage/` — manifest, render script, coverage.json, both MD renders
- `failures/*.md` — triage records (records persist forever in git history per §9.6)
- `fixtures/` — fake-broker archetypes, fake-llm, fake-clock, vault-helper, progress-capture
- `golden-bridge/` — load.ts, snapshot.ts, capture-*.ts, testgen-helper.ts, testgen-cli.ts
- `state-notes/` — schema, assert, render
- `triage/` — classify, record, run-cli, stale-check (Phase 6)
- `macro-golden-model/{src/*.ts (except _*.ts), examples/, sample-vault/, package.json, package-lock.json, tsconfig.json, README.md}`
- `runner.ts`, `cases.test.ts`, `framework-registry.ts`, `tsconfig.json`, this `README.md`, `.gitignore`

**Gitignored**:

- `cases-fresh/` — generated each CI run, never committed (per §5.5 fresh mode)
- `_*.ts`, `_*.js` — scaffolding / probe / scratch files at any depth
- `macro-golden-model/node_modules/`
- `.DS_Store`, `*.swp`, `.idea/`, `.vscode/`, `*.log`, `tmp/`, `.cache/`

**One gotcha** (resolved as of Phase 6): the repo root `.gitignore` ignores `coverage/` (intended for nyc/istanbul output). That unanchored rule matched `tests/macro-framework/coverage/` too. The framework's local `.gitignore` now negates it with `!coverage/` + `!coverage/**` so the coverage matrix is committed per §9.4.
