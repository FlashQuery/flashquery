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

**Macro source synthesis is delegated to `flashquery-macro-author`** (sister skill, also in `.claude/skills/`). That skill takes the cell description + REQ-NNN grounding refs and produces the macro source via its generate workflow (with built-in verify + auto-correction loop). When this skill drives the synthesis, invoke `flashquery-macro-author`'s generate workflow with the cell description as input; `flashquery-macro-author` handles the macro source. THIS skill (`flashquery-macro-testgen`) handles everything around the macro: tool surface, expectations, vault, coverage tagging, golden snapshot capture, provenance block.

The split exists because macro source synthesis is reusable beyond the test framework (end-user macro authoring also goes through `flashquery-macro-author`). When the spec for the macro language evolves, the shared `macro-spec.md` in that skill's folder is the single update point — both generation and verification track automatically.

When working in agent mode, anchor the synthesis on:
- **What the REQ says.** The REQ-NNN excerpts from `loadCellMetadata` describe the language behavior the cell exercises.
- **What the cell description says.** It's the human-readable mission statement.
- **What the exemplars look like.** Match comment density and YAML structure.
- **Production-engine surface (as of v3.5 + REQ-112a-d shipping, 2026-05-19).** Production now supports the full macro language surface; the synthesis should use idiomatic constructs rather than older workarounds. Positive guidance:
  - **Boolean literals.** `true` and `false` are first-class lowercase keywords (REQ-112c). Use `flag = true` and `if $flag then ...`. Do NOT generate `True`/`False`/`None` — they parse as identifiers but the convention is lowercase. Integer-as-sentinel patterns (1/0) are still valid but discouraged when a true boolean is meant.
  - **`continue` / `break` loop control.** Fully supported inside `for` / `while` bodies (REQ-104). Use them for skip / early-exit patterns. Parse-time error fires only when they appear outside a loop body.
  - **`_self.*` direct binding.** When the macro is loaded via `source_ref`, `_self.path`, `_self.title`, `_self.frontmatter.*`, `_self.tags`, `_self.fq_id` are all directly readable (REQ-103). No `input_var` workaround needed.
  - **`_exists()` introspection.** Bare-identifier form (`svc._exists()`) works in any expression position — if-condition, `&&`/`||` operands, after `!`, as a builtin arg, etc. VarRef-prefixed form (`$server_name._exists()`) is allowed too for dynamic dispatch on a variable-stored server name (REQ-112a, introspection methods only — not for regular tool dispatch).
  - **`if`/`else` is NOT scope-creating** (REQ-112b). A new variable assigned only inside a branch persists after `fi`. No need to pre-declare outer-scope sentinels just to satisfy scoping. Untaken-branch assignments still leave the name undefined (no phantom default).
  - **Missing-field access returns `null`** (REQ-112d). `$obj.maybe` on a present object whose key is absent yields `null` (not a runtime error). Use `if $obj.maybe == null then default = ... fi` for optional-field guards. Chained access through `null` (`$obj.missing.subfield`) still throws via REQ-023 ac2 — typo-protection preserved.
  - **Flag argument syntax.** Use `--flag value` form (space-separated). The `--flag=value` form is not in the grammar.
- **Range exclusivity.** `1..5` iterates [1, 2, 3, 4] — end-exclusive per `buildRange()` in `src/macro/builtins.ts`.
- **Reserved keywords.** `for`, `in`, `do`, `done`, `if`, `then`, `else`, `fi`, `while`, `continue`, `break`, `null`, `true`, `false` cannot be assigned to. Identifiers BEGINNING with these prefixes (`forecast`, `truthy_check`) lex as bare identifiers — fine to use.
- **Builtin names.** `echo`, `status`, `task_id`, `list_tasks`, `count`, `unique`, `append`, `concat`, `add`, `sub`, `mul`, `div`, `mod`, `sleep`, `slow_op`, `fail`, `exit`, `input_var`, `range`, `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, `ls` cannot be shadowed by user assignments. Prefer non-conflicting names (e.g., `phase` instead of `status`, `result_value` instead of `exit`).

### Step 4 — Run the synthesized macro through the current golden
`captureAndEmbed(synth)` calls `captureSnapshot()` from `golden-bridge/load.ts`. The capture's return envelope, trace, side-effect manifest, progress events, and `state_notes` are all returned.

### Step 5 — Embed those outputs into `expect:` and `golden_snapshot:`
The helper merges author-declared `expect_overrides` over the captured baseline. The `golden_snapshot.state_notes` is taken verbatim from the capture.

**Side-effect count convention (lesson from strengthen-workflow calibration, 2026-05-19).** When the macro has **>1 tool dispatch AND >1 exit path**, the `expect.side_effects.tool_call_count` field should be populated for each pilot variant — positive count on the happy path (all dispatches fire), bounded count on each skip/fail path (only the dispatches before the early exit fire). Without this, the pilot can pass on the right return shape while masking a regression that adds spurious dispatches before the guard. The strengthen workflow will flag this if it's missing, but baking the convention into the wrap step avoids the loop.

Example pattern for a multi-dispatch + multi-exit macro:

```yaml
# Happy path pilot — all dispatches fire
expect:
  outcome: success
  return_result: { indexed: true, ... }
  side_effects:
    tool_call_count: 2   # doc_srv.fetch + index_srv.add

# Skip path pilot — only the pre-guard dispatch fires
expect:
  outcome: success
  return_result: { skipped: true, reason: "..." }
  side_effects:
    tool_call_count: 1   # doc_srv.fetch only — index_srv.add MUST NOT fire
```

### Step 6 — Stamp `golden_version` + `golden_run_at`
`GOLDEN_VERSION` is read from `tests/macro-framework/macro-golden-model/src/version.ts`. The `golden_run_at` field is the ISO timestamp at capture time.

### Step 7 — Add `generator:` provenance + `covers:` + `intent:`
The generator block carries the skill name, version (currently `1`), model identifier, timestamp, targeted cell list, and grounding refs (REQ-NNN strings the synthesis used). The `covers:` array enumerates all MTF-* cells the test contributes to, including incidental ones.

**`intent:` field (required for AI-generated, strongly recommended for hand-authored).** This is the natural-language description that drove macro generation — the English prompt given to `flashquery-macro-author`, or for hand-authored pilots, the design intent statement. Distinct from `description:` (which describes the test mechanics + REQ citations). Emit it verbatim from the original prompt; this makes it possible to:

- grep the pilot corpus by wording to find related scenarios;
- retrace why a particular macro shape emerged from a particular phrasing;
- re-run the generation against an updated skill to check for improvements;
- aggregate the calibration eval log automatically from pilot files.

When wrapping a macro this testgen produced from `flashquery-macro-author`, copy the original description into `intent:` verbatim. Do not paraphrase.

### Step 8 — Validate the emitted YAML
`validateGeneratedTest(path)` re-loads the YAML through the runner, drives the production engine, and runs the comparator. Any divergence at this stage indicates a generator misread (per §5.8) and should be reported to the operator with the comparator findings.

### Step 9 — Write to `cases/<category>/` (committed) or `cases-fresh/` (fresh)
`writeGeneratedTest(synth, yaml_text, opts)` handles destination paths. Committed-mode files land under `cases/<MTF-category>/<NN-descriptive-slug>.yml`; fresh-mode files land under `cases-fresh/<slug>.yml`.

## Strengthen workflow — make the pilot rigorous

After the wrap workflow (steps 1-9 above) produces a draft pilot, the **strengthen workflow** analyzes that draft for test-rigor gaps. It's a separately invokable workflow, run by default after wrap, that asks one question:

> *Is this pilot exercising the macro thoroughly enough to catch defects the assertions would otherwise miss?*

This is distinct from `flashquery-macro-author/verify`, which asks "is the macro what was asked for?" The author's verify checks the **macro source** against the **intent**. Strengthen checks the **test pilot** against the **macro + intent**. Different question, different findings surface.

### Three modes (mirrors author skill)

| Mode | `strengthen` | `auto_apply` | Behavior | Use case |
|---|---|---|---|---|
| **Wrap-only** | `false` | n/a | Just emit the draft pilot from steps 1-9. No rigor analysis. | Trivial cases or when caller wants raw wrap output. |
| **Validated** (default) | `true` | `true` | Run rigor analysis, auto-apply suggestions classified as `required_assertion_missing`, surface `recommended_assertion` findings as warnings, emit polished pilot. | End-user testgen invocation. |
| **Calibration** | `true` | `false` | Run rigor analysis, surface ALL findings, do NOT modify the draft pilot. Return draft + findings list. | Our skill-honing flow. We see what strengthen would suggest; decide; feed misses back into the workflow's prompt. |

### Input contract

The strengthen workflow takes:

- `macro` (required) — the macro source (typically passed from the author skill's output).
- `intent` (required) — the natural-language description that drove macro generation.
- `draft_pilot` (required) — the YAML produced by the wrap workflow (steps 1-9). Contains `expect:`, `tools:`, `vault:`, `self_binding:`.
- `pilot_variants` (optional) — when a single macro is wrapped into multiple pilots exercising different branches (like 930/931/932 for a multi-exit macro), passing the variant set lets the rigor analysis check branch-coverage across pilots.
- `auto_apply` (optional, bool, default `true`) — controls whether `required_assertion_missing` findings are auto-applied to the pilot YAML.

### Process

1. Parse the macro source. Identify:
   - **Exit paths.** Every `exit ...` and `fail ...` statement, with the conditions under which each fires.
   - **Tool dispatches.** Every `<server>.<tool>(...)` call, with the conditions under which each fires.
   - **State mutations.** Every `fq.write_document`, `fq.archive_document`, `fq.apply_tags`, vault write, frontmatter update.
   - **Branches.** Every `if`, `else`, `for`, `while` body — what code paths are conditionally executed.
2. Compare against the draft pilot's `expect:` block. For each axis below, generate rigor findings.
3. Return the report (calibration) or auto-apply required findings and emit polished pilot (validated).

### Rigor analysis axes

#### Axis 1 — Multi-exit assertion specificity

If the macro has multiple `exit` paths producing distinguishable values, the pilot's assertion must identify *which* path was taken. Two pathological scenarios:

- **Different paths return same shape.** If exits 1 and 2 both return `{ status: "done" }`, the assertion can't tell which fired. Suggest adding a path-marker field to one of them, OR adding `trace_kinds_in_order` to verify the dispatch sequence.
- **Path identified by return shape only, side effects unverified.** Pilot 930's case — `{ indexed: true, doc_id: ... }` uniquely identifies the happy path by return shape, but a buggy macro that takes the happy path AFTER also dispatching to a side-effect-laden tool (extra `index_srv.add` call) would still pass. Suggest adding `side_effects.tool_call_count`.

#### Axis 2 — Side-effect coverage

For each tool dispatch in the macro, the pilot's `expect.side_effects` should assert:

- **Positive coverage:** when the macro's runtime path reaches a dispatch, the pilot asserts the dispatch happened (via `tool_call_count` increment or explicit `tool_calls[i]` entry).
- **Negative coverage:** when the macro's runtime path SHOULD skip a dispatch (because of a guard, fail, or early exit), the pilot asserts the dispatch DIDN'T happen (via `tool_call_count` lower bound).

Without negative coverage, a refactor that accidentally moves a side-effect dispatch *before* the guard could pass the return-shape assertion while still firing the unwanted dispatch.

#### Axis 3 — Branch coverage across the pilot set

If a macro has N branches, the pilot set should have N variants exercising each branch. The strengthen workflow checks across variants:

- All exit paths represented? (One pilot per exit.)
- All for-loop / while-loop edge cases? (Empty list, single item, multiple items, break/continue paths.)
- All if-then-else branches? (then-only, else-only, both, neither.)

A multi-branch macro shipped with only the happy-path pilot is a `required_assertion_missing` finding — the unhappy paths are untested.

#### Axis 4 — State-assertion coverage

If the macro writes back (`fq.write_document`, `fq.apply_tags`, etc.), the pilot should have a follow-up step that reads the affected state and asserts the write landed. In the directed/integration scenario layer this is straightforward (`op: get_document`); in the in-process macro framework it's limited because `fq.*` is stubbed, but vault writes via shell verbs can be verified by reading the vault fixture post-run.

#### Axis 5 — Negative assertions on skip/fail paths

For pilots exercising "this should skip / fail / not happen" paths, the rigor analysis flags missing negative assertions. Examples:

- Skip path: `tool_call_count` should be lower than the happy path.
- Fail path: `outcome: fail` is correct, but ALSO `tool_call_count` should be capped before the failing dispatch.
- Untaken branch: variables assigned only in the untaken branch should NOT appear in the return value.

#### Axis 6 — Intent fidelity (added 2026-05-19 for behavioral-description testgen)

When the macro was authored from a **behavioral description** (intent-level English, not pseudocode), the author skill picks an implementation. That implementation might:
- miss a behavior the description named (intent has 3 axes; macro implements 2),
- be structurally correct but not be exercised by the wired-up test inputs / tool config (dead-code branches in this pilot),
- or be exercised but not pinned by the assertions (a regression in that behavior would still pass the pilot).

Each of these makes the pilot *appear* to test the intent without actually doing so. Axis 6 catches it.

**Three checks under Axis 6:**

1. **Behavior-to-code mapping.** Parse the behavioral intent for named behaviors (e.g., "reject the whole batch if any item is invalid", "send a notification for urgent items", "default `retries` to 3 if missing"). For each named behavior, identify the code pattern that implements it in the macro. **A behavior with no corresponding code pattern is a fidelity gap.** Resolution: surface the gap with a concrete suggestion — either revise the macro (re-invoke author skill with the missing-behavior finding) or revise the intent description if it was ambiguous.

2. **Pattern-to-input mapping.** For each behavior-implementing code pattern in the macro (especially branches, dispatches, guards), verify the test inputs + tool configuration actually drive execution through that pattern. **A pattern that the test inputs never trigger is dead code in this pilot.** Resolution: add test data that exercises the path, OR add a separate pilot variant whose inputs do, OR if the pattern is genuinely unreachable from valid inputs, note it as untestable framework-side.

3. **Behavior-to-assertion mapping.** For each behavior the intent named AND the macro implements AND the inputs trigger, verify the `expect:` block has an assertion that would FAIL if that specific behavior regressed. **A behavior with no sensitive assertion is silently tested.** Resolution: add a targeted assertion (e.g., specific tool_call args, specific exit field value, specific trace_kind sequence).

**Why this axis was added.** During Run #10.3 / #10.4 (first behavioral-description scenarios, 2026-05-19), the author skill produced macros that happened to fully implement the intent — but Matt flagged the broader risk: a behavioral description gives the skill latitude to pick an implementation, and that implementation might not exercise what we said we wanted to test. The strengthen workflow sits at the right layer to catch this: it has visibility into both the macro AND the test inputs / tool configuration, so it can ask "does this combination actually trigger every behavior the intent named?"

**Findings produced under Axis 6:**

```json
{
  "axis": "intent_fidelity",
  "severity": "required_assertion_missing | recommended_assertion | style",
  "sub_kind": "behavior_not_implemented | pattern_not_triggered | behavior_not_asserted",
  "named_behavior": "<short quote or paraphrase from the intent>",
  "current_state": "<what the macro/pilot does today>",
  "missing": "<the specific gap>",
  "suggested_resolution": "<one of: revise_macro | add_inputs | sharpen_assertion>",
  "diff": "<concrete change proposal>"
}
```

**When this axis fires `revise_macro`, the strengthen workflow can loop back to the author skill** with the behavior-not-implemented finding, asking for a regeneration that covers the missing behavior. This is the workflow loop Matt described: behavioral intent → macro → strengthen detects intent gap → macro revised → strengthen re-runs → settle.

### Finding taxonomy

```json
{
  "axis": "multi_exit_specificity | side_effect_coverage | branch_coverage | state_assertion | negative_assertion | intent_fidelity",
  "severity": "required_assertion_missing | recommended_assertion | style",
  "finding": "<one-line description>",
  "current_state": "<what the pilot currently asserts>",
  "missing": "<what the pilot doesn't catch>",
  "defect_class": "<what kind of bug would slip through without this assertion>",
  "suggested_change": {
    "block": "expect.side_effects | expect.return_result | expect.trace_kinds_in_order | tools | vault | <other>",
    "diff": "<YAML snippet to add or modify>"
  },
  "rationale": "<why this matters>"
}
```

Severity rules:

- **`required_assertion_missing`** — the missing assertion would let a real defect class slip through. Auto-applied in validated mode.
- **`recommended_assertion`** — would tighten the test but not strictly required. Surfaced as warning; not auto-applied.
- **`style`** — YAML structure / naming / comment improvements. Surfaced as warning.

### Output shape — strengthen workflow

**Validated mode (auto_apply: true):**

```json
{
  "mode": "validated",
  "polished_pilot": "<final YAML with required findings auto-applied>",
  "applied_findings": [ ... ],
  "warnings": [ ... ]
}
```

**Calibration mode (auto_apply: false):**

```json
{
  "mode": "calibration",
  "draft_pilot": "<unchanged YAML from the wrap step>",
  "rigor_findings": [
    { "axis": ..., "severity": ..., "finding": ..., "suggested_change": ..., "rationale": ... }
  ],
  "skill_improvement_signal": "<recurring patterns the wrap workflow should learn to handle upstream>"
}
```

### Calibration usage (our workflow)

For every smoke-test run from #4 onward, after the author skill produces the macro and testgen wraps it, run the strengthen workflow in calibration mode. Treat strengthen findings the same way we treat author/verify findings: spec-edit if recurring, accept if context-specific, log all of it. Over time the strengthen workflow's prompt converges toward producing already-rigorous pilots in the wrap step.

### Convention going forward

Default for testgen invocation: `strengthen: true, auto_apply: true` (validated mode). End-users invoking testgen receive polished pilots without needing to run strengthen separately. For our calibration runs we explicitly pass `auto_apply: false` and log the findings.

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

## Five-step pipeline + reconciliation gate (canonical workflow)

The full pilot-generation pipeline composes the author skill, the wrap workflow, the strengthen workflow, and a **golden-capture + reconciliation gate** that's mandatory before any pilot reaches the test suite. The reconciliation gate is the framework's enforcement of §5.6 (golden-as-snapshot): the golden is the independent oracle, AI predictions are checkpoints, production is the implementation being tested.

### The pipeline

```
1. flashquery-macro-author / generate
   description → macro source
   (verify runs internally; auto-correction loop on misses)

2. flashquery-macro-author / verify (already inside step 1)
   description ↔ macro → "is the macro what was asked for?"

3. testgen / wrap (steps 1-9 above)
   macro + intent → DRAFT pilot YAML
   includes predicted_expect: (AI's prediction of outcome)

4. testgen / strengthen
   macro + intent + draft → rigor findings
   apply suggestions; macro may revise; settle to FINAL DRAFT

5. testgen / golden_capture + reconciliation gate
   run macro through captureSnapshot()
   compare predicted_expect vs golden_expect:
     • predicted ⊆ golden → MATCH (golden is richer than AI; OK)
     • predicted == golden → MATCH (perfect alignment)
     • predicted ⊥ golden → DIVERGENCE — HARD STOP
       triage: AI wrong? golden wrong? intent ambiguous?
     • predicted ⊇ golden → SUSPICIOUS — investigate
       (AI predicted more than golden produces; either AI hallucinated
       or golden is missing expectations it should have)
   on MATCH: promote golden capture to expect: (source of truth)
   embed golden_snapshot: for triage

6. (only after gate passes) Run pilot
   production output vs expect: (which is golden-verified)
   any divergence → triage taxonomy (engine bug, golden drift, test bug)
```

### MANDATORY: golden capture is non-optional (2026-05-20)

**Every** pilot YAML written by this skill MUST be run through `_generic-capture-runner.ts` (or invoke `captureSnapshot` directly) before being considered complete. **No exceptions.** AI-only predictions are not a valid substitute — that's exactly what the reconciliation gate exists to prevent.

The skill's "complete" criterion now includes:

1. `reconciliation.predicted_matched_captured` is `true` or `false` (NEVER null)
2. `reconciliation.captured_at` is a real ISO timestamp (NEVER null)
3. `reconciliation.divergence_kind` is set (e.g., `clean_match`, `predicted_diverges_from_golden`, or a specific divergence-class label when triaged)
4. `golden_snapshot:` block is present with `captured_trace_kinds` and `captured_tool_calls` lists
5. `predicted_expect:` block is present (the AI's prediction, regardless of whether it matched)
6. `expect:` block is present (the source-of-truth assertion the runner compares against)
7. `intent:` field is present (verbatim natural-language description that drove generation)

After every batch of newly authored pilots, run **`_pilot-validate.py`** as the final gate. It walks all pilot YAMLs under `cases/` and emits findings for any pilot missing a required field, any null reconciliation, any missing golden_snapshot when the reconciliation claims success. A clean validator run is the precondition for declaring a batch "done."

If the validator reports incomplete pilots, the skill MUST loop back: run the generic capture runner, apply the captures via `_apply-captures.py`, re-validate. Do not declare done until validator is clean.

This rule exists because between 2026-05-19 and 2026-05-20 the skill drifted: ~398 of 409 pilots in the corpus were incomplete (no golden capture, no reconciliation populated, sometimes missing predicted_expect or intent entirely). The autonomous Run #9 (200 pilots) was the worst offender. Matt called this out, and the fix is to make the validator a non-skippable step. Going forward, no pilot ships without the runner + validator having run successfully.

### Reconciliation gate semantics

The gate compares `predicted_expect` (from step 3) against the golden's captured envelope (step 5). Four possible outcomes:

| Comparison | Resolution |
|---|---|
| **Exact match** | Promote captured to `expect:`. Log clean reconciliation. Proceed to step 6. |
| **AI ⊆ Golden** (AI predicted a subset; golden produced more detail like trace/state_notes) | Acceptable. AI predicted the core fields; golden captures everything. Promote captured to `expect:`; log "AI prediction was a clean subset". |
| **AI ⊥ Golden** (different values for the same fields) | **HARD STOP.** Resolve before proceeding: (a) AI prediction wrong → update `macro-spec.md` / SKILL.md; (b) golden wrong → fix golden, log as golden-bug; (c) intent ambiguous → revise description, regenerate. |
| **AI ⊇ Golden** (AI predicted MORE than golden produces) | **SUSPICIOUS.** Either: (a) AI hallucinated fields the macro doesn't actually produce, or (b) golden is missing expectations it should produce. Investigate before proceeding. |

### YAML fields emitted by the pipeline

```yaml
# Step 3 (wrap) output
predicted_expect:
  outcome: ...
  return_result: ...
  side_effects: ...

# Step 5 (golden capture + reconciliation gate) output
reconciliation:
  predicted_matched_captured: true | false
  captured_at: ISO-8601
  golden_version: "..."
  divergence_kind: <kind>  # only when not matched
  golden_captured: { ... }  # only when not matched
  notes: |
    <reconciliation narrative>

# Final source-of-truth (golden-verified, unless DIVERGENCE was
# explicitly resolved with documented rationale)
expect:
  outcome: ...
  return_result: ...
  side_effects: ...

# Step 5 (capture) output — for triage if production diverges
golden_snapshot:
  state_notes: [...]
  captured_trace_kinds: [...]
  captured_tool_calls: [...]
```

### Why the gate matters

Without this gate, calibration runs would be relying on the AI as oracle. If AI prediction and production agreed but both were wrong, the test would pass silently. The golden provides an independent third opinion: production matches a value that the golden — implemented separately, with its own spec interpretation — also produced. If all three (AI prediction, golden, production) agree, the test is maximally trustworthy.

### Calibration value of the gate

Every reconciliation event produces calibration signal:

- **Clean match** → skill's mental model is accurate for this scenario shape. Trust climbs.
- **Divergence** → real signal: AI/golden/spec disagreement that needs resolving. Each one drives a spec edit, a golden patch, or a description refinement.

The agreement rate across the pilot corpus is a top-line metric of skill quality (see `_skill-eval-log.md` for the running stats).

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
