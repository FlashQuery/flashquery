# Port-back manifest

The single source of truth for **what to push to production**, to be applied in ONE deliberate,
reviewed change when the suite is green (see README §10.5; safety policy README §2). Nothing here
is applied to `src/graph` yet. The *reasoning* behind each change is in README §9 (referenced by
section); this file is the actionable manifest, not the narrative.

Where each change is staged in the workbench:
- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file)
- relation vocabulary/descriptions → `prompts/edge-types.yml` (local copy of the prod file)
- schema/logic deltas → `src/local-schemas.ts`

## 1. Deltas to push

### 1.1 `analyze_node` prompt → production node-analysis path
| # | change | rationale (README) | status |
| --- | --- | --- | --- |
| 1 | Show the model the output schema + per-field definitions | §9.1 | staged |
| 2 | `certainty_level` content-independent cue words (likely/probably/preliminary ⇒ medium; no basis ⇒ low) | §9.5 | staged |
| 3 | `staleness_risk` buckets (expiring anchor ⇒ high even before the date; drifts ⇒ medium; durable ⇒ low) | §9.3, §9.5 | staged |
| 4 | `question_status` = null unless the chunk itself poses a question | §9.5 | staged |
| 5 | `provenance_basis` names an EXTERNAL source, else null (never "the text") | §9.5 | staged |
| 6 | `key_claims` = flat array of non-empty strings, consolidated (3–10) but NOT dropping consequences/conditions/comparatives; split enumerations one-per-item | §9.3, §9.4 | staged |
| 7 | Require exactly one well-formed JSON object (close arrays/strings; no empty element; no field bleed) | §9.2 | staged |
| 8 | `external_refs` = extract every cited identifier, incl. parentheticals like "(see RFC-0042)" | §9.9 | staged |
| 9 | Reasoning-first (`reasoning` field written before the others) | §3.6 | staged |
| 10 | A format-only few-shot example (neutral domain) to stabilize wobbly fields | §9.9 | staged |

### 1.2 `classify_edge` prompt → production edge-classification path
| # | change | rationale | status |
| --- | --- | --- | --- |
| 11 | Inject the relation vocabulary `{{graph:classified_types}}` into the prompt | §9.1 | staged |
| 12 | `metadata.qualifiers` are arrays; list trigger words; `conditional` REQUIRED when present | §6.3 | staged |
| — | **Keep `classify_edge` lean.** Do NOT add the `low_confidence_flag` instruction (see §2). | §9.6 | — |

### 1.3 `edge-types.yml` vocabulary descriptions
| # | change | rationale | status |
| --- | --- | --- | --- |
| 13 | Sharpen supports/elaborates/extends descriptions (evidence vs. detail vs. new claim) | §9.6 | staged |

### 1.4 Schema/logic (`src/local-schemas.ts` → `src/graph/schemas.ts`)
| # | change | rationale | status |
| --- | --- | --- | --- |
| 14 | `analyzed_content_hash`: `z.string().min(1)` → `z.string().default('')` (model can't compute it; fallbackContentHash supplies it post-parse) | §9.2 | staged |
| 15 | Add optional, non-persisted `reasoning` field to the node payload | §3.6 | staged |

### 1.5 Wiring note (dev/arch)
Production `node-analysis.ts` / `edge-analysis.ts` currently build messages in code and do not use
`graph-prompts.yml` on the analysis path. The push must either wire production to render from the
YAML templates or port the refined template text into the code. This is an architecture decision
for the dev/arch agent.

## 2. Deferred (do NOT push)
- **`metadata.low_confidence_flag` in `classify_edge`.** It can be elicited, but describing it
  regressed relation classification on gemma4 (supersedes/elaborates/duplicates flipped) — the
  prompt is at the model's complexity ceiling (§9.6). Revisit on a stronger model, or via a separate
  pass, only if the product wants the signal (Open Question §12.4).

## 3. Not a production change
The LLM-as-judge and all judge-criteria/harness changes are **workbench testing tools** — nothing
to push. They validated extraction quality and are calibrated with positive/negative controls
(README §7, §9.7).

## 4. Status and procedure
- **Current:** full suite **60/60 on gemma4** (thinking off) via the local refined prompts; clean
  diagonal edge confusion matrix; node + NL all green (`cases/COVERAGE.md`).
- **Procedure:** apply §1 deltas to `src/graph` in one reviewed change, exclude §2, then run this
  suite against the real instance to confirm no drift (README §10.5).
