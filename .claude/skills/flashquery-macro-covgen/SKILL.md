---
name: flashquery-macro-covgen
description: Regenerate the macro-framework coverage matrix from the current test corpus. Use this skill whenever the user wants to refresh `MTF_COVERAGE.md`, refresh `MTF_INTERACTIONS.md`, regenerate `coverage.json`, update the macro-framework coverage report after authoring new pilots, after a snapshot-refresh pass, after a golden version bump, or periodically to keep the coverage docs in sync with the test corpus. Also trigger when the user says "regen macro coverage", "rebuild MTF coverage", "refresh the macro coverage matrix", "run coverage:macro-framework", or asks "is the macro coverage report up to date?". Sister skill to `flashquery-directed-covgen` and `flashquery-integration-covgen`; this one is exclusively for the `tests/macro-framework/` layer.
---

# FlashQuery Macro Coverage Generator (flashquery-macro-covgen)

This skill regenerates the macro testing framework's coverage matrix from the current test corpus. It is the macro-framework counterpart to `flashquery-directed-covgen` and `flashquery-integration-covgen`. The actual work is done by a TypeScript script invoked via npm; the skill is thin instructions for invoking it correctly and verifying the output.

## When to use

- After authoring new pilots in `tests/macro-framework/cases/<category>/*.yml`.
- After a `flashquery-macro-testgen` snapshot-refresh pass (re-capturing pilots after a golden version bump).
- Periodically to keep `MTF_COVERAGE.md` / `MTF_INTERACTIONS.md` in sync with the test corpus.
- After a manifest edit (adding cells, transitioning a cell's `status`).

If a previous coverage run is still current and no test files have changed, this skill is a no-op — but it's safe to re-run regardless (output is deterministic).

## What this skill does NOT do

- It does **not** run any tests. Pass/fail state is owned by `flashquery-macro-run` (Phase 6).
- It does **not** add or remove cells from `manifest.ts`. Cells are added manually as features become testable (per Macro Testing Framework Requirements §6.4 lifecycle). If you need to add a cell, edit `tests/macro-framework/coverage/manifest.ts` directly first, then run this skill.
- It does **not** update test files. If a test references a cell ID that isn't in the manifest, the rendering script prints a warning and skips the unknown cell. Fix by either adding the cell to the manifest (preferred) or correcting the test's `covers:` array.

## Inputs

None required — the skill reads the existing test corpus and manifest on disk. The user may optionally tell you:

- Which pilots were just added (so you can sanity-check that those cells now have `count >= 1`).
- Whether they want the coverage commit bundled with a test-authoring commit, or kept separate.

## Workflow

### Step 1 — Run the renderer

From the FlashQuery repo root:

```bash
npm run coverage:macro-framework
```

This invokes `tsx tests/macro-framework/coverage/render.ts`, which:

1. Loads `tests/macro-framework/coverage/manifest.ts` (the canonical MTF-* cell list).
2. Walks every YAML test under `tests/macro-framework/cases/**/*.yml` and parses each test's `covers:` array.
3. Reads the previous `tests/macro-framework/coverage/coverage.json` if it exists (used to preserve stable `last_verified` timestamps for cells whose count didn't change).
4. Writes a fresh `coverage.json` with cell histogram state + pairwise interaction counts.
5. Renders `tests/macro-framework/coverage/MTF_COVERAGE.md` (flat per-cell table, via `tablemark`).
6. Renders `tests/macro-framework/coverage/MTF_INTERACTIONS.md` (7×7 category heatmap, via `markdown-table`).

The script prints a one-line summary: `Summary: <exercised>/<total> cells exercised; <N> pairwise interactions tracked.` If it prints a `WARNING: N cell ID(s) referenced by tests but missing from manifest:` line, capture the missing IDs — you'll want to resolve them before considering the run clean.

### Step 2 — Verify the outputs

Quick visual check:

1. **`coverage.json`** opens as well-formed JSON with `schema_version: "1"`, a recent `generated_at`, and entries for every cell in the manifest.
2. **`MTF_COVERAGE.md`** has a header block with a generated-at line, a manifest-cells summary, and a sorted Markdown table. Cells the corpus exercises show a non-zero `Count` and a recent `Last Verified` date; unexercised cells show `Count: 0` and `Last Verified: —`.
3. **`MTF_INTERACTIONS.md`** has the same header style plus an 8×8 category matrix (the eight categories per §5.3 + the framework self-test `MTF-FW` row/column). Density markers `·`, `▫`, `▪`, `█` distinguish 0 / 1–2 / 3–5 / 6+ co-occurring tests.

If the test corpus contains a recently-authored pilot, confirm that its declared cells show up with non-zero counts in `MTF_COVERAGE.md`. If they don't, the pilot's `covers:` may reference cells that don't exist in the manifest — check the renderer's warning output.

### Step 3 — Handle missing-cell warnings (if any)

If the renderer warned about cell IDs referenced by tests but missing from the manifest, decide between two paths:

1. **Add the cell to the manifest.** Edit `tests/macro-framework/coverage/manifest.ts` and append a properly-shaped `Cell` entry. Use the §6.4 lifecycle to decide its `status`: `actionable` if the feature is shipped (Tier 1 default), `planned` / `blocked` if it's awaiting a gate, with a `requires` block describing the gate. Re-run `npm run coverage:macro-framework` and the warning should clear.
2. **Fix the test's `covers:` array.** If the test mistakenly references a cell that shouldn't exist, edit the test YAML to reference an existing cell. Re-run.

Don't suppress the warning by deleting the offending test or commenting out its `covers:` array — that loses information.

### Step 4 — Commit the deltas

The three files in `tests/macro-framework/coverage/` are all checked-in (per §9.4). After a clean run, stage them and commit:

```bash
git add tests/macro-framework/coverage/coverage.json \
        tests/macro-framework/coverage/MTF_COVERAGE.md \
        tests/macro-framework/coverage/MTF_INTERACTIONS.md
git commit -m "docs(macro-framework): regenerate coverage matrix"
```

If the user is bundling this with a test-authoring commit (e.g., they just added 3 pilots), they may prefer a combined commit covering both the new tests and the regenerated coverage. Offer this and ask before committing.

If the user did edit `manifest.ts` in step 3, include that in the commit too.

Do not push — leave that to the user.

## Outputs reference

| Path | Purpose | Authoritative? |
|---|---|---|
| `tests/macro-framework/coverage/manifest.ts` | Canonical MTF-* cell list (input) | Yes (hand-authored) |
| `tests/macro-framework/coverage/coverage.json` | Machine-readable histogram + interactions state | Yes (regenerated) |
| `tests/macro-framework/coverage/MTF_COVERAGE.md` | Human-readable flat per-cell table | No — view of `coverage.json` |
| `tests/macro-framework/coverage/MTF_INTERACTIONS.md` | Human-readable category interaction heatmap | No — view of `coverage.json` |

## Principles

**Manifest changes are deliberate.** The cell list is a planning artifact (per §9.4) — additions and status transitions should be visible in PRs. This skill doesn't touch the manifest; it just regenerates the views.

**Deterministic output.** The renderer is pure-functional w.r.t. the manifest + test corpus + previous JSON. Re-running it without any input changes should produce no diff except the `generated_at` timestamps. Merge conflicts on `coverage.json` are resolved by re-running the script.

**Warnings are signal.** A missing-cell warning means manifest and tests have drifted apart. Resolve it in the same PR, not later.

## Related skills

- **flashquery-macro-testgen** — generates new pilots targeting low-density cells in `coverage.json`. Hand-off comes back to this skill once the new pilots are checked in.
- **flashquery-macro-run** — executes the macro framework suite and produces failure-triage records. Doesn't update coverage state directly.
- **flashquery-directed-covgen** / **flashquery-integration-covgen** — sister coverage skills for the other test layers. Same workflow shape; this one is exclusively for `tests/macro-framework/`.
