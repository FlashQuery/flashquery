# Port-back log

Changes proven in the workbench that need to land in production — **all staged LOCALLY
here, nothing applied to production source yet.** Production (`src/graph`) must stay
untouched so other processes can run against it; when the suite is green we push
everything (schema + prompt YAML + any logic) in ONE deliberate shot, then test there.

Where the staged changes live in the workbench:
- node schema deltas → `src/local-schemas.ts` (workbench parses against this, not prod)
- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file)
- relation vocabulary → `prompts/edge-types.yml` (local copy of the prod file)

| date | kind (prompt/logic) | what changed | production target | status |
| --- | --- | --- | --- | --- |
| 2026-06-25 | logic/schema | `analyzed_content_hash` was `z.string().min(1)`; the model can't compute a hash and returns `""`, which failed strict parse BEFORE `buildGraphNodeAnalysisRow`'s `\|\| fallbackContentHash` could apply. Relaxed to `z.string().default('')`. (Was briefly applied to src then reverted — now staged in local-schemas.ts.) | schemas.ts `GraphNodeAnalysisPayloadSchema` | STAGED local |
| 2026-06-25 | schema | Added optional `reasoning` field to the node payload so the model can do chain-of-thought INSIDE the JSON (strict schema requires declared keys; parser can't extract prose-then-JSON). Not persisted. | schemas.ts `GraphNodeAnalysisPayloadSchema` | STAGED local |
| 2026-06-25 | prompt | Node prompt: show the schema with per-field definitions; sharpen `staleness_risk` (hard deadline/version/dated decision ⇒ high, even before the date) and `certainty_level`; reasoning-first. Edge prompt: include relation vocabulary + per-edge reasoning-first. These live in the workbench `src/prompts.ts`; port the winning text into `node-analysis.ts`/`edge-analysis.ts` (or `graph-prompts.yml`). | node-analysis.ts / edge-analysis.ts / graph-prompts.yml | proposed (validated on granite4: 0/3 → node 9/10) |

| 2026-06-25 | prompt | `question_status` clarified: null UNLESS the chunk itself poses an unresolved question; don't invent questions. Fixed granite4 emitting "open" on definitional text. Clean win, no regression. | node-analysis.ts / graph-prompts.yml | proposed (validated) |

## Node assessment scorecard on granite4 (--inject-schema --reasoning)

- `certainty_level` (high / low): reliable.
- `question_status` (resolved / null after the fix): reliable.
- `key_claims`, `external_refs`, `temporal_markers`, `provenance_basis`: reliable.
- `staleness_risk` (3-way ordinal): unreliable on granite4 — under-rates high→medium
  and medium→low, and tightening one bucket regresses another (low→medium). This is an
  ordinal-calibration weakness of the model, not a missing prompt rule. Action: test on
  a stronger local model before further prompt tuning; consider whether 3 buckets is the
  right granularity.

| 2026-06-25 | workbench | Disable native thinking by default via OpenAI-compat `reasoning_effort: "none"` (Ollama maps it to the internal Think switch; ignored by plain models). gemma4 went from >44s timeout → 26s and scored the deprecation case 10/10. Reasoning *models* are slow and unlike the production path; our cheap `--reasoning` CoT lever is separate and still available. | workbench transport only | DONE (workbench) |
| 2026-06-25 | (not a bug) | `question_status` deferred vs resolved is an inherent judgment call, not a prompt defect — "decided to defer" is reasonably `resolved`. Resolution: the workbench accepts either via `question_status_in`; do NOT over-tune the prompt for this. | n/a (test tolerance) | resolved as ambiguous |
| 2026-06-25 | prompt | `provenance_basis` should be null when the chunk is self-contained; gemma4 cites "the provided text" as provenance. Clarify: provenance_basis names an EXTERNAL grounding source, else null — never "the text itself". | node prompt / graph-prompts.yml | proposed |

## Model robustness (node assessments, reasoning_effort=none, --inject-schema)

- **granite4** (weak/non-reasoning): reliable on key_claims, certainty high/low, question
  resolved/null, refs, temporal; **fails the staleness ordinal** (high→medium, medium→low).
- **gemma4** (stronger, thinking disabled): adds correct `staleness_risk: high` and
  `certainty_level: medium` — the buckets granite4 missed. Remaining misses are
  definition ambiguities (deferred, provenance-null), i.e. prompt wording, not capability.
- Takeaway: staleness/certainty gradation needs a capable model; the prompt itself is close.
  Run nemotron3:33b next to see if the definition-ambiguity misses also clear.

| 2026-06-25 | prompt/vocab | The supports→elaborates→extends gradient collapses upward (gemma4 called elaborates→supports, extends→elaborates). Adding a 3-line disambiguation block after the vocabulary fixed BOTH — all 10 relations then classify correctly (clean diagonal confusion matrix). Port the disambiguation into the `edge-types.yml` descriptions or the edge prompt. | edge-types.yml descriptions / edge-analysis.ts | proposed (validated on gemma4) |
| 2026-06-25 | prompt | `metadata.qualifiers.conditional`: solved. gemma4 now extracts the condition once the edge template (a) lists trigger words (when/if/only/...) and marks conditional REQUIRED, and (b) stresses each qualifier is an ARRAY not a bare string. Validated edge-supports-conditional 6/6. | prompts/graph-prompts.yml `classify_edge` | STAGED local |
| 2026-06-25 | prompt-tool | Few-shot: a format-only example embedded in the node template (neutral domain, "do not copy content") stabilized `external_refs` extraction (node-deprecation 9/10 → 10/10). Keep one-shot examples as a refinement lever for any wobbly field. | prompts/graph-prompts.yml | STAGED local |
| 2026-06-25 | prompt | `certainty_level` medium vs low: replaced the vague definition with content-independent cue-word criteria (medium = "likely/probably/strongly suggests/preliminary"; low = no basis/speculation/idea). Flipped node-certainty-medium low→medium with no test change — criteria, not hope. | prompts/graph-prompts.yml `analyze_node` | STAGED local |
| 2026-06-25 | prompt | `provenance_basis` = external-only wording ("name the external source; null when self-contained; never cite the text") — node-durable-no-refs 6/7 → 7/7 on gemma4. | prompts/graph-prompts.yml `analyze_node` | STAGED local |

| 2026-06-25 | prompt | `key_claims` extraction on LONG passages: model over-generated (~27 claims, empty strings, nested arrays → strict-parse failure) and under-captured (dropped the consequence half of compound facts). Fixed in the node template: key_claims must be a FLAT array of non-empty strings, consolidated to distinct facts (3-10), but must NOT drop consequences/deadlines/conditions/comparatives. Validated on long incident/policy/research passages (9/9). | prompts/graph-prompts.yml `analyze_node` → node-analysis.ts | STAGED local |

| 2026-06-25 | prompt | JSON well-formedness on number-dense passages: gemma4 emitted a stray empty-string element and let a later field bleed into an unclosed `key_claims` array. Node template now requires "exactly ONE well-formed JSON object: close every array/string, no empty-string element, no field bleeding into another's array." Fixed numeric-fidelity case 0→11/11. (Expected to be a non-issue on larger models; harmless to them.) | prompts/graph-prompts.yml `analyze_node` | STAGED local |

| 2026-06-25 | prompt | `key_claims` on enumerations: the model bundled "three steps: a, b, c" into one claim. Node template now says to SPLIT lists/enumerations into one claim per item. Model now splits correctly. (Judge `atomic` was also refined to flag list-bundling — workbench-only.) | prompts/graph-prompts.yml `analyze_node` | STAGED local |

| 2026-06-25 | prompt | Re-confirming the node ENUM suite after the NL prompt edits caught a regression: the now-denser `analyze_node` prompt crowded out `external_refs`, dropping "(see RFC-0042)" (consistently → []). Strengthened the field guidance ("extract EVERY cited identifier incl. parentheticals"). Node enum suite back to 8/8; edge suite unaffected (classify_edge unchanged). Lesson: shared-prompt additions can regress secondary fields — re-confirm the whole suite after edits. | prompts/graph-prompts.yml `analyze_node` | STAGED local |

| 2026-06-25 | finding (no change) | `metadata.low_confidence_flag` is NOT addable to `classify_edge` on gemma4: describing it regressed relation classification on the fuzzy pairs (supersedes/elaborates/duplicates flipped). Reverted. classify_edge is near gemma4's complexity ceiling — defer low_confidence_flag to a stronger model, or test whether a bigger model holds relations with it present. | classify_edge | DEFERRED (model ceiling) |
| 2026-06-25 | prompt | `external_refs` strengthened to catch parenthetical citations "(see RFC-0042)" — regressed under prompt crowding, now robust. | analyze_node | STAGED local |

## Consolidated `analyze_node` deltas to push (one shot)

All NL-driven node-prompt changes live in `prompts/graph-prompts.yml` and should land in
`analyze_node` together: (1) output exactly one well-formed JSON object; (2) key_claims is a flat
array of non-empty strings, consolidated (3-10) but without dropping consequences/conditions/
comparatives; (3) split enumerations into one claim per item; (4) field definitions for
certainty/staleness/question_status/provenance; (5) reasoning-first; (6) the format-only few-shot
example; plus the schema deltas in `src/local-schemas.ts` (optional `reasoning`, relaxed hash).

## Natural-language evaluation (no production change)

The LLM-as-judge for NL outputs (key_claims, chunk_summary, edge reasoning) is a **workbench
testing tool** — nothing to push to production. It validated that the refined extraction
prompts produce grounded/atomic/complete claims and faithful/concise summaries, and the judge
itself is calibrated with positive/negative controls. No new production deltas from this work.

## Full-suite status

2026-06-25: **23/23 cases pass on gemma4** (reasoning off) via the local refined prompts —
clean diagonal edge confusion matrix, all node indicators green. This is the candidate
state to push to production in one shot (prompts/*.yml → src/graph/defaults, local-schemas
deltas → schemas.ts, plus wiring node-analysis/edge-analysis to actually use the YAML).

## Edge results on gemma4 (reasoning_effort=none, --inject-schema --inject-vocabulary)

All 10 relation types classify correctly (confusion matrix is a clean diagonal) once the
disambiguation block is added. Confounders (tolerant), the negative/no-edge guard,
symmetric duplicates (both directions), `llm_assessment`, and confidence band all pass.
Only open edge axis: conditional qualifier extraction (above).

## Open calibration / model-robustness notes

- **staleness_risk on deadline-bound content.** With the sharpened definition,
  granite4's free-text `reasoning` reaches "high" ("the staleness risk is high until
  that date") but it still writes `medium` in the field — reasoning/output
  inconsistency. The prompt looks correct; this is now a model-capability gap. Re-test
  on a stronger local model before concluding the prompt needs more work. (Decide too
  whether the canonical definition itself should say high — confirm with Matt.)

## Candidates already visible from the as-wired prompts

- **Node prompt never shows the schema.** `node-analysis.ts` sends a one-line
  instruction and no `response_format`. Validate `--inject-schema` then port.
- **Edge prompt never shows the vocabulary.** `edge-analysis.ts` sends only
  `{ids, key_claims}`; the relation list lives unused in `graph-prompts.yml`.
  Validate `--inject-vocabulary` then port.
- **Runtime ignores `graph-prompts.yml`.** The YAML templates (with
  `{{graph:classified_types}}`) appear loaded but not used on the analysis path.
  Decide whether production should build messages from the YAML; the end-state of
  refinement here is a natural fit for that.
