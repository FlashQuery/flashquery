# Port-back manifest

The single source of truth for **what to push to production**, to be applied in ONE deliberate,
reviewed change when the suite is green (see README §10.5; safety policy README §2). Nothing here
is applied to `src/graph` yet. The *reasoning* behind each change is in README §9 (referenced by
section); this file is the actionable manifest, not the narrative.

Where each change is staged in the workbench:
- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file)
- relation vocabulary/descriptions → `prompts/edge-types.yml` (local copy of the prod file)
- schema/logic deltas → `local-overrides/src/graph/schemas.ts`

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
| 16 | `chunk_summary` preserves key details/constraints/numbers/dates/deadlines/exceptions/risk and safety qualifiers, causal/attribution details, and other uniqueness-defining details | §9.9 | staged |
| 17 | Free-form node strings are constrained: `reasoning` is 1-2 sentences, `provenance_basis` is a cited source ID/name or null, and `question_resolution` states the actual answer/decision with key conditions/deadlines | §9.9 | staged |
| 19 | `certainty_level` scores confidence in extracted claims/source; unlabeled, unclear, or ambiguous source/data should not be marked high merely because uncertainty is explicitly stated | §9.5 | staged |

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

### 1.4 Schema/logic (`local-overrides/src/graph/schemas.ts` → `src/graph/schemas.ts`)
| # | change | rationale | status |
| --- | --- | --- | --- |
| 14 | `analyzed_content_hash`: `z.string().min(1)` → `z.string().default('')` (model can't compute it; fallbackContentHash supplies it post-parse) | §9.2 | staged |
| 15 | Add optional, non-persisted `reasoning` field to the node payload | §3.6 | staged |

### 1.5 Production file map — exact files to touch
Verified against `src/graph` (2026-06-25). Production already renders prompts from config
(`src/graph/prompt-renderer.ts` injects variables and `{{graph:classified_types}}`; `node-analysis.ts`
/ `edge-analysis.ts` call `renderGraphPrompt(...)`), so **no wiring change is needed** — only content.

Default resolution (`src/config/loader.ts` ~L1124-1133): an instance loads `graph.prompts`
(default `.fqc/graph-prompts.yml`) and `graph.relations` (default `.fqc/edge-types.yml`); if the file
is absent the loader falls back to the **in-code defaults**. The packaged `src/graph/defaults/*.yml`
are the shipped "source of truth" sidecars, and **parity tests assert the packaged YAML equals the
in-code fallback** (`graph-prompts.test.ts` T-U-076; `graph-vocabulary.test.ts` T-U-052) — so each
pair MUST be edited together.

| Delta (from §1.1–§1.4) | Edit BOTH (kept in parity) | Notes |
| --- | --- | --- |
| analyze_node + classify_edge prompt text | `src/graph/prompts.ts` → `FALLBACK_GRAPH_PROMPTS` **and** `src/graph/defaults/graph-prompts.yml` | templates use `{{chunk_content}}` / `{{source_chunk}}` / `{{target_chunk}}` / `{{graph:classified_types}}`; keep `required_variables` accurate |
| edge relation descriptions | `src/graph/vocabulary.ts` → `FALLBACK_GRAPH_RELATIONS` **and** `src/graph/defaults/edge-types.yml` | descriptions are injected via `renderClassifiedGraphTypes`; relation NAMES unchanged |
| node schema (`analyzed_content_hash` default(''), optional `reasoning`) | `src/graph/schemas.ts` → `GraphNodeAnalysisPayloadSchema` | `node-analysis.ts` already applies `|| fallbackContentHash`; `reasoning` is not persisted (no row change) |

Tests that will need updating as part of the push (they assert defaults/schema):
`tests/unit/graph-prompts.test.ts`, `tests/unit/graph-vocabulary.test.ts`,
`tests/unit/graph-llm-analysis.test.ts`, `tests/unit/graph-pending-worker.test.ts`,
`tests/integration/graph/graph-schema.test.ts`, `tests/integration/graph/pending-edge-worker.test.ts`.

Deployment note (not a source edit): existing instances carry their own `.fqc/graph-prompts.yml` /
`.fqc/edge-types.yml`; those copies need re-syncing/migration separately from the source push.
Config knobs that interact (no change): `graph.prompts`, `graph.relations`, `graph.promptOverrides`.

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

## 5. Alignment with production (keeping pushes straightforward)
Assessment (verified 2026-06-25): the workbench is already well aligned for a near-copy push.
- `prompts/graph-prompts.yml` and `prompts/edge-types.yml` are **structurally identical** to the
  production `src/graph/defaults/*.yml` — same prompt ids, same variable tokens
  (`{{chunk_content}}`/`{{source_chunk}}`/`{{target_chunk}}`/`{{graph:classified_types}}`), same
  `required_variables`/relation schema. Only the template *text* and relation *descriptions* differ
  (our refinements). Production already renders from these via `prompt-renderer.ts`, so pushing them
  is effectively a content copy.
- **The only real friction** is (a) the in-code `FALLBACK_*` duplicates of those YAML files
  (`prompts.ts`, `vocabulary.ts`) that parity tests (T-U-076, T-U-052) require to match, and (b) the
  2-line node-schema edit in `schemas.ts` (a targeted edit, NOT a whole-file copy — `schemas.ts`
  holds the edge schemas/enums too).

Short-term steps to keep future pushes a copy, not a hand-edit:
1. **Keep the YAML drop-in.** Don't let `prompts/*.yml` structure (ids/variables/required_variables)
   drift from production defaults — only the text. Before a push, `diff` workbench `prompts/*.yml`
   against `src/graph/defaults/*.yml` to (a) see exactly our deltas and (b) catch upstream drift;
   rebase our copies onto current production defaults if production moved. Bump the prompt `version`.
2. **Push = copy YAML text into BOTH the packaged default and the in-code `FALLBACK_*`** (parity).
   Optionally add a small codegen helper that emits the `FALLBACK_*` TS literal from the YAML so this
   step isn't hand-written.
3. **Keep `local-overrides/src/graph/schemas.ts` a faithful mirror of the prod node schema** so the schema delta is a
   trivial, obvious targeted edit.

### 5.1 Resolution strategy — production-first, local-override (decided)
Preferred approach for ALL production source the workbench depends on (TS logic *and* config):
**use the real production file by default; create a local override only when our testing requires a
change; the runner prefers the local override if present, else falls back to production.** This
- keeps us on the real production code most of the time (max fidelity, no stale duplication), and
- lets us stage a fix locally the moment testing finds a bug, then push it later (safety policy §2) —
  without ever editing production mid-stream.

Rationale (Matt): the alternative "make production source its defaults from the YAML" refactor is
only safe if we're confident our testing won't surface bugs in those files; if it does, we'd be
forced to correct production directly. The override-first pattern avoids that: production stays the
default, local copies are the exception we control. **So the YAML-source production refactor is
deprioritized** (optional, dev/arch) in favor of override-first.

Current state vs. the pattern: the workbench already imports most production TS directly
(json-repair corrector, edge validation, vocabulary/prompt loaders) — that's production-first. The
one active override today is the node schema (`local-overrides/src/graph/schemas.ts`), which exists only because we
have a staged schema change. Prompts/vocabulary are local YAML copies we actively refine.

Implementation options for the local-first resolver (pick when ready):
- **Lightweight (now):** keep direct imports; place any overridden TS under a `local-overrides/`
  dir that mirrors the production export names (a true drop-in), and document the convention. Good
  while there is ~one override.
- **Generic resolver (when a 2nd override appears or we want to toggle without code edits):** a
  small `resolveGraphSource(name)` that dynamic-imports `local-overrides/<name>.ts` if it exists
  else `src/graph/<name>.js`. Requires overrides to export the same symbol names as production.

Either way, every active override is listed in §1.5 as a push target and removed after the push.
