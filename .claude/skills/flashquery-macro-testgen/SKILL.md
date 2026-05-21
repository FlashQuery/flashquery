---
name: flashquery-macro-testgen
description: Generate, refresh, and validate macro-framework test YAMLs against `tests/macro-framework/coverage/manifest.ts`. Use this skill when the user wants to generate a macro framework test, generate a macro framework pilot, add coverage for an MTF-* cell (e.g. MTF-C-008, MTF-D-008, MTF-L-008), fill a macro framework density gap, create an AI-generated macro pilot, exercise a low-density cell, refresh embedded golden snapshots after a golden_version bump, or asks to "make a macro test for X", "cover MTF-X", "regenerate this pilot's snapshot", "refresh the macro tests for the new golden", or anything involving generating macro-framework pilots. Sister skill to `flashquery-macro-covgen` and `flashquery-macro-run`; this one is exclusively for the `tests/macro-framework/` layer and the `macro-golden-model` snapshot source.
---

# FlashQuery Macro TestGen (`flashquery-macro-testgen`)

This skill generates new macro-framework test YAMLs by running synthesized macros through the `macro-golden-model` and embedding the resulting snapshots, per Macro Testing Framework Requirements §5.5 (AI Test Generation) and §9.5 (Generator integration approach). It is the macro-framework counterpart to `flashquery-directed-testgen` and `flashquery-integration-testgen`.

This is an **agent-mode skill**: there is no CLI entry point. An AI agent runs the pipeline below directly — constructing the behavioral brief, delegating macro authorship to `flashquery-macro-author`, wrapping the macro into a pilot YAML, capturing the golden snapshot, and reconciling — using the `scripts/` capture tooling (`capture-runner.ts`, `apply-captures.py`, `validate-pilots.py`). Committed pilots are written straight into `tests/macro-framework/cases/<category>/`.

## When to use

- The user names an MTF-* cell or describes an uncovered behavior and asks for a test.
- The user asks to fill the lowest-density coverage cells with new pilots.
- The golden version bumped and the user asks to refresh embedded snapshots in existing tests.
- The user asks to validate or repair a test that's failing after a golden change.

## What this skill does NOT do

- It does **not** update `coverage.json`. After generating new tests run `flashquery-macro-covgen` to refresh the coverage matrix.
- It does **not** add cells to `manifest.ts`. Cells are added manually per §6.4 lifecycle. If the user wants coverage for a behavior that has no cell yet, edit `tests/macro-framework/coverage/manifest.ts` first.
- It does **not** run the full macro framework suite. That's `flashquery-macro-run`. The skill validates the *single* test it just generated; it does not re-run the whole pilot corpus.
- It does **not** modify the golden model. Bumping the golden version is a separate workflow (Phase 1 + golden meta-tests). This skill only consumes the current golden as a snapshot source.

## Inputs

- One or more target MTF-* cell IDs, OR
- A request to fill the lowest-density cells (read `coverage/coverage.json` to rank them), OR
- A set of existing tests whose `golden_version` is older than the current golden, to refresh.

The skill reads `tests/macro-framework/coverage/manifest.ts`, `coverage/coverage.json`, the existing pilots under `cases/`, and the Macro Language Requirements REQ-NNN definitions to ground each generated test in spec text.

## Generating vs. refreshing

**Generating a new pilot.** When the user names a cell or describes a behavior, run the full five-step pipeline below. The pilot is written under `tests/macro-framework/cases/<category>/<NN-slug>.yml` and committed to git. Per §9.5 every generated pilot must carry `generator:` provenance (skill, version, model, timestamp, targeted cells, grounding refs) plus real `golden_snapshot:` data captured at generation time.

**Refreshing a stale pilot.** When the golden version bumps, pilots whose embedded `golden_version` is behind the current golden need their snapshots re-captured. Re-run the capture pipeline (`scripts/capture-runner.ts` → `scripts/apply-captures.py`), then compare: a structurally-identical capture (same length, same per-step `kind`) can have its `golden_version` bumped directly; a divergent capture is an operator-review item — report it, don't silently rewrite. The `flashquery-macro-run` skill's `--stale-check` flags which pilots are behind.

## Constructing the behavioral brief (the input to `flashquery-macro-author`)

This skill — the wrapper — owns the quality of the input it hands the author skill. `flashquery-macro-author` is an obedient translator: it turns whatever description it receives into a macro and never second-guesses its caller. So if the wrapper passes it the mechanical cell one-liner ("for-loop with mid-iteration abort via `fail()`") or — worse — pseudocode, the author skill faithfully transcribes that, and the resulting pilot proves only "the engine runs *this exact macro*," never "the engine supports the *behavior* we wanted." The behavior→macro translation is the thing under test; it only happens if the input describes behavior.

**Before delegating to `flashquery-macro-author` in Step 3, the wrapper MUST construct a behavioral brief and hand the author skill *that* — never the raw cell description, never pseudocode.**

### What a behavioral brief is

A structured statement of intent with these slots and no others:

| Slot | Contents |
|---|---|
| `goal` | What the macro should accomplish, in plain English — the outcome, not the steps. |
| `preconditions / inputs` | What the macro is given: `input_vars`, seed vault state, starting conditions. |
| `tool surface` | Which brokered servers/tools the macro is expected to use, described by *what they do* ("a brokered tool that returns a structured object"), not by archetype name or call syntax. |
| `triggering condition` | The scenario condition that drives the behavior under test — or "runs straight through" when there is no branch. |
| `expected observable outcome` | What a correct run produces — exit value shape, envelope, side-effect facts — *including the negative facts* ("nothing after the abort runs"). |

There is deliberately **no `steps` slot**. Pseudocode needs somewhere to live; the template gives it nowhere. A test brief is *prescriptive about the scenario* (these inputs, this condition, this observable outcome) and *silent about the implementation* (which constructs, which variable names, which statement order). Holding that line is the whole point of this step.

### Where the brief comes from

1. **If the target cell has a `behavior:` field in `manifest.ts`** — that field is a curated, human-reviewed behavioral framing. **Instantiate it**: keep its goal / condition / outcome, fill in concrete `input_vars` values and a concrete tool surface. Instantiation, not invention — this is the preferred path.
2. **Otherwise, synthesize the brief** from the cell's `description` plus the REQ spec text reached via `source_citations`. **Ground the brief on the REQ text — REQs describe what the feature *does*.** Do NOT draft the brief from the exemplar pilots: exemplar *macros* are pseudocode, and drafting from them produces pseudocode-shaped briefs. The exemplars (Step 2) are for YAML shape only, never for the brief.

### Few-shot examples — raw input → behavioral brief

**Example A — a control-flow cell (expand a mechanical one-liner):**

```
RAW INPUT  cell MTF-C-002 — "for-loop with mid-iteration abort via fail()"
           grounded on REQ-013 (for-loop) + REQ-024 ac3 (fail → macro_aborted)

BEHAVIORAL BRIEF
  goal: Scan a sequence of items one at a time and halt the entire run
        immediately — with a diagnostic message — the moment a disallowed
        item is encountered.
  preconditions/inputs: a list of item identifiers, at least one of which is
        the disallowed value.
  tool surface: none (pure control flow).
  triggering condition: the scan reaches the disallowed item.
  expected observable outcome: the macro aborts with a macro_aborted envelope
        carrying the diagnostic message; no item after the disallowed one is
        processed.
```

**Example B — contrastive (same cell), the failure mode to avoid:**

```
DON'T (pseudocode — this is transcription, not a brief):
  "for n in 1..10: if n == 5, call fail('halt at 5'); then echo 'done'."

DO (behavioral — Example A's brief).
```

The pseudocode version dictates the construct (`for`), the bound (`1..10`), the
variable (`n`), the literal, and the statement order. The behavioral brief
fixes the *scenario* and leaves every one of those choices to the translator.

**Example C — a dispatch cell (the brief names a tool surface behaviorally):**

```
RAW INPUT  cell MTF-D-005 — "CallToolResult coercion path 2 (structuredContent)"
           grounded on REQ-106

BEHAVIORAL BRIEF
  goal: Call a single brokered tool, bind its result, and return it — where
        the tool delivers its data as a structured object.
  preconditions/inputs: none.
  tool surface: one brokered server exposing one tool that returns a small
        structured record as its payload.
  triggering condition: the tool call completes successfully.
  expected observable outcome: the macro exits carrying the tool's structured
        object as its result, bound and round-tripped intact.
```

**Example D — a thin-surface cell (behavioral at the appropriate grain):**

```
RAW INPUT  cell MTF-G-002 — "Number literal (integer)"

BEHAVIORAL BRIEF
  goal: Use a whole number as a value and confirm it survives a round-trip
        through the engine unchanged.
  preconditions/inputs: none.
  tool surface: none.
  triggering condition: runs straight through (no branch).
  expected observable outcome: the macro exits carrying the integer it was
        given, with the same value and numeric type.
```

Example D is the guard against over-correction: a tiny feature gets a *small*
behavioral brief stated plainly — do not fake-elaborate it into a story.

### Self-check before handoff

After drafting the brief, the wrapper checks its OWN output before passing it on:

- **Does the brief name macro-language syntax or constructs?** Look for `for` / `while` / `do` / `done` / `if` / `then` / `fi` / `exit` / `fail` used as verbs, `$`-prefixed names, `=` assignments, builtin names used imperatively, object-literal `{...}` syntax. Any of these means the brief has drifted into pseudocode — **rewrite the brief and re-check.**
- **Does every slot have content?** A missing `goal` or `expected observable outcome` means the brief is too thin to translate — fill it from the REQ text.
- **Is it scenario-prescriptive but implementation-silent?** It must pin the data and the observable result without dictating the statement sequence.

This loop is the wrapper checking the wrapper's own work. The author skill never sees a bad brief and never has to push back on its caller.

### Handing the brief to the author skill

The brief maps cleanly onto `flashquery-macro-author`'s existing input contract — **no change to that skill is needed**:

- `goal` + `triggering condition` + `expected observable outcome` → the `description` string.
- `tool surface` → `context.tool_surface` — **concretized first**. The brief's `tool surface` slot is behavioral ("a tool that returns a structured object"); what the author skill receives is the *concrete* surface — real `server.tool` names + archetype + return values — produced in Step 3a. The author is handed those names and transcribes them; it never invents or discovers servers.
- `preconditions / inputs` → `context.input_vars` (the vault seed is the wrapper's own concern, handled in Step 3).
- `expected observable outcome` → `context.success_contract`.

The behavioral brief — verbatim — is also what becomes the pilot's `intent:` field (Step 7). That keeps every pilot traceable to the behavior it was meant to exercise.

### Backstop — transcription distance

After the macro comes back and the pilot is assembled, sanity-check translation distance: if the macro's variable names and statement order are ~1:1 derivable from the brief's wording, the brief was pseudocode that slipped the self-check. Flag it and note it in `eval-log.md` — it is a calibration signal that brief-construction needs tightening, not a hard test failure.

## The wrap stage (§5.5)

> **Orientation — read this first.** These 9 steps are the *mechanical detail of the `wrap` stage* — stage 3 of the end-to-end pipeline. They are **not** the whole workflow. The authoritative top-level workflow is **§"Five-step pipeline + reconciliation gate"** further down: construct the behavioral brief → the author skill generates the macro → wrap (these 9 steps) → strengthen → golden-capture + reconciliation gate → run. Read that section for the whole picture; read this one only for what `wrap` does internally.

The wrap stage turns a macro — produced by `flashquery-macro-author` from the behavioral brief — into a *draft* pilot YAML. Within each invocation, in order:

### Step 1 — Read the cell metadata + REQ acceptance criteria
Read `coverage/manifest.ts` for the target cell, follow its `source_citations` (REQ-NNN refs) into the Macro Language Requirements doc, and pull the relevant acceptance-criteria text. Those REQ excerpts become the pilot's `generator.grounding_refs` for traceability — and they are the spec source the behavioral brief is grounded on.

### Step 2 — Read 2–3 hand-authored exemplar tests
Read a couple of existing pilots in the same MTF-* category. Use them as shape/idiom references — variable naming, comment style, expect block conventions, YAML structure.

### Step 3 — Concretize the tool surface, then synthesize the test inputs

Step 3 has a **strict internal order: concretize the tool surface first, then author the macro against it.** The macro and the tool surface are co-designed — a macro that reads `$res.status` is only a meaningful test if the tool it called returns an object carrying a `status` field — so the surface cannot be honestly reverse-engineered from the macro after the fact. It must exist *before* the macro is authored.

**3a — Concretize the tool surface.** The behavioral brief's `tool surface` slot is deliberately behavioral ("a brokered tool that returns a structured object"). Turn it into a concrete artifact — for **every** server and tool the scenario needs:

- a concrete server name and tool name (invented here — arbitrary but sensible, e.g. `doc_srv` / `lookup`);
- a framework archetype (`ReadOnlyTool`, `ScriptedTool`, `JSONTextTool`, `NeedsInputViaTofuDrift`, … per §5.7);
- the concrete return value(s) the tool produces.

The return values are **scenario design, not an afterthought** — they are coupled to the macro's field reads and to the `expect:` block, so they are decided here, by the wrapper, never inferred later. This concrete tool surface is the single source of truth: it feeds both the author skill (3b) and the pilot's `tools:` block in the assembled draft. A scenario with no brokered tools simply has an empty surface.

**3b — Author the macro against that concrete surface.** Macro source synthesis is delegated to `flashquery-macro-author` (sister skill, also in `.claude/skills/`). Invoke its generate workflow with the behavioral brief mapped onto its `description` + `context` contract — and pass the **concrete** surface from 3a as `context.tool_surface` (real `server.tool` names, not the behavioral phrasing). **The author skill never invents or discovers server/tool names — it is always handed them and transcribes them into the macro.** This is symmetric with real end-user authoring, where the user names their real MCP servers directly: the author is given names either way; only the source differs (the user, or this wrapper).

**3c — Synthesize the rest of the inputs.** Assemble `input_vars`, vault seed state, and anything else *around* the macro. THIS skill (`flashquery-macro-testgen`) owns everything around the macro: tool surface, expectations, vault, coverage tagging, golden snapshot capture, provenance block. The author skill's `generate` workflow runs its built-in verify + auto-correction loop internally.

The split exists because macro source synthesis is reusable beyond the test framework (end-user macro authoring also goes through `flashquery-macro-author`). When the spec for the macro language evolves, the shared `macro-spec.md` in that skill's folder is the single update point — both generation and verification track automatically.

Anchor the synthesis on:
- **What the REQ says.** The REQ-NNN excerpts read in Step 1 describe the language behavior the cell exercises — this is the behavioral source the brief is grounded on.
- **What the behavioral brief says.** The brief constructed per §"Constructing the behavioral brief" is the mission statement — the brief, not the raw cell `description`, is what the macro is generated from.
- **What the exemplars look like.** Match comment density and YAML structure. Use the exemplars for *YAML shape only* — never as a source for the behavioral brief (their macros are pseudocode and would pull the brief toward pseudocode).
- **The macro-language surface is the author skill's domain — not restated here.** Boolean literals, `continue`/`break`, `_self`, `_exists()`, if/else scoping, missing-field-null, flag syntax, range exclusivity, reserved keywords, builtin-name shadowing — all of that is specified in `macro-spec.md` (in the `flashquery-macro-author` folder), and the author skill applies it during generation. `macro-spec.md` is the single source of truth; this skill deliberately does NOT duplicate macro-language rules, because a second copy only drifts. If you need to know what the language supports, read `macro-spec.md`.

### Step 4 — Run the synthesized macro through the current golden
Capture a golden snapshot of the synthesized macro — `captureSnapshot()` from `golden-bridge/load.ts` directly, or via `scripts/capture-runner.ts`. The capture yields the return envelope, trace, side-effect manifest, progress events, and `state_notes`.

### Step 5 — Embed those outputs into `expect:` and `golden_snapshot:`
The captured envelope becomes the `expect:` block (the production-comparison target). `golden_snapshot.state_notes` is taken verbatim from the capture.

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
The generator block carries the skill name, version (currently `1`), model identifier, timestamp, targeted cell list, and grounding refs (REQ-NNN strings the synthesis used). The `covers:` array enumerates **every** MTF-* cell the test contributes to, including incidental ones — it is a **required** field, validated by the runner and `validate-pilots.py`, so it must never be empty.

**`intent:` field (required for AI-generated, strongly recommended for hand-authored).** This is the natural-language description that drove macro generation — the behavioral brief given to `flashquery-macro-author`, or for hand-authored pilots, the design intent statement. Distinct from `description:` (which describes the test mechanics + REQ citations). Emit it verbatim from the behavioral brief; this makes it possible to:

- grep the pilot corpus by wording to find related scenarios;
- retrace why a particular macro shape emerged from a particular phrasing;
- re-run the generation against an updated skill to check for improvements;
- aggregate the calibration eval log automatically from pilot files.

When wrapping a macro this skill produced from `flashquery-macro-author`, copy the behavioral brief into `intent:` verbatim. Do not paraphrase.

### Step 8 — Validate the draft pilot
Re-load the emitted YAML through the runner, drive the production engine, and run the comparator. Any divergence at this stage indicates a generator misread (per §5.8) and should be reported to the operator with the comparator findings — don't ship the pilot until it's resolved.

**Tool-surface consistency guard.** As part of this step, reconcile the authored macro's `server.tool` references against the concrete tool surface from Step 3a:

- every `server.tool` the macro calls MUST exist in the pilot's `tools:` block — a reference to anything else is an author misread (the runner's pre-scan will also reject it as `unknown_server` / `unknown_tool`);
- every server/tool provisioned in the `tools:` block SHOULD be exercised by the macro — an unused entry is dead surface (the strengthen workflow's side-effect axis will also flag it).

A mismatch is a finding, not a silent fix: regenerate the macro or reconcile the surface before shipping. The guard catches the failure mode where the macro and the `tools:` block drift apart — they must agree by construction, because both derive from the single concrete surface chosen in 3a.

### Step 9 — Write the pilot to `cases/<category>/`
Committed pilots land under `cases/<MTF-category>/<NN-descriptive-slug>.yml` and are checked into git.

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

The full pilot-generation pipeline composes behavioral-brief construction, the author skill, the wrap workflow, the strengthen workflow, and a **golden-capture + reconciliation gate** that's mandatory before any pilot reaches the test suite. The reconciliation gate is the framework's enforcement of §5.6 (golden-as-snapshot): the golden is the independent oracle, AI predictions are checkpoints, production is the implementation being tested.

### The pipeline

```
1. testgen / construct the behavioral brief  →  flashquery-macro-author / generate
   cell (curated cell.behavior, or synthesized) → behavioral brief → macro source
   (brief construction per §"Constructing the behavioral brief"; the
    author's verify runs internally, with an auto-correction loop on misses)

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

**Every** pilot YAML written by this skill MUST be run through `scripts/capture-runner.ts` (or invoke `captureSnapshot` directly) before being considered complete. **No exceptions.** AI-only predictions are not a valid substitute — that's exactly what the reconciliation gate exists to prevent.

The skill's "complete" criterion now includes:

1. `reconciliation.predicted_matched_captured` is `true` or `false` (NEVER null)
2. `reconciliation.captured_at` is a real ISO timestamp (NEVER null)
3. `reconciliation.divergence_kind` is set (e.g., `clean_match`, `predicted_diverges_from_golden`, or a specific divergence-class label when triaged)
4. `golden_snapshot:` block is present with `captured_trace_kinds` and `captured_tool_calls` lists
5. `predicted_expect:` block is present (the AI's prediction, regardless of whether it matched)
6. `expect:` block is present (the source-of-truth assertion the runner compares against)
7. `intent:` field is present (verbatim natural-language description that drove generation)

After every batch of newly authored pilots, run **`scripts/validate-pilots.py`** as the final gate. It walks all pilot YAMLs under `cases/` and emits findings for any pilot missing a required field, any null reconciliation, any missing golden_snapshot when the reconciliation claims success. A clean validator run is the precondition for declaring a batch "done."

If the validator reports incomplete pilots, the skill MUST loop back: run the generic capture runner, apply the captures via `scripts/apply-captures.py`, re-validate. Do not declare done until validator is clean.

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

The agreement rate across the pilot corpus is a top-line metric of skill quality (see `eval-log.md` for the running stats).

## Verification gate

A successful pilot generation satisfies:

- The generated YAML exists under `cases/<category>/`.
- `npm run test:macro-framework` passes including the new test.
- `python3 tests/macro-framework/scripts/validate-pilots.py` reports the pilot valid.
- The new test's `generator.targeted_cells` enumerates the cells the user asked for, plus any incidental cells, and `covers:` lists every MTF-* cell the pilot contributes to.
- The new test's `generator.grounding_refs` cites REQ-NNN strings the synthesis was grounded in.
- The new test's `golden_version` matches the current `GOLDEN_VERSION` and `golden_run_at` is recent.
- The new test's `golden_snapshot.state_notes` is non-empty.

A successful refresh satisfies:

- All stale-version tests with structurally-identical captures have their `golden_version` bumped to the current.
- Tests with diverged captures are reported (not silently rewritten) so the operator can review.

## Related skills

- **flashquery-macro-covgen** — regenerate `MTF_COVERAGE.md` / `MTF_INTERACTIONS.md` after this skill produces new tests.
- **flashquery-macro-run** — execute the macro framework suite, classify failures, write triage records.
- **flashquery-directed-testgen** / **flashquery-integration-testgen** — sister testgen skills for the other test layers. Same shape (covgen + testgen + run triad); this one is specific to the macro framework.

## Principles

**The golden is the oracle.** Every embedded `expect:` block is derived from running the macro through the golden — never hand-crafted, never inferred. If you can't capture a snapshot, you can't generate a test.

**Provenance is metadata, not philosophy** (§5.5). Hand-authored, AI-generated, refreshed — all reviewable in PRs, all run the same way at test time. The `generator:` block exists so failure triage (per §5.8) can distinguish "the generator misread the spec" from "the engine regressed."

**Drift is explicit** (§5.6). Every test records `golden_version`. The refresh workflow makes drift a first-class operation — operator-gated by default; auto-bumped only for structurally-identical refreshes.

**Production constraints are real.** The synthesis MUST produce a macro the production engine can actually execute. If the language doesn't support a construct (bool literals, `continue`/`break`, `_self`), the test substitutes a production-compatible alternative or targets a different cell.

**The author is handed the tool surface — it never invents one.** Concrete `server.tool` names, archetypes, and return values are decided by the caller: the user (real end-user authoring against their own MCP servers) or this wrapper (test authoring, Step 3a). The author skill transcribes the names it is given; it does not discover or guess servers. This keeps it a pure obedient translator, and keeps the macro and the `tools:` block consistent by construction — both derive from one concrete surface.
