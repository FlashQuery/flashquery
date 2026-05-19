---
name: flashquery-macro-testgen
description: Generate, refresh, and validate macro-framework test YAMLs against `tests/macro-framework/coverage/manifest.ts`. Use this skill when the user wants to generate a macro framework test, generate a macro framework pilot, add coverage for an MTF-* cell (e.g. MTF-C-008, MTF-D-008, MTF-L-008), fill a macro framework density gap, create an AI-generated macro pilot, exercise a low-density cell, refresh embedded golden snapshots after a golden_version bump, run a fresh-cadence exploratory batch, or asks to "make a macro test for X", "cover MTF-X", "regenerate this pilot's snapshot", "refresh the macro tests for the new golden", "fresh-run macro coverage", "rerun the testgen for the latest golden", or anything involving the `flashquery-macro-testgen` command. Sister skill to `flashquery-macro-covgen` and (when it lands) `flashquery-macro-run`; this one is exclusively for the `tests/macro-framework/` layer and the `macro-golden-model` snapshot source.
---

# FlashQuery Macro TestGen (`flashquery-macro-testgen`)

This skill generates new macro-framework test YAMLs by running synthesized macros through the `macro-golden-model` and embedding the resulting snapshots, per Macro Testing Framework Requirements §5.5 (AI Test Generation) and §9.5 (Generator integration approach). It is the macro-framework counterpart to `flashquery-directed-testgen` and `flashquery-integration-testgen`. The actual work is done by the TypeScript helper at `tests/macro-framework/golden-bridge/testgen-helper.ts` and the CLI at `tests/macro-framework/golden-bridge/testgen-cli.ts`; this skill is the instructions for invoking them correctly across the three supported modes.

## When to use

- The user names an MTF-* cell or describes an uncovered behavior and asks for a test (committed mode).
- The user asks for a fresh exploratory batch targeting the lowest-density cells (fresh mode).
- The golden version bumped and the user asks to refresh embedded snapshots in existing tests (refresh mode).
- The user asks to validate or repair a test that's failing after a golden change.

## What this skill does NOT do

- It does **not** update `coverage.json`. After generating new tests run `flashquery-macro-covgen` to refresh the coverage matrix.
- It does **not** add cells to `manifest.ts`. Cells are added manually per §6.4 lifecycle. If the user wants coverage for a behavior that has no cell yet, edit `tests/macro-framework/coverage/manifest.ts` first.
- It does **not** run the full macro framework suite. That's `flashquery-macro-run` (Phase 6). The skill validates the *single* test it just generated; it does not re-run the whole 20+ pilot corpus.
- It does **not** modify the golden model. Bumping the golden version is a separate workflow (Phase 1 + golden meta-tests). This skill only consumes the current golden as a snapshot source.

## Inputs

- One or more target cell IDs (committed mode), OR
- A count of tests to generate from the lowest-density cells (fresh mode), OR
- A filter pattern over existing tests whose `golden_version` is older than the current golden (refresh mode).

The skill reads `tests/macro-framework/coverage/manifest.ts`, `coverage/coverage.json`, the existing pilots under `cases/`, and the Macro Language Requirements REQ-NNN definitions to ground each generated test in spec text.

## Three modes

### Committed mode — `--mode=committed`

Generate one test per named cell. Output lands in `tests/macro-framework/cases/<category>/<NN-slug>.yml` and is checked into git.

```bash
npm run testgen:macro-framework -- --mode=committed --target=MTF-C-008
npm run testgen:macro-framework -- --mode=committed --target=MTF-G-006 --target=MTF-S-007
```

Use this when the user names a specific cell, describes a specific behavior, or asks to fill a known gap. Per §9.5 every committed test must carry `generator:` provenance (skill, version, model, timestamp, targeted cells, grounding refs) plus real `golden_snapshot:` data captured at testgen time — both are emitted automatically by the helper.

### Fresh mode — `--mode=fresh --count=N`

Pick the N lowest-density actionable cells from `coverage.json` and generate tests for the subset the synthesis layer can handle. Output lands in `tests/macro-framework/cases-fresh/` (gitignored per §9.1) and is run-then-discarded.

```bash
npm run testgen:macro-framework -- --mode=fresh --count=5
npm run testgen:macro-framework -- --mode=fresh --count=10 --categories=MTF-G,MTF-S
```

Use this when the user asks for "exploratory" or "broad" coverage, when CI is configured to surface fresh-cadence failures for promotion into the committed set (per §5.5's "fresh-each-run" cadence).

### Refresh mode — `--mode=refresh [--filter=<regex>] [--auto-accept-identical]`

Walk every YAML test whose `golden_version` field is older than the current golden (read from `tests/macro-framework/macro-golden-model/package.json` via `GOLDEN_VERSION`). For each, re-run the macro through the current golden and compare the new snapshot to the embedded one.

```bash
npm run testgen:macro-framework -- --mode=refresh --auto-accept-identical
npm run testgen:macro-framework -- --mode=refresh --filter='mtf-c-' --auto-accept-identical
```

Without `--auto-accept-identical` the helper reports the diff and leaves the file untouched (operator-review path). With `--auto-accept-identical` it bumps `golden_version` + `golden_run_at` for tests whose snapshot is exactly identical or structurally identical (same length, same per-step `kind`); divergent snapshots are still reported and skipped.

Use this when the user mentions a golden version bump, "refresh the snapshots", "after the golden change", or similar.

## Workflow (§5.5 9-step mapping)

The skill's workflow mirrors the §5.5 steps. Within each invocation:

### Step 1 — Read the cell metadata + REQ acceptance criteria
The helper's `loadCellMetadata(cellId)` reads `manifest.ts`, follows `source_citations` (REQ-NNN refs), and extracts crude excerpts from the Macro Language Requirements doc. The cited-source text appears in the generated test's `generator.grounding_refs` for traceability.

### Step 2 — Read 2–3 hand-authored exemplar tests
`loadExemplars(category, n)` returns up to N existing pilots in the same MTF-* category. Use them as shape/idiom references — variable naming, comment style, expect block conventions, etc.

### Step 3 — Synthesize the test inputs
The CLI consults a built-in scenario library (`SCENARIOS` in `testgen-helper.ts`) keyed by cell ID. When invoking via an AI agent (rather than the autonomous CLI), supply a `SynthesizedTest` value directly via `synthesizeTestInputs(cell, exemplars, reqs, synth)`. The synthesis must include: macro source, input_vars, vault seed state, tool surface configuration (matching the framework's archetype library per §5.7), and an `expect_overrides` block declaring the author-intended pass condition.

When working in agent mode, anchor the synthesis on:
- **What the REQ says.** The REQ-NNN excerpts from `loadCellMetadata` describe the language behavior the cell exercises.
- **What the cell description says.** It's the human-readable mission statement.
- **What the exemplars look like.** Match comment density and YAML structure.
- **Production-engine constraints.** The production engine (as of golden v0.3.0) doesn't have:
  - Boolean literals (`true`/`false`) — use integer 1/0 as truthy sentinels.
  - `continue` / `break` — Tier 2 only.
  - `_self.*` direct binding — substitute with `input_var` workaround.
  - `--flag=value` syntax — use `--flag value` instead.
- **Range exclusivity.** `1..5` iterates [1, 2, 3, 4] — end-exclusive per `buildRange()` in `src/macro/builtins.ts`.

### Step 4 — Run the synthesized macro through the current golden
`captureAndEmbed(synth)` calls `captureSnapshot()` from `golden-bridge/load.ts`. The capture's return envelope, trace, side-effect manifest, progress events, and `state_notes` are all returned.

### Step 5 — Embed those outputs into `expect:` and `golden_snapshot:`
The helper merges author-declared `expect_overrides` over the captured baseline. The `golden_snapshot.state_notes` is taken verbatim from the capture.

### Step 6 — Stamp `golden_version` + `golden_run_at`
`GOLDEN_VERSION` is read from `tests/macro-framework/macro-golden-model/src/version.ts`. The `golden_run_at` field is the ISO timestamp at capture time.

### Step 7 — Add `generator:` provenance + `covers:`
The generator block carries the skill name, version (currently `1`), model identifier, timestamp, targeted cell list, and grounding refs (REQ-NNN strings the synthesis used). The `covers:` array enumerates all MTF-* cells the test contributes to, including incidental ones.

### Step 8 — Validate the emitted YAML
`validateGeneratedTest(path)` re-loads the YAML through the runner, drives the production engine, and runs the comparator. Any divergence at this stage indicates a generator misread (per §5.8) and should be reported to the operator with the comparator findings.

### Step 9 — Write to `cases/<category>/` (committed) or `cases-fresh/` (fresh)
`writeGeneratedTest(synth, yaml_text, opts)` handles destination paths. Committed-mode files land under `cases/<MTF-category>/<NN-descriptive-slug>.yml`; fresh-mode files land under `cases-fresh/<slug>.yml`.

## After generating

After successful generation:

1. **Run the full suite** to confirm nothing regressed:
   ```bash
   npm run test:macro-framework
   ```
2. **Regenerate coverage** to update `MTF_COVERAGE.md` and `coverage.json`:
   ```bash
   npm run coverage:macro-framework
   ```
   (Or hand off to the `flashquery-macro-covgen` skill explicitly.)
3. **Offer a git commit** bundling the new test file(s) + the regenerated coverage docs. Use a message like `test(macro-framework): generate pilot covering MTF-X-NNN`.

## Adding new scenarios to the library

The CLI's built-in `SCENARIOS` library in `testgen-helper.ts` covers a starter set of cells (line comments, field access, if/else, scripted-tool dispatch, progress emission, macro_aborted envelope, per-invocation isolation). When the user asks for coverage of a cell not in this library:

1. **AI-agent mode (preferred):** synthesize the test inputs in the conversation, build a `SynthesizedTest` value matching the interface in `testgen-helper.ts`, and pass it through `captureAndEmbed()` + `writeGeneratedTest()` directly. No library edit needed.
2. **Library extension (when the cell will be re-targeted often):** add a new `SCENARIOS[cellId]` factory in `testgen-helper.ts`. Keep the factory pure — it returns a `SynthesizedTest` without side effects. After extending the library, the autonomous CLI can pick the cell up via `--target=`.

## Verification gate

A successful committed-mode invocation satisfies:

- The generated YAML exists at the declared `output_path`.
- `npm run test:macro-framework` passes including the new test.
- The new test's `generator.targeted_cells` enumerates the cells the user asked for, plus any incidental cells.
- The new test's `generator.grounding_refs` cites REQ-NNN strings the synthesis was grounded in.
- The new test's `golden_version` matches the current `GOLDEN_VERSION` and `golden_run_at` is recent.
- The new test's `golden_snapshot.state_notes` is non-empty.

A successful refresh-mode invocation satisfies:

- All stale-version tests with structurally-identical captures have their `golden_version` bumped to the current.
- Tests with diverged captures are reported (not silently rewritten) so the operator can review.

## Related skills

- **flashquery-macro-covgen** — regenerate `MTF_COVERAGE.md` / `MTF_INTERACTIONS.md` after this skill produces new tests.
- **flashquery-macro-run** (Phase 6, future) — execute the macro framework suite, classify failures, write triage records.
- **flashquery-directed-testgen** / **flashquery-integration-testgen** — sister testgen skills for the other test layers. Same shape (covgen + testgen + run triad); this one is specific to the macro framework.

## Principles

**The golden is the oracle.** Every embedded `expect:` block is derived from running the macro through the golden — never hand-crafted, never inferred. If you can't capture a snapshot, you can't generate a test.

**Provenance is metadata, not philosophy** (§5.5). Hand-authored, AI-generated, refreshed — all reviewable in PRs, all run the same way at test time. The `generator:` block exists so failure triage (per §5.8) can distinguish "the generator misread the spec" from "the engine regressed."

**Drift is explicit** (§5.6). Every test records `golden_version`. The refresh workflow makes drift a first-class operation — operator-gated by default; auto-bumped only for structurally-identical refreshes.

**Production constraints are real.** The synthesis MUST produce a macro the production engine can actually execute. If the language doesn't support a construct (bool literals, `continue`/`break`, `_self`), the test substitutes a production-compatible alternative or targets a different cell.
