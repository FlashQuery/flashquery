# FlashQuery Graph Golden-Model — Workbench Design & Operations

A prompt-refinement workbench for FlashQuery's graph intelligence. It runs hand-written YAML
test cases through the **real** graph extraction logic (schemas, vocabulary, validation imported
straight from `src/graph`) against one or more OpenAI-compatible models (local Ollama by default),
scores the model's output against expectations, and writes a detailed report used to refine the
prompts — proven on a weak local model first so that stronger/commercial models clear the bar.

This document is numbered for self-reference (e.g. "see §9.6") and is intended to be the
research/design record that feeds a later **requirements documentation step** for the AI dev/arch
agent. Supporting docs: `cases/README.md` (authoring rules), `cases/COVERAGE.md` (the live
coverage matrix), `cases/NL-TESTPLAN.md` (natural-language plan + learnings log), `PORT_BACK.md`
(the production push manifest). See §13 for all references.

---

## 1. Purpose and scope

### 1.1 What this is
A standalone TypeScript harness (run with `tsx`, no build step) that feeds contrived YAML "cases"
to a model and scores the result. It imports the real FlashQuery graph logic (JSON repair, edge
validation, vocabulary/prompt loaders, Zod schemas) so it exercises production behavior, but it
sources the *prompts and schema* from editable local copies so refinement never touches production
(§2, §3).

### 1.2 What it is not
It is **not** a CI gate and not a correctness proof of the graph feature. It is an iteration loop
for getting the prompts (and any logic/schema fixes) to reliably produce the categorizations,
relationships, and indicators the graph relies on.

### 1.3 Relationship to production and the requirements step
Refinements are staged locally and pushed to production in one deliberate, reviewed change (§10.5).
The findings in §9 and the open questions in §12 are the inputs to the requirements step; product
decisions (§12) are for the user, architecture/implementation decisions are for the dev/arch agent.

### 1.4 Prior art
Modeled on the existing `tests/macro-framework/macro-golden-model` "executable spec" pattern: a
standalone harness that exercises real source behavior against a model without being wired into a
live instance.

---

## 2. Production-safety policy (non-negotiable)

**Do NOT modify `src/graph` (production) during refinement.** Other processes run against
production source and cannot tolerate uncontrolled graph changes. Every proposed change is staged
locally:

- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file)
- relation vocabulary/descriptions → `prompts/edge-types.yml` (local copy of the prod file)
- schema/logic deltas → `local-overrides/src/graph/schemas.ts` (the workbench parses against this)

The workbench imports the real *unchanged* helpers (the json-repair corrector, edge validation, the
YAML loaders) but sources prompts/schema from the local copies above. When the suite is green, push
everything to production in ONE deliberate shot, then test there (§10.5). `PORT_BACK.md` is the
manifest of what to push.

---

## 3. Architecture and design

### 3.1 Design thesis — real logic, local prompts
The two requirements in tension are *fidelity* (test what production actually does) and *safety*
(don't change production while iterating). The resolution: import the real parsing/validation/
vocabulary code from `src/graph`, but render the prompts from local YAML and parse against a local
schema copy. This means a discovered bug is a real bug, while every fix is contained until the
deliberate push.

### 3.2 The two LLM operations under test
- **Node analysis** (`analyze_node`) — for one chunk, extracts `key_claims`, `chunk_summary`,
  `provenance_basis`, `question_status`, `question_resolution`, `certainty_level`, `staleness_risk`,
  `external_refs`, `temporal_markers` (and a non-persisted `reasoning` field, §3.6).
- **Edge classification** (`classify_edge`) — for a source/target pair, types the relationship into
  the 10 classified relations with `reasoning`, `confidence_score`, claim references, and `metadata`
  (`llm_assessment`, `qualifiers` temporal/conditional/uncertainty, `low_confidence_flag`).

### 3.3 Imported real vs staged local
| Concern | Source | Why |
| --- | --- | --- |
| JSON repair + Zod parse | real (`src/llm/json-repair.ts`) | the actual corrector that runs in prod |
| edge validation | real (`src/graph/edge-validation.ts`) | real structural/relation rules |
| prompt + vocab loaders | real (`src/graph/prompts.ts`, `vocabulary.ts`) | real rendering of `{{graph:classified_types}}` |
| prompt templates | local (`prompts/graph-prompts.yml`) | the refinement surface |
| relation vocabulary | local (`prompts/edge-types.yml`) | descriptions are injected; sharpening them is a lever |
| node schema deltas | local (`local-overrides/src/graph/schemas.ts`) | proposed schema changes, parsed via the real corrector |
| transport | local thin client | mirrors the prod request shape; adds cache/mock |

### 3.4 Response cache and resumability
Model responses are cached on disk (`.cache/`, gitignored), keyed by a hash of the exact request
(model + params + messages). Rationale: a multi-call case (e.g. an `nl` case = extract **then**
judge) can exceed a single shell/run window; the cache lets an interrupted run resume — completed
calls replay instantly, only unfinished calls hit the model. Editing a prompt changes the hash and
correctly forces a re-run. It also speeds iteration. Disable with `--no-cache`; wipe with
`--clear-cache`.

### 3.5 Offline mock
`--mock` returns canned, schema-valid responses so the parse/score/report pipeline can be exercised
with no model server (`npm run selftest`). It is wiring-only — negative controls intentionally
diverge under mock.

### 3.6 The non-persisted `reasoning` field
The node schema (`local-overrides/src/graph/schemas.ts`) adds an optional `reasoning` field so the model can do
chain-of-thought *inside* the JSON (the corrector cannot extract prose-then-JSON). It improves
judgment fields and is not stored. This is distinct from a "reasoning model" (§8).

### 3.7 Resolution policy — production-first, local-override
For any production source the workbench depends on (TS logic and config), the rule is: **use the
real production file by default; create a local override only when our testing requires a change;
prefer the local override if present, else fall back to production.** This keeps us on real
production code for maximum fidelity, avoids stale duplicates, and still lets us stage a fix locally
the instant testing finds a bug — then push it back (§10.5) without ever editing production
mid-stream (§2). Today the only active TS override is the node schema (`local-overrides/src/graph/schemas.ts`),
present only because we have a staged schema change; prompts/vocabulary are local YAML copies we
actively refine. Rationale and implementation options are in `PORT_BACK.md` §5.1; the (now
deprioritized) alternative of making production source its defaults from the YAML is noted there.

---

## 4. Folder structure

```
prompts/
  graph-prompts.yml   EDITABLE local copy of prod prompts: analyze_node + classify_edge templates.
  edge-types.yml      EDITABLE local copy of the relation vocabulary (descriptions are injected).
cases/
  *.yml               the tests. Filename prefix encodes kind: node-*, edge-*, nl-*.
  README.md           how to author cases + the test-design discipline.
  COVERAGE.md         indicator × axis matrix + per-model status (it documents how to maintain itself).
  NL-TESTPLAN.md      the natural-language test plan + a dated learnings log.
src/
  run.ts              CLI entry (§5.2).
  config.ts           resolves settings from .env / flags.
  llm-client.ts       OpenAI-compat transport + response cache + offline mock.
  prompts.ts          renders messages FROM prompts/*.yml via the real loaders.
  node-op.ts edge-op.ts nl-op.ts   run one node/edge/NL op (call model + parse with REAL parsers).
  judge.ts            LLM-as-judge: criteria library + judge prompt + verdict schema.
  cases.ts            loads + types the YAML cases.
  score.ts            scorers (node / edge / nl) → pass/fail checks.
  report.ts           writes results/<timestamp>/report.{json,md} + console + confusion matrix.
  aggregate.ts        stitches batched runs into one scorecard + matrix (ignores mock runs).
  probe.ts            send a freeform prompt to the model (investigation only — never source answers from it).
  local-schemas.ts    DEPRECATED shim → re-exports the override below (safe to delete).
local-overrides/      production source overrides; mirror the prod path. See local-overrides/README.md.
  src/graph/schemas.ts  the one active override — staged node-schema deltas (production export names).
results/              generated reports (gitignored).
.cache/               response cache (gitignored).
.env / .env.example   GRAPH_GOLDEN_BASE_URL + GRAPH_GOLDEN_MODEL.
PORT_BACK.md          manifest of every local change to push to production in one shot.
```

---

## 5. Running the workbench

### 5.1 Setup and configuration
```
npm install
cp .env.example .env     # then set the two things that matter:
#   GRAPH_GOLDEN_BASE_URL=http://192.168.15.12:11434/v1   # OpenAI-compat base
#   GRAPH_GOLDEN_MODEL=gemma4:latest                      # default model (comma-separate for several)
```
The local Ollama box serves several models (e.g. `granite4`, `gemma4:latest`, `nemotron3:33b`).
Both base URL and model are overridable per run (§5.2).

### 5.2 Modes and flags
First positional arg = mode: `node` | `edge` | `nl` | `record` | `all` (default `all`).
```
npm run all | node | edge | nl | record
npm run selftest                                   # offline mock; wiring check only
npx tsx src/run.ts edge --only "edge-supports,edge-contradicts" --model granite4
npx tsx src/run.ts record --model gemma4:latest --judge-model gemma4:latest
```
Flags: `--model a,b` (the GRAPH model(s) under test — one or several), `--judge-model <m>` (the model
used for LLM-as-judge; default = the graph model), `--base-url`, `--api-key`, `--only
<substr[,substr...]>`, `--temperature`, `--baseline` (use unmodified prod prompts for A/B),
`--reasoning-effort <none|low|medium|high>` (default `none`, §8), `--extra-body '<json>'`,
`--no-cache`, `--clear-cache`, `--mock`.

**Graph vs judge model.** Extraction/classification always uses the graph model; the judge uses
`--judge-model` (or `GRAPH_GOLDEN_JUDGE_MODEL`) when set, else the same graph model. This holds across
all kinds (`nl`, `edge` reasoning-judging, and `record`), so you can vary the model under test while
holding the judge fixed, or vice-versa. A `record` case may also override both per case (`model:` /
`judge_model:`).

### 5.3 Resumability, batching, and the NL cost model
Because of §3.4, slow suites are run in batches (e.g. `--only "edge-a,edge-b"`) or simply re-run —
each invocation advances the cache. The runner prints **live per-case progress**
(`[i/N] kind name … PASS/FAIL`) so a long run never looks hung.

Cost model for the NL suite (so the wall-clock is not surprising): a `kind: nl` case with `given`
is **1 model call** (judge only); an extracted `nl` case is **2 calls** (`analyze_node` then judge).
So the full NL set is ~2× its case count in calls (≈100 for ~57 cases). On the local gemma4,
the judge call is fast (~9s) but `analyze_node` is slow (~30–45s) — not because of thinking (that's
off, §8) but because it generates a large payload (reasoning paragraph + ~10 fields + claims). A
full *uncached* NL run is therefore tens of minutes. Practical guidance: rely on the cache (run
again to resume; completed calls replay instantly), run NL in `--only` batches, and watch the live
progress. Calls are sequential by design — the local server is not set up for concurrency.

### 5.4 Aggregation
`npx tsx src/aggregate.ts --model <m>` stitches the latest result per case across all (non-mock)
reports into one scorecard + edge confusion matrix. Use it to get the numbers for `COVERAGE.md`.

### 5.4a Session failure ledger (aggregate failure analysis)
`npm run analyze` (`src/analyze-failures.ts`) reads the **latest result per (model, case)** across all
non-mock reports and writes one regenerated, temporary file `results/SESSION-FAILURES.md` that
**buckets every failed check by a normalized signature** (literals/numbers genericized) so systematic
problems surface as counts — e.g. `provenance_basis present — 7× (all got null)` — instead of
one-off observations. Failures are split into **FIELD** (enum/structural/value mismatches → prompt or
logic candidates), **JUDGE** (LLM-as-judge criterion verdicts → rule out judge noise before treating
as a real bug), **COVERAGE** (under-specified record case → fix the case), and **PARSE/SCHEMA**
(malformed model JSON). Scope with `--kind record` / `--model <m>`. `results/` is gitignored, so the
ledger is disposable — regenerate after each batch; delete at session end. This is the engine of the
refinement-session workflow (§14.8).

### 5.5 Reports
Every run writes `results/<timestamp>/report.json` (complete) and `report.md` (human-readable). For
every case and model it records: the model, the exact prompt sent, the raw output, the parsed
result, validation errors, each expectation pass/fail, and — for edges — a relation confusion
matrix (the headline artifact for which relations a model blurs).

---

## 6. Test cases

### 6.1 Authoring discipline
Author the expected outcome **a priori** from human judgment, then run and observe. Never let a
model author the expected answer (a model-derived test is guaranteed to pass and proves nothing);
`probe.ts` is for investigation only. Diagnose any failure in this order (§9 shows worked examples):
1. **Bad/ambiguous test** → fix or relax it.
2. **Prompt gap** → refine `prompts/graph-prompts.yml` or `prompts/edge-types.yml`.
3. **Logic/schema bug** → fix in `local-overrides/src/graph/schemas.ts`; log in `PORT_BACK.md`.

YAML note: keep `description` colon-free or quote it (an unquoted `:` breaks the file and the loader
reads the whole directory, so one bad file breaks every run).

### 6.2 node cases
```yaml
kind: node
description: ...
input: |        # the chunk text
  ...
expect:         # assert only what matters; enums exact, *_in accepts a set (§6.5)
  certainty_level: high            # or certainty_level_in: [high, medium]
  staleness_risk: high             # or staleness_risk_in: [...]
  question_status: open            # open|deferred|resolved|null ; or question_status_in: [...]
  question_resolution_present: false   # true = non-null, false = null
  question_resolution_contains: ["chosen option"]  # case-insensitive substrings when resolved
  reasoning_present: true
  reasoning_max_sentences: 2
  key_claims_min: 2
  key_claims_contains: ["RFC-0042"]    # case-insensitive substring in some claim
  temporal_markers_min: 1
  external_refs_contains: ["RFC-0042"]
  provenance_basis_contains: ["RFC-0042"]
  external_refs_empty: true            # also: temporal_markers_empty / chunk_summary_nonempty / provenance_present
  chunk_summary_max_sentences: 1
```

### 6.3 edge cases
The edge prompt sees `key_claims`, not raw text.
```yaml
kind: edge
description: ...
source: { chunk_id: a, key_claims: ["..."] }   # or { chunk_id: a, text: | ... } to derive claims first
target: { chunk_id: b, key_claims: ["..."] }
expect:
  primary_relation: contradicts        # the one right answer (feeds the confusion matrix)
  primary_relation_in: [a, b]          # OR accept a set (§6.5)
  expect_relations: [contradicts]
  forbid_relations: [supports]
  min_edges: 1
  max_edges: 3
  llm_assessment_in: [strong, moderate]
  require_qualifier: temporal          # temporal | conditional | uncertainty
  confidence_min: 0.6
  reasoning_max_sentences: 2
  judge_reasoning: [consistent, justifies]   # LLM-judge the edge's reasoning text (§7)
```
The 10 classified relations: supports, contradicts, supersedes, duplicates, depends_on, elaborates,
summarizes, rationale_for, extends, resolves.

### 6.4 nl cases
Natural-language outputs scored by an LLM judge (§7).
```yaml
kind: nl
field: key_claims               # or chunk_summary
description: ...
input: |                        # source text (extracted via node analysis, then judged)
  ...
criteria: [grounded, atomic, complete]    # default set per field if omitted
must_capture: ["a specific fact (must itself be atomic, §9.4)"]
max_claims: 5                   # min_claims / max_claims = precision bounds
# variants:
#   given: ["a provided output"]   -> judge this instead of extracting (calibration / negative controls)
#   expect_fail: [grounded]        -> these criteria SHOULD fail (negative controls)
#   against: key_claims            -> judge `field` against the model's own claims (cross-output consistency)
```

### 6.5 The `*_in` tolerances
`certainty_level_in`, `staleness_risk_in`, `question_status_in`, `primary_relation_in` accept a set
of values. Reserve them for axes that are **genuinely ambiguous to a careful human** (§9.5, §9.6) —
not as a way to launder a flaky test into a pass. Default to strict single-value expectations.

### 6.6 record cases (full-record) — the going-forward standard
A `record` case mimics a **single production call exactly** and checks **every field** of the
resulting JSON in one cohesive test: enum/choice/structural fields via expected-vs-actual (the same
keys as §6.2/§6.3), natural-language fields via a per-field LLM-as-judge `judge:` block, and a
**coverage guard** that fails the case if any output field has neither an `expect`, a `judge`, nor an
explicit `structural_only` waiver. This is the realistic "can the model produce the whole object
correctly, every run" test and the primary feedback mechanism for refining prompts and finding logic
bugs (§14). The facet kinds (§6.2–§6.4) remain for probing one axis and for judge calibration.

```yaml
kind: record
op: node                         # node = analyze_node ; edge = classify_edge
input_source: external           # INFO-ONLY: synthetic (hand-written) | external (real web/doc text)
source_note: "example.com/post"  # INFO-ONLY: optional provenance for external text
description: ...
input: |                         # op: node — the chunk text (production passes only chunk_content)
  ...
# op: edge instead uses source/target (key_claims, or text: to derive claims first) — see §6.3
expect:                          # enum/choice/structural fields (same keys as §6.2 / §6.3)
  certainty_level: high
  staleness_risk: high
  question_status: null
  provenance_present: true
  question_resolution_present: false
  external_refs_contains: ["RFC-0042"]
  temporal_markers_min: 1
  key_claims_min: 2
judge:                           # one LLM-judge call per NL field (§7)
  key_claims:    { criteria: [grounded, atomic, complete], must_capture: ["..."] }
  chunk_summary: { criteria: [grounded, representative, concise] }
structural_only:                 # fields deliberately not value-checked (waives the guard on purpose)
  - reasoning                    # non-persisted chain-of-thought; source-grounding criteria don't fit
  - analyzed_content_hash        # system-filled post-parse
# optional:
#   model: <graph-model>         # per-case graph-model override (default: --model)
#   judge_model: <judge-model>   # per-case judge-model override (default: --judge-model, else graph)
#   repeat: 5                    # run N times (cache bypassed); ALL must fully pass (every-run proof)
```

The guard knows the full field set from the production payload schema (node:
`GraphNodeAnalysisPayloadSchema`; edge: the edge draft + `metadata.*`), so adding a field to the
schema later forces every record case to address it — coverage stays honest by construction. Keep the
coverage tables in `src/score.ts` (`NODE_FIELD_COVERAGE` / `EDGE_FIELD_COVERAGE`) in sync with the
schema. Author input from **real web text** (a paragraph or two on a researched topic), not only
synthetic chunks, to exercise input variety — write your a-priori expectations, then run (§14).

---

## 7. LLM-as-judge

### 7.1 Why a judge
Enum/category outputs have exact answers; natural-language outputs (`key_claims`, `chunk_summary`,
edge `reasoning`) do not. For those, the workbench feeds the source + the extracted output + a rubric
back to the model and gets a per-criterion pass/fail verdict. The judge is a **testing tool, not a
production prompt**.

### 7.2 Criteria library (`src/judge.ts`)
`grounded` (no fabrication or meaning change; faithful reformatting/omission is OK), `atomic` (one
fact per item; comparatives and fact+consequence count as one; a multi-item list does not),
`complete` (captures the main factual points; ignore fluff), `faithful` (no distortion of
direction/strength/polarity/scope), `representative`, `concise`, `consistent` (asserts nothing the
reference doesn't support), `justifies` (gives a plausible rationale for an edge relation; no causal
mechanism required). Plus per-fact `captures: <fact>`.

### 7.3 Calibrating the judge
The judge is itself an LLM, so it must be validated before it's trusted. Every criterion has
`given`-mode controls: a known-good output (expect pass) and a known-bad output (`expect_fail`).
**After editing any criterion, re-run its positive AND negative controls** (§9.7). Criteria are
context-sensitive: the claim/summary criteria do not transfer cleanly to edge reasoning (§9.6).

---

## 8. Reasoning models, thinking, and reasoning-first

Two distinct things share the word "reasoning":
- A **reasoning model / native thinking** (e.g. gemma4) runs a slow internal thinking pass before
  answering. The production graph path does not use it, and it is slow. The workbench disables it by
  default via the OpenAI-compatible `reasoning_effort: "none"`, which Ollama maps to its internal
  "think" switch (plain models ignore it). With thinking off, gemma4 dropped from a >44s timeout to
  ~26s in our environment. Override with `--reasoning-effort <none|low|medium|high>` or
  `--extra-body '{"think": false}'` (the native field). Keep it off for this work.
- **Reasoning-first / chain-of-thought** is the optional `reasoning` field inside the JSON (§3.6) —
  a cheap single-completion technique that improves judgment-field accuracy and is unrelated to a
  reasoning model.

External basis for the disable mechanism: Ollama thinking capability and the OpenAI-compat
`reasoning_effort` mapping (§13.2).

---

## 9. Research findings and conclusions

Each finding states the observation, the reasoning, and the conclusion/action. Detailed per-case
results live in `cases/COVERAGE.md` and `cases/NL-TESTPLAN.md`; the production-bound deltas are in
`PORT_BACK.md`.

### 9.1 The as-wired prompts under-specified the task
**Observation:** the prompts the code sends today show the model neither the JSON schema nor (for
edges) the relation vocabulary; the runtime also did not pass a `response_format`. On gemma4 the
as-wired prompts scored 0/3 on the first run — the model invented its own JSON shape and, for edges,
relation names it was never shown. **Reasoning:** the json-repair corrector fixes *syntax*; it
cannot invent the right *fields* or *vocabulary*. **Conclusion:** the prompt must show the model the
schema and the relation vocabulary. Both are now in the refined local prompts; `--baseline` still
runs the as-wired versions for A/B.

### 9.2 JSON well-formedness on dense input
**Observation:** on number-dense passages the model emitted a stray empty-string element and let a
later field bleed into an unclosed `key_claims` array (the corrector then mangled it). **Reasoning:**
a longer/denser prompt+input destabilizes structure; the model "loses the array." **Conclusion:**
the node prompt now requires "exactly ONE well-formed JSON object" (close arrays/strings, no empty
element, no field bleeding). This is the class of issue expected to disappear on stronger models, so
hardening it on the weak floor is no-downside.

### 9.3 Completeness vs consolidation tension
**Observation:** instructing "consolidate to distinct facts" fixed over-generation but caused
under-capture (the model dropped the consequence half of compound facts, e.g. "kept 13 months" but
not "then deleted"). **Reasoning:** the two goals pull in opposite directions; optimizing one alone
regresses the other. **Conclusion:** the prompt now states the balance — consolidate, *but do not
drop* consequences/conditions/comparatives — and to split enumerations into one claim per item.

### 9.4 Atomicity, comparatives, and enumerations
**Observation/Reasoning:** a single comparative ("9% better than Y") is one fact, not two; a
fact+consequence is one; but a list "three steps: a, b, c" is several. The judge initially over-split
comparatives and under-split lists. Also, a `must_capture` fact that bundles two facts conflicts with
the atomicity it asks for. **Conclusion:** the `atomic` criterion now treats comparatives/consequence
as one and a multi-item list as non-atomic; `must_capture` facts must themselves be atomic.

### 9.5 Fuzzy enum axes and the `unknown` value
**Observation:** `certainty_level`/`staleness_risk` gradations are calibration-sensitive, and gemma4
**effectively never emits `unknown`** — it commits to a definite bucket. `deferred` vs `resolved`
for a decision-to-defer is a genuine judgment call. **Reasoning:** some distinctions are inherently
fuzzy; content-independent cue-word criteria fix the tractable ones (e.g. "likely/probably" ⇒
medium; deadline/version-bound ⇒ high even before the date; durable ⇒ low), but the `unknown` value
and `deferred`/`resolved` boundary are model/semantics judgment calls. **Conclusion:** sharpened the
definitions where it helped (folded into the prompt); used `*_in` tolerance for the genuinely fuzzy
cases; surfaced the residual product questions in §12 (12.1, 12.2, 12.6).

### 9.6 Edge confounders and the classify_edge complexity ceiling
**Observation:** with sharpened vocabulary, all 10 relations classify correctly — but `classify_edge`
is near gemma4's complexity ceiling: adding a metadata instruction (`low_confidence_flag`) flipped
the fuzzy pairs (supersedes↔contradicts, supports↔elaborates, even duplicates). A replaced *value*
genuinely reads as both supersedes and contradicts. **Reasoning:** each added instruction competes
for the weak model's attention and degrades the sensitive relation distinctions. **Conclusion:**
keep `classify_edge` lean; the supports/elaborates/extends distinction lives in the `edge-types.yml`
descriptions; `low_confidence_flag` is **deferred** (§12.4, PORT_BACK) because it cannot be added on
gemma4 without regressing relations; confusable pairs use `*_in` tolerance with confounder cases.

### 9.7 The judge is reliable on subtle errors, with one weak criterion
**Observation:** in `given`-mode controls the judge correctly caught unit/scale slips, flipped
direction, quantifier/modal swaps, condition-drops, and dropped negations, while accepting faithful
paraphrase. Its weakest criterion is `complete` — it occasionally hallucinated an omission, worse
amid marketing fluff. **Reasoning:** completeness requires the judge to enumerate "all key facts,"
which is the most subjective check. **Conclusion:** sharpened `complete` (ignore fluff; re-read the
output before failing) and re-verified the negative control still fails. Division of labor:
`grounded` catches unsupported/changed values; `faithful` catches distortions of
direction/strength/polarity/scope.

### 9.8 Model-to-model robustness
**Observation:** granite4 (weak/fast) reliably handles claims, certainty high/low, question
status, refs, temporal markers — but **fails the staleness ordinal** (under-rates high→medium,
medium→low) and resists comparative atomicity. gemma4 (thinking off) clears those. **Reasoning:**
ordinal calibration needs a more capable model; prompt wording alone can't close it on granite4.
**Conclusion:** gemma4 is a viable target for graph work; staleness/certainty gradation is a
model-capability axis to confirm per model. Run `--model a,b` for robustness.

### 9.9 Shared-prompt ripple
**Observation:** `analyze_node` is shared by all node outputs; a density increase for one field
(claims) dropped a secondary field (`external_refs`, including parenthetical "(see RFC-0042)").
Similarly `classify_edge` additions rippled to relations (§9.6). **Reasoning:** instructions in a
shared prompt compete. **Conclusion:** strengthened `external_refs` guidance; **re-confirm the whole
node/edge suite after any shared-prompt edit**. A future option (dev/arch, §12 note) is per-field
prompt splitting.

### 9.10 Production-bound prompt/schema deltas (summary)
All staged in the local sources and consolidated in `PORT_BACK.md` for one-shot push: well-formed-
JSON instruction; flat/consolidated **and** complete `key_claims`; split enumerations; per-field
definitions for certainty/staleness/question_status/provenance (external-only); strengthened
`external_refs`; reasoning-first; a format-only few-shot example; relation-vocabulary descriptions in
`edge-types.yml`; and the schema deltas (optional `reasoning`, relaxed `analyzed_content_hash`).
**Deferred (do not push):** `low_confidence_flag` in `classify_edge` (§9.6, §12.4).

### 9.11 Call structure and batching opportunities
**Observation:** production makes one `analyze_node` call per *chunk* (returning the entire node
payload — all indicators — in a single response) and one `classify_edge` call per candidate *pair*.
It does NOT call per-indicator. The workbench mirrors this 1:1; the only extra call is the test-only
**judge** on `nl` cases (extract → judge = 2 calls). The cache also collapses duplicate extractions:
a passage's `nl-claims-*` and `nl-summary-*` cases share one `analyze_node` call (both fields come
from it), so the apparent call count of an uncached run overstates the real work.
**Reasoning:** so the per-call output is already wide (one call → all node fields); the remaining
lever to cut call *count* is batching multiple chunks (or multiple candidate pairs) into one call,
returning an array.
**Conclusion (candidate, UNTESTED):** multi-chunk / multi-pair batching could cut calls ~N× for both
production and the harness, but it multiplies a single call's output, and we have already seen weak
models degrade as output grows (JSON well-formedness §9.2; over-generation/bundling §9.3). So it is
only viable if a harness experiment proves quality holds, and it is likely model-dependent. Treat as
a perf optimization to validate here before proposing to the dev/arch agent — do not assume it.

---

## 10. Maintaining the docs & the feedback → push-back lifecycle

1. **Run → record.** After each run update `cases/COVERAGE.md` (status, case, model, findings) per
   its own "How to maintain" section, and `cases/NL-TESTPLAN.md`'s learnings log for NL work.
2. **Feed changes into the editable sources only** (§2): prompt YAML, `edge-types.yml`, or
   `local-overrides/src/graph/schemas.ts`. Every change gets a `PORT_BACK.md` row (what, why, where it lands).
3. **Re-run and re-confirm** shared-prompt consumers (§9.9); update `COVERAGE.md`. A green not
   re-verified after a shared-prompt edit is not green.
4. **Decide.** Iterate to green on the target model(s); use `--baseline` to quantify the gain and a
   second `--model` for robustness.
5. **Push back to production.** Apply the consolidated `PORT_BACK.md` deltas to `src/graph` in ONE
   reviewed change; exclude DEFERRED items; then run this suite against the real instance to confirm
   nothing drifted. This single deliberate push is the only sanctioned route to production (§2).

`PORT_BACK.md` is both changelog and push manifest; it is what a human reviews before the merge.

---

## 11. Planned skill

Status: the planned skill now exists as `flashquery-graph-testgen` at
`.agents/skills/flashquery-graph-testgen/SKILL.md`.

The skill lets an agent operate this workbench. It is **thin orchestration over the docs in this
repo** — it inlines the guardrails and step order, and references the docs for schemas/commands so
it doesn't drift. Triggers: "create/refine a graph test", "cover `<axis/relation>`", "fill a
coverage gap", "test analyze_node / classify_edge", "run the graph golden-model", "author a record
case", "build a record batch", "run web research for test inputs". Each workflow below is specified
as **Purpose / Uses (reads) / Touches (writes) / Produces / Behavior** and is mirrored by the skill's
workflow-specific reference files.

Two loops compose from these workflows:
- **Facet loop** (probe one axis): 11.1 → 11.2 → (11.3 and, for NL, 11.4) → repeat → 11.5 → 11.6 → eventually 11.7.
- **Record loop** (realistic whole-object regression, the going-forward standard): 11.1R / 11.1W
  (author a batch) → 11.2 (run the batch) → 11.8 (aggregate the failures) → 11.3 (fix the ONE
  strongest signal) → re-run + re-aggregate → repeat → 11.6 → 11.7. The record loop is **aggregate-
  first** (§14.8): never refine a prompt off one case; act on a field that fails the same way across
  several cases.

### 11.1 Author a test
- **Purpose:** turn an uncovered/under-covered axis (or a target the user names) into a runnable,
  hypothesis-first case.
- **Uses:** `cases/COVERAGE.md` (pick a ◻/⚠/◐ gap); README §6 (case schemas) and `cases/README.md`
  (design discipline); the valid value sets — relation names from `prompts/edge-types.yml`, enum
  values from the schema — so expectations use legal values.
- **Touches:** creates one `cases/<kind>-<name>.yml`; updates the matching `cases/COVERAGE.md` row in
  the same change. Touches nothing in `src/` or `prompts/`.
- **Produces:** a runnable case plus a coverage row (status pending until run).
- **Behavior:** choose the kind from the axis (node = indicator/enum; edge = relation/metadata; nl =
  natural-language). Write the expected output **a priori from human judgment** — never derive it
  from a model (`src/probe.ts` is investigation-only and its output never becomes an expectation).
  Keep `description` colon-free or quoted; make `must_capture` facts atomic; reserve `*_in`
  tolerance for genuinely ambiguous axes. Does **not** call the model — authoring only.

### 11.1R Author a record (full-record) case
- **Purpose:** turn one production-faithful input into a `record` case that checks **every** output
  field at once — the realistic regression standard (README §6.6, §14).
- **Uses:** README §6.6 (record schema: `op`, `expect`, `judge`, `structural_only`, `input_source`,
  `repeat`); the coverage tables in `src/score.ts` (`NODE_FIELD_COVERAGE` / `EDGE_FIELD_COVERAGE`) for
  the full field set; the enum/relation legal values (schema + `prompts/edge-types.yml`); §7 for judge
  criteria.
- **Touches:** creates one `cases/record-<op>-<name>.yml`; nothing in `src/` or `prompts/`.
- **Produces:** a runnable record case where **every** field is addressed by `expect`, a `judge`
  block, or an explicit `structural_only` waiver (the coverage guard fails the case otherwise).
- **Behavior:** pick `op` (node = `analyze_node`, edge = `classify_edge`) and give production-faithful
  input (node: a single chunk; edge: `source`/`target` claims). For EACH field decide its check:
  enum/choice/structural → `expect` (exact, or `*_in` only when genuinely ambiguous); natural-language
  (`key_claims`, `chunk_summary`, edge `reasoning`) → a `judge` block with criteria + `must_capture`
  (atomic facts); fields you deliberately don't value-check (`analyzed_content_hash`, the non-persisted
  `reasoning`, edge claim-ref arrays / `qualifiers` / `low_confidence_flag` when not the point) →
  `structural_only`. Write all expectations **a priori from human judgment** (§6.1) — and for external
  input, never copy the source's own framing as the answer; judge what a correct system *should*
  emit. Set `input_source` and (for external) `source_note`. Use `repeat: N` for an "every run"
  determinism check. Validate it loads with `--mock` (coverage guard must be clean) before live runs.
  Authoring only — no model calls.

### 11.1W Author record inputs from web research
- **Purpose:** source **non-synthetic** record inputs from real documents so the suite tests realistic
  text, not only hand-written chunks (`input_source: external`).
- **Uses:** `WebSearch` + `mcp__workspace__web_fetch` (or `site-utils`); when a fetch is too large,
  extract via a subagent and return **verbatim** excerpts only (no model-authored expectations).
- **Touches:** creates `cases/record-<op>-ext-<name>.yml` files (with `source_note` = the URL/doc);
  nothing in `src/` or `prompts/`.
- **Produces:** record cases whose `input` is a verbatim excerpt of a real document, each with
  a-priori expectations written by the author.
- **Web-research parameters (defaults the skill should use / ask about):**
  - **Source types / proposed topics** — pick to exercise specific fields: PRDs & product specs
    (open questions, decisions, goals), research abstracts / arXiv (research-claim certainty, durable
    staleness, null provenance), RFCs & standards (external_refs, RFC-as-provenance, durable
    staleness), changelogs / deprecation & sunset notices (high staleness from a dated cutoff, temporal
    markers), dataset / benchmark / survey reports (dataset provenance, drifting staleness, a
    statistic), ADRs / postmortems (ratification provenance, resolved/deferred questions). Default a
    **spread** across these so each run yields many observations per field.
  - **Excerpt size** — one self-contained chunk, ~**40–130 words** (1–3 sentences or a short
    paragraph), matching a production chunk. Not a whole page; not a single fragment.
  - **Verbatim** — copy the published text exactly (light whitespace/markdown cleanup only); never
    paraphrase, and never let the model summarize the source into the `input`.
  - **Quantity per batch** — default ~3–4 external among a ~12–18-case batch (rest synthetic), enough
    for input variety without dominating wall-clock.
  - **Provenance/attribution** — always set `source_note` to the URL or document name; prefer stable,
    static pages (arXiv abstracts, rfc-editor, official docs) over JS-heavy marketing pages.
  - **Selection bias to avoid** — don't pick text engineered to be easy; include ordinary, messy
    real prose so the model is tested on what production actually ingests.
- **Behavior:** research first, gather verbatim excerpts, THEN author expectations by hand (§6.1).
  Keep excerpts short and self-contained. This workflow feeds 11.1R.

### 11.2 Run & diagnose
- **Purpose:** execute case(s) and classify any failure.
- **Uses:** `src/run.ts` via `npm run` / `tsx` (mode + `--only` + `--model`); `.env`; the `.cache/`.
- **Touches:** writes `results/<timestamp>/report.{json,md}` and `.cache/` only — read-only w.r.t.
  prompts, schema, and `src/graph`.
- **Produces:** a report (per-case pass/fail, the exact prompt sent, raw output, parsed result,
  judge verdicts, and an edge confusion matrix) and a **diagnosis** for each miss.
- **Behavior:** run with `reasoning_effort=none`; the run is resumable — if it is interrupted or a
  2-call NL case exceeds a window, just run again (cache replays completed calls). Read `report.md`,
  inspect the raw output / judge reasons for a miss, and classify it in the fixed order: bad/ambiguous
  test → prompt gap → logic/schema bug (README §6.1). Diagnosis only — no fixes here.

### 11.3 Refine & feed back
- **Purpose:** apply the smallest fix for a diagnosed miss and re-verify without regressions.
- **Uses:** the diagnosis from 11.2 and the known patterns/levers in README §9.
- **Touches:** exactly **one** editable source — `prompts/graph-prompts.yml`,
  `prompts/edge-types.yml`, or a local TS override (`local-overrides/src/graph/schemas.ts` today; for any other
  production TS bug, create a local override per the production-first policy §3.7, never edit
  `src/graph`) — plus a new `PORT_BACK.md` row, then re-runs (reports/cache) and updates
  `cases/COVERAGE.md`.
- **Produces:** a staged change, its `PORT_BACK.md` manifest entry, and an updated matrix.
- **Behavior:** make the minimal change that addresses the diagnosis. After editing a **shared**
  prompt (`analyze_node` or `classify_edge`), re-confirm the whole node/edge suite — a fix for one
  field/relation can regress a sibling (README §9.9), and `classify_edge` is near the model's
  complexity ceiling (§9.6). If a change regresses something, revert or rethink rather than stacking
  patches. Stop when the target is green with no new regressions.

### 11.4 Validate the judge (NL only)
- **Purpose:** prove a new or changed judge criterion actually discriminates before trusting it.
- **Uses:** `src/judge.ts` (criteria library); `given`-mode `nl-judge-*` control cases.
- **Touches:** the control cases and, if refining, the criterion definition in `src/judge.ts`
  (workbench-only — never a production change).
- **Produces:** a positive control that passes and a negative control that is caught (`expect_fail`)
  for the criterion.
- **Behavior:** a criterion is trusted only when a known-good output passes AND a known-bad output
  fails. Re-run **both** controls after any criterion edit. The judge is an LLM, so never let a model
  author the expected verdict; calibrate it the same way you'd calibrate a test instrument.

### 11.5 Compare & stress
- **Purpose:** quantify a refinement's value and test robustness across models.
- **Uses:** `--baseline` (renders the unmodified production prompts for A/B); `--model a,b` (run
  several models into one report); `src/aggregate.ts`.
- **Touches:** writes reports and cache only — no source/prompt edits.
- **Produces:** (a) an A/B delta of refined-vs-as-wired prompts, (b) a per-model scorecard + edge
  confusion matrix. These inform the production-model choice and separate prompt issues from
  model-capability issues.
- **Behavior:** `--baseline` answers "did our change beat the current production prompt?"; the
  multi-model run answers "does it hold on a weaker/stronger model?" (e.g. granite4 fails the
  staleness ordinal while gemma4 clears it, §9.8). `aggregate.ts` stitches batched runs (ignoring
  `--mock`) into one view for transcription into `COVERAGE.md`. Read-only w.r.t. prompts/schema.

### 11.6 Maintain docs
- **Purpose:** keep the record honest and current so it can feed the requirements step.
- **Uses:** `aggregate.ts` numbers and the run reports.
- **Touches:** `cases/COVERAGE.md` (status banner + rows, per its own "How to maintain" section),
  `cases/NL-TESTPLAN.md` (learnings log), `PORT_BACK.md` (manifest), and README §12 (append a new
  **product-behavior** Open Question when one surfaces).
- **Produces:** an up-to-date matrix, manifest, and learnings log; resolved questions folded into
  topic sections with the §12 entry left as a reference.
- **Behavior:** record findings, not just pass/fail; mark model-ceiling items ⚠/DEFERRED with the
  trade-off (never as ✓); every new case gets a matrix row; route product-behavior decisions to §12
  and leave architecture/implementation questions for the dev/arch agent.

### 11.7 Push back to production
- **Purpose:** land the validated refinements in `src/graph` in one deliberate, reviewed change.
- **Uses:** the `PORT_BACK.md` manifest — **§1.1–§1.4** (the content deltas), **§1.5** (the exact
  production file map), **§2** (deferred, exclude) — and the README §10.5 procedure.
- **Touches (exact files, per `PORT_BACK.md` §1.5):** prompt text → `src/graph/prompts.ts`
  (`FALLBACK_GRAPH_PROMPTS`) **and** `src/graph/defaults/graph-prompts.yml`; relation descriptions →
  `src/graph/vocabulary.ts` (`FALLBACK_GRAPH_RELATIONS`) **and** `src/graph/defaults/edge-types.yml`;
  schema → `src/graph/schemas.ts`. Each in-code-fallback/packaged-YAML pair MUST be edited together
  (parity tests T-U-076, T-U-052). No prompt *wiring* is needed — production already renders via
  `prompt-renderer.ts`. Update the affected tests (`PORT_BACK.md` §1.5 lists them). This is the
  **only** workflow that writes to `src/graph`.
- **Produces:** a single reviewed change, followed by a run of this suite against the real instance
  confirming no drift, plus updated/passing graph unit+integration tests.
- **Behavior:** gated on green on the target model(s) **and** human review of `PORT_BACK.md`. One-shot,
  not incremental (avoids the uncontrolled mid-stream changes the safety policy forbids, §2). Exclude
  §2 DEFERRED items. Existing instances' `.fqc/*.yml` sidecars are a separate migration concern (not
  this source push). If the on-instance run drifts, treat it as a fresh 11.2 → 11.3 cycle. This is the
  only sanctioned route to production.
- **Caveat — "content-only" holds for the *current* refinements.** They all fit the existing
  template variables (`{{chunk_content}}`/`{{source_chunk}}`/`{{target_chunk}}`/`{{graph:classified_types}}`)
  and the existing renderer, so the push is content + parity + schema, no wiring. A *future*
  refinement that needs something the template/renderer doesn't support — e.g. a per-call
  `response_format`/structured-output, a NEW `{{variable}}`, a system+user split, or any change to how
  messages are assembled — would require a wiring/architecture change in `src/graph`
  (`prompt-renderer.ts` and/or the analysis ops), which is a dev/arch decision, not a copy. **At push
  time, re-check that every staged delta fits the current template+renderer; if one doesn't, route it
  to the dev/arch agent as a wiring change.**

### 11.8 Aggregate failures across a batch (record loop)
- **Purpose:** turn a batch of record runs into one ranked failure view so refinement acts on
  **systematic** patterns, not single cases (README §5.4a, §14.8).
- **Uses:** `npm run analyze` (`src/analyze-failures.ts`) with `--kind record` / `--model <m>`; it
  reads the latest result per (model, case) from `results/`.
- **Touches:** writes the temporary, gitignored `results/SESSION-FAILURES.md` only.
- **Produces:** failures bucketed by normalized signature with counts, split into **FIELD** (prompt/
  logic candidates), **JUDGE** (LLM-as-judge verdicts — rule out judge noise first), **COVERAGE**
  (under-specified case — fix the case), **PARSE/SCHEMA** (malformed JSON), plus a per-case appendix.
- **Behavior:** run the whole batch first (11.2), then regenerate the ledger. Read it top-down: a
  field failing the same way across several cases is a strong signal; a lone miss usually isn't.
  **Discount JUDGE buckets** until the criterion is cleared with §7.3 controls (a flaky criterion is
  an LLMaaJ issue, not a model bug); fix COVERAGE buckets in the case. Hand the single strongest FIELD
  signal to 11.3, change ONE thing, re-run the batch, and regenerate to confirm the bucket cleared and
  no new bucket appeared. The ledger is disposable working state — delete it when the session's prompt
  changes are settled and folded into §9 / `PORT_BACK.md`.

Non-negotiables the skill must enforce regardless of what's read: don't touch `src/graph` during
refinement (only 11.7 touches it, deliberately); `must_capture` facts must be atomic; **author every
expectation a priori — never derive it from the model or, for external inputs, from the source's own
framing**; for record cases every output field must have an `expect`/`judge`/`structural_only` entry
(the coverage guard enforces this); refine prompts **aggregate-first** (a field failing the same way
across several cases, not one observation); validate the judge with positive+negative controls and
re-run them after any criterion edit; re-confirm the whole suite after a shared-prompt edit; the
production push is a separate, reviewed, one-shot step.

---

## 12. Open Questions (product behavior)

Product-behavior decisions for the user. Architecture/implementation questions (e.g. whether to
split `analyze_node` into per-field prompts, which model to run in production, whether to persist the
`reasoning` field) are deferred to the dev/arch agent and are not listed here. Resolved items have
been folded into the referenced sections.

### 12.1 Is an `unknown` value needed for `certainty_level` / `staleness_risk`? — Open
gemma4 effectively never emits `unknown`; it commits to a definite bucket (§9.5). Does the product
want an `unknown` value at all, and if so, what input should *deterministically* produce it?
Sub-questions: is "indeterminable" a meaningful product state, or should the model always commit? If
kept, define the cue(s) that warrant it.

### 12.2 Canonical semantics of `question_status` `deferred` vs `resolved` — Open
A decision *to defer* is arguably `resolved` (a decision was made) or `deferred` (postponed). We
currently accept either (§9.5). Product should define the intended meaning, since downstream UI/logic
may treat them differently. Sub-question: do we distinguish "tabled, no decision yet" from "decided
to defer until X"?

### 12.3 Should a value replacement be `supersedes`, `contradicts`, or both? — Open
When chunk B replaces a value stated in chunk A (e.g. "timeout is 30s as of v2" vs "timeout is 60s"),
the model reasonably reads it as either supersedes or contradicts (§9.6). Product/graph-semantics
decision: record one relation, or emit both (a multi-edge) so the UI can show "changed" and
"conflicting" distinctly?

### 12.4 Is `low_confidence_flag` a desired product signal on edges? — Open
It can be elicited, but describing it in `classify_edge` regresses relation accuracy on gemma4
(§9.6); it is currently deferred. If the product wants it, it implies a stronger model or a separate
pass. Decision: is the flag worth that cost, or is `llm_assessment` (already captured) sufficient?

### 12.5 For confusable relation pairs, is a single deterministic relation required, or is a
confidence-ranked set acceptable? — Open
Pairs like supports/elaborates and summarizes/duplicates are genuinely confusable (§9.6). Does the
product need one deterministic choice per pair, or can it consume a ranked/typed set with
confidence? This determines whether `*_in` tolerance reflects acceptable production behavior or a gap
to close.

### 12.6 `staleness_risk` of undated "current state" (counts, rates, ownership) — Open
Should an undated "current rate"/headcount be `medium` (drifts) or `unknown` (§9.5)? Ties to 12.1.
Product definition needed so the bucket is unambiguous.

### Resolved (folded into the document)
- **staleness_risk for deadline/version-bound content is `high` even before the date passes** —
  Resolved; folded into the staleness definition (§9.3, §9.5, §9.10).
- **`certainty_level: medium` needs content-independent cue words** ("likely/probably/preliminary")
  — Resolved; folded into the certainty definition (§9.5, §9.10).
- **`provenance_basis` names an external source, else null (never "the text")** — Resolved; folded
  into the provenance definition (§9.10).
- **`question_status` is null unless the chunk itself poses a question** — Resolved; folded into the
  question_status definition (§9.10).

> Note on "Matt's Comments": no such feedback blocks exist in these workbench docs (that convention
> belongs to the FlashQuery pipeline docs). User feedback during this work has been folded directly
> into §9 and §12.

---

## 13. References

### 13.1 Internal
- System under test: `src/graph/` (production graph logic), `src/llm/json-repair.ts` (corrector).
- Feature/research doc: `flashquery-product/Roadmap/Features/Graph Document Intelligence (Jun 2026)/`.
- Prior-art pattern: `tests/macro-framework/macro-golden-model`.
- Supporting docs: `cases/README.md`, `cases/COVERAGE.md`, `cases/NL-TESTPLAN.md`, `PORT_BACK.md`.

### 13.2 External
- Ollama — Thinking capability: https://docs.ollama.com/capabilities/thinking
- Ollama blog — Thinking: https://ollama.com/blog/thinking
- `reasoning_effort` on the OpenAI-compatible endpoint (maps to Ollama "think"):
  https://github.com/ollama/ollama/issues/14820

---

## 14. Full-record cases — design, decisions, and rationale

This section is the durable record of *why* the `record` kind exists and the choices made building
it (June 2026), so a future context window can pick up without re-deriving them. The authoring
reference is §6.6; this is the design intent.

### 14.1 Motivation
The facet kinds (§6.2–§6.4) each probe one slice: `node`/`edge` assert enums/structure but only
shallow-check NL fields; `nl` judges one NL field but asserts no enums. Nothing tested a **whole
production object at once**. We needed a case that mimics one production call exactly and verifies
**every field on the way out** — enums via expected-vs-actual, NL strings via LLM-as-judge — so we
can answer the real question: *can the model produce the entire object correctly, every run?* The
record kind is that test, and it doubles as the continuous feedback signal for refining prompts and
catching logic bugs (it found one immediately — see 14.7).

### 14.2 Shape and flow
A `record` case declares `op: node | edge` and production-faithful input (node: `input` chunk text;
edge: `source`/`target` claims, `text:` to derive). Per case the runner: (1) renders the **production
prompt** and makes **one** op call on the graph model → parses through the **real** corrector +
schema + (edge) validator; (2) for each NL field in `judge:`, makes **one** judge call on the judge
model; (3) scores every enum/structural field (reusing the §6.2/§6.3 logic), runs the coverage guard,
and scores each judged field; (4) the case passes only if **every** check passes. Cost: node ≈ 1 + N
judge calls; edge ≈ 1 + 1. Sequential, cache-resumable, reasoning off (§8) — these are deliberately
not short tests (that was accepted up front).

### 14.3 The coverage guard (the completeness guarantee)
`src/score.ts` holds `NODE_FIELD_COVERAGE` / `EDGE_FIELD_COVERAGE` — the full output field set and,
per field, which `expect` keys (or `judge` block) count as covering it. The guard emits one
`coverage: <field>` check per field and **hard-fails** any field that is covered by neither an
`expect`, a `judge`, nor an explicit `structural_only` waiver. So "check every field" is enforced by
construction, and a waiver is an intentional, visible decision rather than a silent omission. Keep the
tables in sync with the production schemas; adding a schema field forces every record case to address
it. (Strictness may be selectively relaxed for fields that prove too hard to get right — handled
case-by-case via `structural_only`, not by weakening the guard.)

### 14.4 Decisions (agreed before building)
- **New kind, not a retrofit.** `record` is additive; facet/calibration kinds stay; nothing migrated.
  Record is the going-forward standard, authored fresh from here.
- **Inputs are all required today** (node `chunk_content`; edge `source_chunk`+`target_chunk`), so no
  optional-omit variations now. If an optional input ever appears, add variations that omit it.
- **One judge call per NL field** for now (simple, robust). A single combined per-record judge call
  is a later optimization if cost demands — not worth the heavier, overload-prone prompt yet.
- **`repeat: N`** runs a case N times with the **cache bypassed** and requires **all** runs to fully
  pass — the "every single run" guarantee, since temperature-0 is not perfectly deterministic.
  Default 1; raise for final acceptance.
- **Graph vs judge model are separately selectable** across all kinds (§5.2), with per-record
  overrides. Today both default to the same model; this leaves room to fix the judge while varying
  the model under test (or vice-versa) later.
- **Coverage guard hard-fails**; deliberate non-checks are waived via `structural_only`.

### 14.5 Real-vs-synthetic input (authoring + skill)
Record input does not have to be synthetic. Because we often use AI to author cases, pull a paragraph
or two of **real text** via web research, write the a-priori expectations from human judgment (never
reverse-engineered from a model — §6.1), and run it. This exercises input variety the synthetic
chunks miss. To be wired into the test-authoring skill as an option: "use non-synthetic source text."

Each record case carries an **info-only** `input_source: synthetic | external` (plus optional
`source_note`). It does not affect scoring — it is captured so runs can be sliced by input provenance
later (e.g. "how does the model do on real external text vs. synthetic chunks?"). It surfaces in the
report's case table and in `report.json`.

### 14.6 How it coexists
Facet cases (§6.2–§6.4) remain the tool for isolating one axis when refining a single field/relation,
and `nl` `given`-mode remains how the judge is calibrated (§7.3). Record cases are the realistic,
whole-object regression standard layered on top.

### 14.8 Refinement-session workflow (aggregate, not one-by-one)
Refine prompts off **aggregate** evidence, never a single case. The loop:
1. **Author / grow a batch** of record cases spanning the field and relation space (a single case
   touches every field, so a dozen cases give many observations per field). Mix synthetic and
   `input_source: external` (real web text) for input variety.
2. **Run the batch** (`npm run record`, in `--only` sub-batches if needed; cache makes it resumable).
3. **Aggregate** (`npm run analyze -- --kind record`) → `results/SESSION-FAILURES.md`.
4. **Read the ledger top-down.** A field failing the same way across many cases (e.g. `provenance_basis
   present — N× got null`) is a strong prompt/logic signal; a lone failure usually isn't. Triage by
   category: discount JUDGE buckets until the judge is cleared (a flaky criterion is an LLMaaJ issue,
   not a model bug — validate with §7.3 controls); fix COVERAGE buckets in the case, not the prompt.
5. **Make ONE targeted prompt/logic change** for the strongest signal (§6.1 diagnose order); log it in
   `PORT_BACK.md`.
6. **Rerun the batch and re-aggregate.** A shared-prompt edit can regress another field/relation
   (§9.9), so re-confirm the whole suite — the ledger makes a new regression visible as a new bucket.
7. Repeat. The ledger is temporary working state; delete it when the session's prompt changes are
   settled and folded into §9 / `PORT_BACK.md`.

### 14.9 Record-batch refinement-session findings (2026-06-25/26, gemma4)
An 18-case record batch (13 node incl. 4 external, 5 edge) aggregated via `analyze-failures.ts`
drove these iterations (graph model = judge model = gemma4 unless noted):
- **`provenance_basis` under-population (dominant FIELD signal, 4 cases).** gemma4 filed a
  grounding/ratifying RFC/standard/dataset under `external_refs` only, leaving provenance null.
  Fix: clarified the two fields are not mutually exclusive (PORT_BACK #20). Result: deprecation and
  standard-refs now pass; residual on "the header is *defined in* RFC X" and an *internal* "our
  surveys" source — both arguably correct-as-null, i.e. test-expectation calls, not prompt gaps.
- **`question_status` `deferred`/`resolved` returned null.** gemma4 detected `open` but not a
  postponed or answered-in-chunk question. Fix: one-shot examples in the field description + "a
  question may be a weighed decision without a literal '?'" (PORT_BACK #21). Result: both now pass.
  One-shot examples in the field description are a high-leverage technique on this model.
- **Judge `consistent` was wrong for edge reasoning** (penalized referencing the target, which an
  edge must do). Removed it from edge-reasoning judging (workbench-only).
- **Judge `concise` over-fired on ~1-sentence sources** ("verbatim copy"). Relaxed to not penalize a
  faithful short summary; still fails genuinely long-winded ones (workbench-only).
- **Judge `justifies` on edge reasoning is a JUDGE-MODEL ceiling, not a prompt/criterion bug.**
  gemma4's edge reasoning is source-centric; gemma4-as-judge then fails `justifies` for not tying to
  the target — and even a relaxed definition AND a near-identical one-shot pass-example did NOT move
  it. Swapping only the judge to a stronger model (`--judge-model nemotron3:33b`, graph call still
  gemma4) makes the same case PASS. Lesson: validate the criterion with controls (pos passes / neg
  fails — it does), then attribute residual edge-reasoning `justifies` failures to judge capacity and
  run a stronger `--judge-model`, rather than over-tuning the prompt. This is the payoff of the
  graph-vs-judge model split (§5.2).
- **Rejected change:** adding a worked example to the `classify_edge` prompt **regressed** edge
  production (depends-on → `{"edges":[]}`, confirmed cache-bypassed). Reverted per §9.9 (revert a
  regressing change rather than stack patches). A future, more neutral example would need a full
  edge-suite re-confirmation before keeping.

### 14.10 Stress findings: thin fields (2026-06-26, gemma4)
Targeted stress cases for the under-specified fields. What they revealed:
- **`temporal_markers` partially works, misses version markers.** Got `["2026-03-14","Q3 2026","next
  Friday","18 months"]` but DROPPED semantic versions (`v2.1.0`, `v3.0`) even though the prompt says
  "version markers." Format is verbatim/undefined (mix of absolute + relative). **Prompt gap** — the
  one-line instruction is too thin; needs explicit sub-types (ISO date, quarter, relative, **semantic
  version**, duration) + a properly-formatted example.
- **`external_refs` under-extracts (recurring).** Returned `[]` for a chunk citing `/v1`, `v3.0`,
  "Version 2.1.0"; elsewhere skipped a named survey and "OAuth". Catches `RFC NNNN`-style IDs only.
  **Prompt gap or product call** — define whether API paths / product+version names / named
  docs count, then enumerate them with examples.
- **Qualifier EXTRACTION works; uncertainty PROPAGATION does not.** The conditional ("only when TTL
  > 60s") and uncertainty ("might… not sure") qualifiers were both extracted. But for the hedged
  link the model still returned `llm_assessment: strong`, `confidence_score: 0.8`, and
  `low_confidence_flag: null` — it records the hedge as a qualifier but does NOT carry it into the
  confidence/assessment/flag. **Prompt gap** — connect hedging to a lower assessment/confidence.
- **`low_confidence_flag` is not emitted unprompted** (confirms the §9.6/§12.4 deferral): the model
  left it null on a clearly hedged link. Producing it needs an explicit instruction, which previously
  regressed relation accuracy — so it stays a measured tradeoff, not a free win.
- **`reasoning` content is fine; the new `reasoned` judge criterion is mis-calibrated.** The model's
  reasoning ("…definite plans, so certainty high; specific deadlines make staleness high") is a good
  ~2-sentence justification, but `reasoned` failed it. The criterion needs pos/neg controls and
  loosening before it is trusted (§7.3) — reasoning *length* is already fine (~2 sentences).
- **Test-design note:** a chunk that is a bare pile of disjoint dates makes `chunk_summary`
  representative/concise unwinnable (no single point). Stress one field per case; don't pile unrelated
  facts into a chunk that also has to summarize well.

### 14.7 Status and first findings (2026-06-25)
Implemented and verified end-to-end on gemma4: `record-edge-supports` passes 21/21 live (every primary
-edge field checked + guard + waivers); `record-node-deprecation` runs clean except a genuine signal —
gemma4 lists `RFC-0042` in `external_refs` but leaves `provenance_basis` null even when the claim is
explicitly "ratified in RFC-0042". That provenance-vs-external_refs confusion is a **prompt-refinement
candidate** (do not paper over by relaxing the expectation). The coverage guard was confirmed to fire
on an intentionally under-specified case. Open follow-ups: a purpose-fit judge criterion for the
node `reasoning` field (source-grounding criteria don't suit meta-justification, so it is currently
`structural_only` in the exemplar); and the provenance prompt refinement above.
