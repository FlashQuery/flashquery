# Coverage matrix

**Objective:** verify that FlashQuery's graph logic and LLM prompts, *as implemented
today*, correctly produce every indicator and relationship the system relies on. Every
field the model emits should be testable here along every axis it can take, so we can
refine prompts (and fix TS/schema bugs) until they hold up — ideally on a weak model.

Legend: ✓ covered · ◻ gap · ⚠ covered but failing on the current model (a finding) · ◐ partial

## How to maintain this document (read before editing)

This matrix is the **source of truth for what is tested and how it currently behaves**. Keep it
current as you work:

1. **After every run, update the affected rows.** Set the status (✓ / ◻ / ⚠ / ◐), name the case
   file, and tag the model (e.g. "✓ gemma4"). A row without a case file is a gap (◻).
2. **Every new case adds (or updates) a row.** If you author a test for an axis, reflect it here in
   the same change — don't let cases and this matrix drift apart.
3. **Keep the Status banner current**: date, model, pass count (e.g. "60/60 on gemma4"), and any new
   findings. This is the first thing a reader (human or agent) checks.
4. **Record findings, not just pass/fail.** When the model behaves notably (e.g. commits to a bucket,
   conflates a fuzzy pair), write it in the relevant row and, if durable, in `NL-TESTPLAN.md`'s
   learnings log and/or `PORT_BACK.md`.
5. **Mark model-ceiling items honestly.** If an axis only passes with a prompt change that regresses
   something else (see `low_confidence_flag`), record it as ⚠/DEFERRED with the trade-off, not as ✓.
6. **Re-run before claiming green after shared-prompt edits.** `analyze_node` and `classify_edge` are
   shared; a change for one axis can regress another. Re-confirm the whole node/edge suite and update
   rows accordingly.

Use `npx tsx src/aggregate.ts --model <m>` to get the current pass counts + confusion matrix to
transcribe into the Status banner and rows.

**Status (2026-06-25):** node suite **13/13, 82/82** and edge suite **19/19, 68/68** on
gemma4 after the latest free-form-string prompt edits. Targeted NL summary regressions were
re-confirmed green after the `chunk_summary` specificity refinements; full NL re-run remains the
next broad confirmation step. Earlier enum/NL suites were re-confirmed after the NL prompt edits,
NL test plan complete (NL-TESTPLAN.md), and the matrix gaps filled:
- certainty/staleness `unknown`: gemma4 COMMITS to a definite bucket — it effectively never emits
  "unknown" (cases accept the committed value; documented as a model behavior, not a harness gap).
- qualifiers `temporal` & `uncertainty`: ✓ recorded (edge-temporal-qualifier, edge-uncertainty-qualifier).
- `low_confidence_flag`: ⚠ DEFERRED — it CAN be elicited, but describing it in `classify_edge`
  pushed gemma4 past its complexity ceiling and regressed relation accuracy (supersedes/elaborates/
  duplicates flipped). Reverted; defer to a stronger model. **Key finding: the classify_edge prompt
  is near gemma4's ceiling — each added instruction trades against relation accuracy.**
- `question_resolution` (null & present) and `reasoning` present: ✓ asserted on existing node cases.

Two regressions were caught and fixed during the re-confirm — proof the suite guards against
prompt drift: `external_refs` dropped when the node prompt got dense (strengthened its guidance);
`elaborates/supersedes/duplicates` flipped when classify_edge got dense (reverted the additions;
made the elaborates/supersedes example passages cleaner). Judge refinements this round (all
workbench-only): `complete` (ignore fluff, re-read before failing), `atomic` (list = non-atomic),
`grounded` (faithful reformat/omission is OK), reasoning uses `consistent`+softened `justifies`.

The lower-frequency axes are now covered: certainty/staleness `unknown` (◐ — model commits, §12.1),
temporal & uncertainty qualifiers (✓), `low_confidence_flag` (⚠ DEFERRED, §12.4). granite4 still
fails the staleness ordinal (model capability, README §9.8). The only ◻ row left is the minor
empty/short chunk `key_claims` case — see the table footnotes.

> **TODO — remaining (the matrix axes are now covered; these are robustness/breadth):**
> - Robustness: run the full suite on `nemotron3:33b`; re-check granite4 staleness with the refined
>   cue-word criteria; decide the production target model.
> - Revisit `low_confidence_flag` (§12.4) on a stronger model or via a separate pass.
> - Breadth: more edge-`reasoning` judging cases; adversarial NL inputs (contradictions, heavy
>   distractors); minor node gap (empty-chunk `key_claims`).
> - Resolve the product Open Questions in README §12 (they gate some "tolerant"/◐ rows).

## Node analysis — `GraphNodeAnalysisPayload`

| Indicator | Axis / buckets | Case(s) | Status |
| --- | --- | --- | --- |
| `key_claims` | extracts ≥N atomic claims | all node cases | ✓ |
| `key_claims` | substring recall of specific claims | node-deprecation-deadline | ✓ |
| `key_claims` | empty/short chunk → few/no claims | — | ◻ |
| `chunk_summary` | non-empty, single sentence | node-provenance-specific, node-question-resolution-specific | ✓ gemma4 |
| `provenance_basis` | present (grounded) | node-deprecation-deadline (RFC) | ✓ |
| `provenance_basis` | specific cited source identifier/name | node-provenance-specific, node-reasoning-brief | ✓ gemma4 |
| `provenance_basis` | null (self-contained) | node-durable-no-refs | ✓ gemma4 |
| `question_status` | open | node-deprecation-deadline | ✓ |
| `question_status` | resolved (+ resolution) | node-question-resolved | ✓ |
| `question_status` | deferred (fuzzy: accept deferred\|resolved) | node-question-deferred | ✓ (tolerant — judgment call) |
| `question_status` | null (no question) | node-definition-timeless | ✓ |
| `question_resolution` | non-null when resolved / null otherwise | node-question-resolved, node-deprecation-deadline | ✓ |
| `question_resolution` | resolved text includes chosen answer and key condition/deadline | node-question-resolution-specific | ✓ gemma4 |
| `certainty_level` | high | node-deprecation, node-definition | ✓ |
| `certainty_level` | low | node-speculative-idea | ✓ |
| `certainty_level` | medium | node-certainty-medium | ✓ gemma4 |
| `certainty_level` | unknown | node-certainty-unknown | ◐ gemma4 commits to a definite bucket (low); never emits "unknown" — see §12.1 |
| `staleness_risk` | high (expiring anchor) | node-deprecation-deadline | ✓ gemma4 / ⚠ granite4 |
| `staleness_risk` | medium (drift) | node-status-drift | ✓ gemma4 / ⚠ granite4 |
| `staleness_risk` | low (durable) | node-definition-timeless | ✓ |
| `staleness_risk` | unknown | node-staleness-unknown | ◐ gemma4 commits to a definite bucket; never emits "unknown" — see §12.1, §12.6 |
| `external_refs` | recall of cited ids/links | node-deprecation-deadline | ✓ |
| `external_refs` | empty when none cited | node-durable-no-refs | ✓ gemma4 |
| `temporal_markers` | recall of dates/deadlines | node-deprecation-deadline | ✓ |
| `temporal_markers` | empty when none present | node-durable-no-refs | ✓ gemma4 |
| `provenance_basis` | null when self-contained | node-durable-no-refs | ✓ gemma4 (external-only wording) |
| `reasoning` (CoT) | present (reasoning-first, baked into the node prompt) | node-deprecation-deadline | ✓ gemma4 |
| `reasoning` (CoT) | brief 1-2 sentences | node-reasoning-brief | ✓ gemma4 |

## Edge classification — `GraphEdgeClassificationPayload`

| Indicator | Axis | Case(s) | Status |
| --- | --- | --- | --- |
| `relation` | supports | edge-supports | ✓ gemma4 |
| `relation` | contradicts | edge-contradicts-endpoint | ✓ |
| `relation` | supersedes | edge-supersedes | ✓ gemma4 |
| `relation` | duplicates | edge-duplicates | ✓ gemma4 |
| `relation` | depends_on | edge-depends_on | ✓ gemma4 |
| `relation` | elaborates | edge-elaborates | ✓ gemma4 (needs disambiguation block) |
| `relation` | summarizes (requires_claim_support: false) | edge-summarizes | ✓ gemma4 |
| `relation` | rationale_for | edge-rationale_for | ✓ gemma4 |
| `relation` | extends | edge-extends | ✓ gemma4 (needs disambiguation block) |
| `relation` | resolves | edge-resolves | ✓ gemma4 |
| (no relation) | unrelated pair → 0 edges | edge-unrelated-billing-theme | ✓ |
| confounders | supports vs elaborates; duplicates vs summarizes | edge-confounder-* | ✓ (tolerant) |
| directionality | symmetric relation both directions | edge-duplicates(+reverse) | ✓ gemma4 |
| `reasoning` | non-empty per edge | (validator) | ✓ |
| `reasoning` | brief 1-2 sentences | edge-reasoning-supports | ✓ gemma4 (asserted without adding edge-prompt complexity) |
| `confidence_score` | primary confidence band | edge-contradicts-endpoint | ✓ gemma4 |
| `source/target_claims_referenced` | valid indices; required for claim-support relations | (validator) | ✓ |
| `metadata.qualifiers` | conditional captured | edge-supports-conditional | ✓ gemma4 (array + trigger-word instruction) |
| `metadata.qualifiers` | temporal captured | edge-temporal-qualifier | ✓ gemma4 |
| `metadata.qualifiers` | uncertainty captured | edge-uncertainty-qualifier | ✓ gemma4 |
| `metadata.llm_assessment` | strong/moderate/weak/uncertain | edge-contradicts-endpoint | ✓ gemma4 |
| `metadata.low_confidence_flag` | set when hedged | edge-low-confidence | ⚠ DEFERRED — describing it in classify_edge regresses relations (§9.6); see §12.4 |

## Natural-language extraction (LLM-as-judge)

Enum/category axes have exact answers; natural-language outputs do not. The LLM-generated
NL outputs are `key_claims` and `chunk_summary` (node) and edge `reasoning`. (Community and
document "summaries" are **algorithmic** today — `communities.ts` / `document-summary.ts` —
so there is no LLM NL to judge there.)

We evaluate NL with an **LLM judge** (gemma4): feed the source text + the extracted output +
a rubric of content-independent criteria, get a per-criterion pass/fail verdict. The judge is
a TESTING tool, not a production prompt. Criteria library: `grounded`, `atomic`, `complete`,
`faithful`, `representative`, `concise`, plus per-fact `captures: <fact>`.

**The judge is itself validated** via `given`-mode calibration cases (feed known-good and
known-bad output, assert the verdict). All passing on gemma4:

| criterion | positive control (→ pass) | negative control (→ fail) |
| --- | --- | --- |
| grounded | nl-judge-grounded-atomic-complete-good | nl-judge-hallucination |
| atomic | ↑ (same positive) | nl-judge-nonatomic |
| complete | ↑ (same positive) | nl-judge-incomplete |
| representative + concise | nl-judge-summary-good | nl-judge-summary-verbose |

(The calibration even caught an over-stating summary I wrote — proof the judge is appropriately
strict, not rubber-stamping.)

End-to-end (extract → judge) cases pass on gemma4 (part of the full 60/60). Each makes 2 model
calls; the on-disk response cache makes them resumable across runs, so they complete even under the
shell's per-call time cap.

**Longer-passage NL cases (15 passages × claims+summary = 30 cases, `nl-claims-*` /
`nl-summary-*`).** Stress extraction completeness on multi-fact prose across domains
(incident, ADR, release notes, research, policy, spec, meeting, SLA, security, migration,
API changelog, org, pricing, feature flags, cache research). Findings from the first runs,
each fixed via the loop:
- long input made the model over-generate `key_claims` (empty strings / nested arrays →
  strict-parse failure) → flat/consolidated constraint added to the node template.
- the model under-captured (dropped the consequence half of compound facts) → completeness
  nudge added; validated incident/policy/research at 9/9.
- the judge over-split comparatives as non-atomic → `atomic` criterion sharpened (a single
  comparison or fact+consequence is one fact); non-atomic negative control still fails.
- lesson: `must_capture` facts must themselves be atomic, or they conflict with the atomic
  criterion (fixed the one bundled must_capture).
- JSON well-formedness on number-dense passages → "exactly one well-formed JSON object" instruction.
All 15 long passages (claims + summary) now pass on gemma4 as part of the full 60/60.

NL TODO: add edge-`reasoning` judging breadth; adversarial inputs (contradictory facts, heavy
distractors); a cross-output consistency negative beyond the current one.

## Framework capabilities (implemented)

The case `expect:` schema + scorer (`src/cases.ts`, `src/score.ts`) now support all the axes the
matrix needs:

- node: `chunk_summary_nonempty`, `chunk_summary_max_sentences`, `provenance_present`,
  `provenance_basis`, `provenance_basis_contains`, `question_resolution_present`,
  `question_resolution_contains`, `external_refs_empty`, `temporal_markers_empty`,
  `reasoning_present`, `reasoning_max_sentences`, and `*_in` tolerances for
  certainty/staleness/question_status.
- edge: `confidence_min`, `require_qualifier` (temporal|conditional|uncertainty),
  `require_low_confidence_flag`, `llm_assessment_in`, `primary_relation_in`, `judge_reasoning`,
  `reasoning_max_sentences`; symmetric direction is exercised by paired cases (A→B and B→A).
- nl: `criteria`, `must_capture`, `given`/`expect_fail` (judge calibration), `against` (cross-output
  consistency), `min_claims`/`max_claims`.

Minor scorer features not yet added (low priority): an explicit per-edge claim-reference assertion
(claim-index bounds are already enforced by the real validator) and a confidence *range* (only a
floor, `confidence_min`, exists today).
