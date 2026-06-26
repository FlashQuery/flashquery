# Port-back manifest

The single source of truth for **what to push to production**, applied in ONE deliberate, reviewed
change (see README §10.5; safety policy README §2). **PUSHED to `src/graph` on 2026-06-26** — all §1
deltas below are now in production (statuses = pushed); §2 remains deferred. The *reasoning* behind
each change is in README §9; this file is the actionable manifest.

Where each change was staged in the workbench before the push:
- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file) → pushed to `src/graph/defaults/graph-prompts.yml` + `FALLBACK_GRAPH_PROMPTS`
- relation descriptions → `prompts/edge-types.yml` → pushed to `src/graph/defaults/edge-types.yml` + `FALLBACK_GRAPH_RELATIONS`
- schema deltas → was `local-overrides/src/graph/schemas.ts` (now REMOVED) → pushed to `src/graph/schemas.ts`; the workbench imports the production schema again

## 1. Deltas to push

### 1.1 `analyze_node` prompt → production node-analysis path
| # | change | rationale (README) | status |
| --- | --- | --- | --- |
| 1 | Show the model the output schema + per-field definitions | §9.1 | pushed |
| 2 | `certainty_level` content-independent cue words (likely/probably/preliminary ⇒ medium; no basis ⇒ low) | §9.5 | pushed |
| 3 | `staleness_risk` buckets (expiring anchor ⇒ high even before the date; drifts ⇒ medium; durable ⇒ low) | §9.3, §9.5 | pushed |
| 4 | `question_status` = null unless the chunk itself poses a question | §9.5 | pushed |
| 5 | `provenance_basis` names an EXTERNAL source, else null (never "the text") | §9.5 | pushed |
| 6 | `key_claims` = flat array of non-empty strings, consolidated (3–10) but NOT dropping consequences/conditions/comparatives; split enumerations one-per-item | §9.3, §9.4 | pushed |
| 7 | Require exactly one well-formed JSON object (close arrays/strings; no empty element; no field bleed) | §9.2 | pushed |
| 8 | `external_refs` = extract every cited identifier, incl. parentheticals like "(see RFC-0042)" | §9.9 | pushed |
| 9 | Reasoning-first (`reasoning` field written before the others) | §3.6 | pushed |
| 10 | A format-only few-shot example (neutral domain) to stabilize wobbly fields | §9.9 | pushed |
| 16 | `chunk_summary` preserves key details/constraints/numbers/dates/deadlines/exceptions/risk and safety qualifiers, causal/attribution details, and other uniqueness-defining details | §9.9 | pushed |
| 17 | Free-form node strings are constrained: `reasoning` is 1-2 sentences, `provenance_basis` is a cited source ID/name or null, and `question_resolution` states the actual answer/decision with key conditions/deadlines | §9.9 | pushed |
| 19 | `certainty_level` scores confidence in extracted claims/source; unlabeled, unclear, or ambiguous source/data should not be marked high merely because uncertainty is explicitly stated | §9.5 | pushed |
| 20 | `provenance_basis`: (a) not mutually exclusive with `external_refs` — a grounding/ratifying source belongs in BOTH; (b) INTERNAL grounding sources count too (e.g. "our post-checkout surveys"); (c) a source that is merely the SUBJECT of a definitional claim ("X is defined in RFC Y") is NOT provenance (product decisions 2026-06-26) | §14.7, §14.8 | pushed |
| 21 | `question_status` one-shot examples + clarify a "question" can be a weighed decision without a literal "?" (fixed `deferred`/`resolved`), THEN narrowed `open` so tentativeness about a FACT (preliminary/likely/floated idea) maps to certainty_level, not `open` (full re-run caught the broadening over-flagging facts as open) | §14.7, §14.10 | pushed |
| 22 | `temporal_markers` expanded: enumerate sub-types (date/quarter/relative/deadline/**semantic version**) + a one-shot extraction example + copy-verbatim / do-not-infer guard (stress test found versions dropped) | §14.10 | pushed |
| 23 | `external_refs` expanded with a few-shot example + broadened scope (RFC/standard, named docs/datasets/surveys, product+version names, API paths, URLs, tickets) — "an external reference is an external reference" (stress test found `[]` / under-extraction) | §14.10 | pushed |
| 24 | `reasoning` format tightened: 1-2 sentences MAX, evidence-based (cite the cue driving certainty/staleness); it improves the downstream fields and is not itself judged | §14.10 | pushed |

### 1.2 `classify_edge` prompt → production edge-classification path
| # | change | rationale | status |
| --- | --- | --- | --- |
| 11 | Inject the relation vocabulary `{{graph:classified_types}}` into the prompt | §9.1 | pushed |
| 12 | `metadata.qualifiers` are arrays; list trigger words; `conditional` REQUIRED when present | §6.3 | pushed |
| — | **Keep `classify_edge` lean.** Do NOT add the `low_confidence_flag` instruction (see §2). | §9.6 | — |

### 1.3 `edge-types.yml` vocabulary descriptions
| # | change | rationale | status |
| --- | --- | --- | --- |
| 13 | Sharpen supports/elaborates/extends descriptions (evidence vs. detail vs. new claim) | §9.6 | pushed |

### 1.4 Schema/logic (`local-overrides/src/graph/schemas.ts` → `src/graph/schemas.ts`)
| # | change | rationale | status |
| --- | --- | --- | --- |
| 14 | `analyzed_content_hash`: `z.string().min(1)` → `z.string().default('')` (model can't compute it; fallbackContentHash supplies it post-parse) | §9.2 | pushed |
| 15 | Add optional, non-persisted `reasoning` field to the node payload | §3.6 | pushed |

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
- **Status: PUSHED 2026-06-26.** §1 deltas applied to `src/graph` in one change: prompts → defaults
  YAML + `FALLBACK_GRAPH_PROMPTS` (version 1→2); relations → defaults YAML + `FALLBACK_GRAPH_RELATIONS`;
  node schema → optional `reasoning` + `analyzed_content_hash` default `''`. `low_confidence_flag` (§2)
  excluded. `pending-edge-worker.test.ts` edge-prompt assertion updated to the new text.
- **Verification done here:** parity (T-U-076/T-U-052 invariant: packaged YAML deep-equals the in-code
  FALLBACK), prompt validation, schema parse (reasoning optional, hash default), and non-persistence
  (row builder drops `reasoning`) all confirmed via the production code under `tsx`.
- **Verification still owed (on a machine with the repo's native toolchain):** run the full graph
  unit + integration suite (`vitest`) and a golden-model run against a real instance to confirm no
  drift. The flashquery `vitest` could not run in the workbench sandbox (its `node_modules` carries
  macOS-native bindings; reinstalling for Linux would break the local setup) — so run `npm test` for
  the graph suites locally.
- **Deployment:** existing instances' `.fqc/graph-prompts.yml` / `.fqc/edge-types.yml` sidecars still
  need re-syncing separately (§1.5 deployment note).

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
