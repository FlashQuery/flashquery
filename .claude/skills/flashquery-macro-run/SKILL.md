---
name: flashquery-macro-run
description: Run the macro-framework test suite, perform first-pass §5.8 failure-triage classification, and write/update §9.6 triage records under `tests/macro-framework/failures/`. Use this skill when the user wants to run macro tests, execute the macro framework, "run the macro suite", "run the macro pilots", check for stale golden-version drift before a run, triage an existing failure record, re-classify a failure, mark a triage record as resolved/escalated, surface the pass/fail summary of the macro framework, or asks "what broke?", "classify the failure", "is the golden current?", "are any tests stale?", "re-triage this record". Sister skill to `flashquery-macro-testgen` and `flashquery-macro-covgen`; this one is exclusively for the `tests/macro-framework/` layer and §5.8 + §9.6 + §11.6 triage authority.
---

# FlashQuery Macro Run (`flashquery-macro-run`)

This skill is the macro-framework counterpart to `flashquery-directed-run`. It runs the macro-framework vitest suite via `npm run test:macro-framework`, and — when failures appear — performs first-pass §5.8 five-way classification and writes/updates §9.6 failure-triage records under `tests/macro-framework/failures/`.

The actual work is done by:

- `tests/macro-framework/triage/classify.ts` — implements the §5.8 heuristic.
- `tests/macro-framework/triage/record.ts` — writes §9.6 Markdown + frontmatter records, supports update + related-failure lookup.
- `tests/macro-framework/triage/stale-check.ts` — pre-run §5.8 first-pass against `GOLDEN_VERSION`.
- `tests/macro-framework/triage/run-cli.ts` — thin CLI invoked via `npm run run:macro-framework`.

The classifier runs at runtime inside `cases.test.ts` (replacing the Phase 3 draft) so every test failure produces a properly-classified record automatically. This skill is the operator-facing surface — it orchestrates the run, surfaces the summary, and supports re-triage of existing records.

## When to use

- The user wants to run the macro framework suite ("run the macro tests", "check macro pilots", etc.).
- A previous run produced failure records and the user wants to walk through them or re-classify one.
- The golden version may have bumped and the user wants to flag stale tests before running.
- An operator confirms or overrides a classification on a record.

## What this skill does NOT do

- It does **not** fix the engine, the golden, or the spec. Per §11.6 those changes go through their own gates (engine PR + code review; golden version bumps operator-approved; spec-doc edits operator-controlled).
- It does **not** author new tests or refresh stale ones — that's `flashquery-macro-testgen` (Phase 5).
- It does **not** regenerate coverage docs — that's `flashquery-macro-covgen` (Phase 4).
- It does **not** modify production engine code. Per the directed-run precedent: this is the outer coordinator, not the inner executor.

## Companion references

Read these when relevant:

- `flashquery-product/Roadmap/Features/Macro Testing Framework/Macro Testing Framework Requirements.md` §5.8 (Failure-Triage Workflow), §9.6 (record format), §11.6 (authority levels).
- `tests/macro-framework/failures/README.md` — the existing failure-record library landing page.
- `tests/macro-framework/triage/classify.ts` — the heuristic implementation.
- `tests/macro-framework/triage/record.ts` — the writer / updater.
- `.claude/skills/flashquery-macro-testgen/SKILL.md` — where stale tests get refreshed.
- `.claude/skills/flashquery-macro-covgen/SKILL.md` — sister coverage skill.

## Sub-workflows

The skill handles three modes the user can dial into. Pick by listening for which one the user actually wants.

### A. Standard run

Trigger phrases: "run the macro tests", "execute the suite", "run macro framework", "let's see what passes".

Steps:

1. **Pre-run stale-version check** (cheap, always do this). Invoke:

   ```bash
   npm run run:macro-framework -- --stale-check
   ```

   If it reports stale tests, summarize them to the user and ask whether they want to refresh via `flashquery-macro-testgen --mode=refresh` first. Don't refresh from this skill — hand off to testgen. If the user says "just run them anyway," continue to step 2.

2. **Invoke the suite**:

   ```bash
   npm run run:macro-framework
   ```

   This invokes `npm run test:macro-framework` under the hood, streams vitest output, and prints a pass/fail summary. The runner itself writes any new failure records to `tests/macro-framework/failures/` with first-pass §5.8 classification — no additional step needed.

3. **Summarize the result**. Report:
   - Total tests, passed, failed.
   - For each failure: test ID, classification (`stale-expectations` / `engine-bug` / `golden-bug` / `generator-misread` / `spec-ambiguity`), confidence, the new record's path.
   - Whether any classifications look low-confidence and should get human review next.

4. **Hand off per classification** (per §11.6 authority):
   - **stale-expectations** → suggest `flashquery-macro-testgen --mode=refresh` against the affected test ID(s).
   - **engine-bug** → suggest investigating the engine code path; the record's "Suggested remediation" section names the symptom.
   - **golden-bug** → suggest manually re-running the macro through the golden + reviewing the patch list in `_POC-Audit-Findings.md`. Golden version bumps are operator-approved (§11.6 gate 1).
   - **generator-misread** → suggest regenerating via `flashquery-macro-testgen --mode=committed --target=<cell>` after refining the synthesis.
   - **spec-ambiguity** → surface the record's "Spec ambiguity proposal" section, ask the operator whether to promote to a real OQ in the relevant spec doc (§11.6 gate 2).

5. **Offer no commits**. Failure records are write-only artifacts; commit when the operator decides what to do.

### B. Triage an existing record

Trigger phrases: "re-triage this", "is this record still accurate?", "classify the failure at \<path\>", "mark this resolved", "what does this record say?".

Steps:

1. **Read the record path** the user names (or, if they say "the latest", pick the most recent file under `tests/macro-framework/failures/`).

2. **Invoke the re-triage**:

   ```bash
   npm run run:macro-framework -- --triage <recordPath>
   ```

   This reads the record's frontmatter, follows `test_file:`, drives the production engine, re-classifies, and appends to the record's action log:
   - If the test now PASSES, the action log records that — suggest the operator mark `status: resolved` in frontmatter.
   - If it still fails, the new classification + rationale + suggested action are appended to the action log; `classification` and `confidence` in frontmatter are updated.

3. **Surface the result** to the user. Show:
   - Old classification → new classification (if changed).
   - Rationale.
   - Suggested next action (per §11.6).

4. **Don't auto-modify status**. `status: resolved` / `escalated` / `invalidated` transitions are operator gestures per §11.6; the skill suggests but doesn't apply.

### C. Pre-run stale-version check (standalone)

Trigger phrases: "are any tests stale?", "check golden drift", "is the golden current across the corpus?", "what tests use old goldens?".

Steps:

1. **Invoke the check**:

   ```bash
   npm run run:macro-framework -- --stale-check
   ```

2. **Surface the report**. For each stale test: ID, recorded version → current version, suggested refresh command.

3. **Offer to hand off to testgen**. If the user says "yes refresh them," route to `flashquery-macro-testgen --mode=refresh --auto-accept-identical`. Don't refresh from this skill.

## Classifier reference (§5.8 heuristics)

The classifier (`triage/classify.ts`) implements the §5.8 five-way decision tree:

1. **`stale-expectations` — checked first** (§5.8). `golden_version_used !== golden_version_current`. Cheapest classification. High confidence.

2. **`engine-bug`** (§5.8 + §11.6). Hand-authored test (no `generator:` block) + golden in sync + finding hits a structural field (`outcome`, `return_result`, `error.code`, `trace_kinds_in_order`, `side_effects.*`) + `golden_snapshot.state_notes` corroborates the expectation. Medium confidence when state_notes corroborate; low confidence otherwise.

3. **`generator-misread`** (§5.8). Test has `generator:` provenance + golden in sync + structural-field finding + grounding refs look prose-heavy (long or contain ambiguity markers like "may", "should", "if applicable"). Medium confidence when prose-heavy signal is present; low otherwise.

4. **`golden-bug`** (§5.8). Rare path. `golden_snapshot.state_notes` shows a binding whose value contradicts the embedded `expect.return_result`. Always low confidence — true golden-bug verification requires re-running the macro through the golden.

5. **`spec-ambiguity`** (§5.8, residual). Nothing above fit. Low confidence by definition; routes to operator review per §11.6.

**Confidence calibration.** Per §11.6 only `stale-expectations` is fully automatable. Every other classification is a first-pass call; the operator confirms or overrides. The skill should be honest about confidence levels when surfacing — "low confidence engine-bug" is different from "high confidence stale-expectations" in what the operator should do next.

## Verification gate (for changes to this skill itself)

When modifying this skill, the run-cli, the classifier, or the record writer:

1. **`npm run run:macro-framework -- --stale-check`** reports zero stale tests (or, if any are intentionally aged for testing, surfaces them with correct old/new versions).
2. **`npm run run:macro-framework`** invokes the suite, streams output, and reports the pass/fail summary; on failures, classified records appear under `tests/macro-framework/failures/`.
3. **`npm run run:macro-framework -- --triage <recordPath>`** re-classifies a known failure record without crashing and appends a new action-log entry.
4. **All 20 existing pilots** still pass with the new classifier in the loop (Phase 5's count, which Phase 6 should not regress).
5. **`npx tsc --noEmit -p tests/macro-framework/tsconfig.json`** is clean.

## Principles

**The classifier is a draft, not a verdict.** Per §5.8 and §11.6 the run skill's classification is always a first-pass call. Operator review confirms or overrides. The skill should never claim certainty beyond what the heuristic supplies.

**Two operator-controlled gates** (§11.6). Golden-version bumps and spec-doc edits both require explicit operator action. The skill suggests, the operator decides. Don't auto-bump versions or auto-promote spec OQs.

**Records are append-only.** Re-triage appends to the action log; it doesn't rewrite history. The original classification stays visible even after a reclassification.

**Stale-expectations gets refresh, not engine fixes.** When stale-expectations is the classification, the next step is `flashquery-macro-testgen --mode=refresh`, never an engine code change. Catching this distinction is the whole point of checking `golden_version` first.

**Failure records are committed.** Per §9.6 the `failures/` directory is checked into git. Historical records (e.g., the 6 pilot-10 records from Phase 3) are preserved as history; new records add to them.

## Related skills

- **`flashquery-macro-testgen`** — generate new pilots, refresh stale ones. The natural handoff target for `stale-expectations` and `generator-misread` classifications.
- **`flashquery-macro-covgen`** — regenerate the coverage matrix. Doesn't intersect with this skill directly, but the operator may want to refresh after a triage sweep.
- **`flashquery-directed-run`** / **`flashquery-integration-run`** — sister run skills for the other test layers. Same triad shape (covgen + testgen + run); this one is exclusively for `tests/macro-framework/`.
