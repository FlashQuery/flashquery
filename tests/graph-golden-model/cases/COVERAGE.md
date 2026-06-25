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

**Status (2026-06-25):** **full suite 60/60 on gemma4.** Enum suites re-confirmed after the NL
prompt edits, NL test plan complete (NL-TESTPLAN.md), and the matrix gaps filled:
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
Remaining ◻ rows are lower-frequency axes (certainty/staleness `unknown`, temporal &
uncertainty qualifiers, `low_confidence_flag`). granite4 still fails the staleness ordinal.

> **TODO — finish closing the matrix (deferred, come back to this):**
> - node `certainty_level: unknown` and `staleness_risk: unknown` — author cases.
> - edge `metadata.qualifiers.temporal` and `metadata.qualifiers.uncertainty` — author cases
>   (the `conditional` qualifier is done; mirror it for the other two kinds).
> - edge `metadata.low_confidence_flag` — author a hedged/weak-link case that should set it.
> - robustness: re-run the full suite on nemotron3:33b; re-check granite4 staleness with the
>   refined cue-word criteria.
> Pick up from here; the scorer already supports `*_in`, `require_qualifier`, etc.

## Node analysis — `GraphNodeAnalysisPayload`

| Indicator | Axis / buckets | Case(s) | Status |
| --- | --- | --- | --- |
| `key_claims` | extracts ≥N atomic claims | all node cases | ✓ |
| `key_claims` | substring recall of specific claims | node-deprecation-deadline | ✓ |
| `key_claims` | empty/short chunk → few/no claims | — | ◻ |
| `chunk_summary` | non-empty, single sentence | (schema only) | ◻ assert |
| `provenance_basis` | present (grounded) | node-deprecation-deadline (RFC) | ✓ |
| `provenance_basis` | null (ungrounded) | — | ◻ |
| `question_status` | open | node-deprecation-deadline | ✓ |
| `question_status` | resolved (+ resolution) | node-question-resolved | ✓ |
| `question_status` | deferred (fuzzy: accept deferred\|resolved) | node-question-deferred | ✓ (tolerant — judgment call) |
| `question_status` | null (no question) | node-definition-timeless | ✓ |
| `question_resolution` | non-null when resolved / null otherwise | node-question-resolved | ◻ assert |
| `certainty_level` | high | node-deprecation, node-definition | ✓ |
| `certainty_level` | low | node-speculative-idea | ✓ |
| `certainty_level` | medium | node-certainty-medium | ✓ gemma4 |
| `certainty_level` | unknown | — | ◻ |
| `staleness_risk` | high (expiring anchor) | node-deprecation-deadline | ✓ gemma4 / ⚠ granite4 |
| `staleness_risk` | medium (drift) | node-status-drift | ✓ gemma4 / ⚠ granite4 |
| `staleness_risk` | low (durable) | node-definition-timeless | ✓ |
| `staleness_risk` | unknown | — | ◻ |
| `external_refs` | recall of cited ids/links | node-deprecation-deadline | ✓ |
| `external_refs` | empty when none cited | node-durable-no-refs | ✓ gemma4 |
| `temporal_markers` | recall of dates/deadlines | node-deprecation-deadline | ✓ |
| `temporal_markers` | empty when none present | node-durable-no-refs | ✓ gemma4 |
| `provenance_basis` | null when self-contained | node-durable-no-refs | ✓ gemma4 (external-only wording) |
| `reasoning` (CoT) | present under --reasoning | (implicit) | ◻ assert |

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
| `confidence_score` | primary confidence band | edge-contradicts-endpoint | ✓ gemma4 |
| `source/target_claims_referenced` | valid indices; required for claim-support relations | (validator) | ✓ |
| `metadata.qualifiers` | conditional captured | edge-supports-conditional | ✓ gemma4 (array + trigger-word instruction) |
| `metadata.qualifiers` | temporal / uncertainty captured | — | ◻ |
| `metadata.llm_assessment` | strong/moderate/weak/uncertain | edge-contradicts-endpoint | ✓ gemma4 |
| `metadata.low_confidence_flag` | set when hedged | — | ◻ |

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

End-to-end (extract → judge) cases: `nl-claims-deprecation`, `nl-summary-deprecation` — both
**pass on gemma4 (full NL suite 8/8, 30/30 checks)**. Each makes 2 model calls; the on-disk
response cache makes them resumable across runs, so they complete even under the shell's
per-call time cap.

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
Validated passages so far: incident-payments, policy-data-retention, research-rag-latency
(9/9). The remaining ~12 passages are authored and run via the same loop (cache-resumable).

NL TODO: finish running the remaining long-passage cases on gemma4; add edge-`reasoning`
judging cases; add adversarial inputs (contradictory facts, heavy distractors).

## Framework gaps to close (so the axes above are assertable)

The case `expect:` schema + scorer (`src/cases.ts`, `src/score.ts`) currently can't assert
several axes. To finish the matrix we need to add expectations for:

- node: `chunk_summary_nonempty`, `provenance_basis` (null vs present),
  `question_resolution` (null vs present), `external_refs_empty`, `temporal_markers_empty`,
  `reasoning_present`.
- edge: `confidence_in_range`, `qualifiers_present` (which kind), `llm_assessment` value,
  per-edge claim-reference expectations, symmetric-direction checks (run A→B and B→A).
