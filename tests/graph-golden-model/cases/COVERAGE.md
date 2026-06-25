# Coverage matrix

**Objective:** verify that FlashQuery's graph logic and LLM prompts, *as implemented
today*, correctly produce every indicator and relationship the system relies on. Every
field the model emits should be testable here along every axis it can take, so we can
refine prompts (and fix TS/schema bugs) until they hold up — ideally on a weak model.

Legend: ✓ covered · ◻ gap · ⚠ covered but failing on the current model (a finding)

**Status (2026-06-25):** full suite **23/23 passing on gemma4** (thinking off) via the
local refined prompts — clean diagonal edge confusion matrix; all node indicators green.
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

End-to-end (extract → judge) cases: `nl-claims-deprecation`, `nl-summary-deprecation`. Each
makes 2 model calls (extract + judge), which exceeds the sandbox's 45s/call ceiling — run them
where there's no per-call limit (extraction quality alone is already green via the node cases).

NL TODO: add edge-`reasoning` judging cases; broaden claim/summary inputs (multi-topic,
adversarial, long).

## Framework gaps to close (so the axes above are assertable)

The case `expect:` schema + scorer (`src/cases.ts`, `src/score.ts`) currently can't assert
several axes. To finish the matrix we need to add expectations for:

- node: `chunk_summary_nonempty`, `provenance_basis` (null vs present),
  `question_resolution` (null vs present), `external_refs_empty`, `temporal_markers_empty`,
  `reasoning_present`.
- edge: `confidence_in_range`, `qualifiers_present` (which kind), `llm_assessment` value,
  per-edge claim-reference expectations, symmetric-direction checks (run A→B and B→A).
