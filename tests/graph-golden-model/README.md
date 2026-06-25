# FlashQuery Graph Golden-Model

A prompt-refinement workbench for graph intelligence. It runs contrived YAML test
cases through the **real** graph extraction logic (schemas, vocabulary, validation
imported straight from `src/graph`) against one or more local Ollama models, scores
what the model produced against what we expect, and writes a detailed report you
use to refine the prompts.

It is **not** a CI gate. It's the iteration loop that gets our prompts to reliably
produce the categorizations, relationships, and indicators we believe the graph can
extract — proven on a weak local model first, so commercial models clear the bar
comfortably.

## Production-safety policy (important)

**Do NOT modify `src/graph` (production) during refinement.** Other processes run
against production source and can't tolerate uncontrolled graph changes. Every proposed
change is staged *locally* in this workbench:

- prompt text → `prompts/graph-prompts.yml` (local copy of the prod file)
- relation vocabulary → `prompts/edge-types.yml` (local copy of the prod file)
- schema/logic deltas → `src/local-schemas.ts` (the workbench parses against this)

The workbench imports the real *unchanged* helpers (the json-repair corrector, edge
validation, the YAML loaders) but sources prompts/schema from the local copies above.
When the suite is green, push everything (prompts + edge-types + schema/logic) to
production in ONE deliberate shot, then test there. `PORT_BACK.md` is the manifest.

## For AI agents — orientation

If you are an AI agent picking this up cold, read this section first, then `cases/README.md`
(authoring rules) and `cases/COVERAGE.md` (what's covered). The non-negotiable rule is the
**Production-safety policy above**: never edit `src/graph`; stage everything locally.

### What this is, in one paragraph

A standalone TypeScript harness (run with `tsx`, no build step) that feeds hand-written YAML
"cases" to an OpenAI-compatible model (local Ollama by default), then scores the model's output
against expectations. It imports the *real* FlashQuery graph logic (JSON repair, edge validation,
vocabulary/prompt loaders, Zod schemas) so you're testing production behavior — but it sources the
*prompts and schema* from editable local copies so you can refine without touching production.

### Folder structure

```
prompts/
  graph-prompts.yml   EDITABLE local copy of prod prompts: analyze_node + classify_edge templates.
  edge-types.yml      EDITABLE local copy of the relation vocabulary (descriptions matter — they're injected).
cases/
  *.yml               the tests. Filename prefix = kind: node-*, edge-*, nl-*.
  README.md           how to author cases + the test-design discipline.
  COVERAGE.md         indicator × axis matrix with per-model status (start here to see gaps).
  NL-TESTPLAN.md      the natural-language test plan + a dated learnings log.
src/
  run.ts              CLI entry (modes + flags below).
  config.ts           resolves settings from .env / flags.
  llm-client.ts       OpenAI-compat transport + on-disk response cache + offline mock.
  prompts.ts          renders messages FROM prompts/*.yml via the real loaders.
  node-op.ts edge-op.ts nl-op.ts   run one extraction/classification/NL op (call model + parse with REAL parsers).
  judge.ts            LLM-as-judge: criteria library + judge prompt + verdict schema (for NL outputs).
  cases.ts            loads + types the YAML cases.
  score.ts            scorers (node / edge / nl) → pass/fail checks.
  report.ts           writes results/<timestamp>/report.{json,md} + console + confusion matrix.
  aggregate.ts        stitches batched runs into one scorecard + matrix (ignores mock runs).
  probe.ts            send a freeform prompt to the model (investigation only — never source answers from it).
  local-schemas.ts    schema deltas proposed for prod but staged here (workbench parses against these).
results/              generated reports (gitignored).
.cache/               response cache, keyed by request hash (gitignored).
.env                  GRAPH_GOLDEN_BASE_URL + GRAPH_GOLDEN_MODEL (see .env.example).
PORT_BACK.md          manifest of every local change to push to production in one shot.
```

### How to run

```
npm install
npm run all                      # node + edge + nl cases on the default model
npm run node | edge | nl         # one kind
npm run selftest                 # offline (mock model) — verifies the harness wiring only
npx tsx src/run.ts edge --only "edge-supports,edge-contradicts" --model granite4
npx tsx src/aggregate.ts --model gemma4:latest    # combined scorecard + confusion matrix
```

Modes (first positional arg): `node` | `edge` | `nl` | `all` (default `all`).
Flags: `--model a,b` (one or several), `--base-url`, `--api-key`, `--only <substr[,substr...]>`,
`--temperature`, `--baseline` (use unmodified prod prompts for A/B), `--reasoning-effort
<none|low|medium|high>` (default `none` — disables reasoning-model "thinking"; keep it off),
`--extra-body '<json>'`, `--no-cache`, `--clear-cache`, `--mock`.

**Resumability:** model responses are cached by request hash, so a run that's interrupted (or a
slow multi-call NL case) resumes on the next invocation — completed calls replay instantly, only
unfinished ones hit the model. Editing a prompt changes the hash and correctly re-runs. Each NL
extract→judge case is 2 model calls; expect long wall-clock time on weak local models.

### The three case kinds (how to construct tests)

Author the expectation **a priori** (your hypothesis of correct output) — never derive it from a
model. All cases are YAML; the runner auto-discovers `cases/*.yml`. Keep `description` colon-free
or quote it (an unquoted `:` breaks YAML).

**node** — per-chunk enum/indicator extraction:
```yaml
kind: node
description: ...
input: |        # the chunk text
  ...
expect:         # assert only what matters; enums are exact, *_in accepts a set (ambiguous axes)
  certainty_level: high            # or certainty_level_in: [high, medium]
  staleness_risk: high             # or staleness_risk_in: [...]
  question_status: open            # open|deferred|resolved|null ; or question_status_in: [...]
  question_resolution_present: false   # true = non-null, false = null
  reasoning_present: true
  key_claims_min: 2
  key_claims_contains: ["RFC-0042"]    # case-insensitive substring in some claim
  temporal_markers_min: 1
  external_refs_contains: ["RFC-0042"]
  external_refs_empty: true            # / temporal_markers_empty / chunk_summary_nonempty / provenance_present
```

**edge** — relationship between two chunks (the edge prompt sees `key_claims`, not raw text):
```yaml
kind: edge
description: ...
source: { chunk_id: a, key_claims: ["..."] }   # or { chunk_id: a, text: | ... } to derive claims first
target: { chunk_id: b, key_claims: ["..."] }
expect:
  primary_relation: contradicts        # the one right answer (feeds the confusion matrix)
  primary_relation_in: [a, b]          # OR accept a set, for genuinely confusable pairs
  expect_relations: [contradicts]      # at least one valid edge with each
  forbid_relations: [supports]
  min_edges: 1
  max_edges: 3
  llm_assessment_in: [strong, moderate]
  require_qualifier: temporal          # temporal | conditional | uncertainty
  confidence_min: 0.6
  judge_reasoning: [consistent, justifies]   # LLM-judge the edge's reasoning text
```
The 10 classified relations: supports, contradicts, supersedes, duplicates, depends_on,
elaborates, summarizes, rationale_for, extends, resolves.

**nl** — natural-language outputs (key_claims, chunk_summary) scored by an LLM judge:
```yaml
kind: nl
field: key_claims               # or chunk_summary
description: ...
input: |                        # source text (extracted via node analysis, then judged)
  ...
criteria: [grounded, atomic, complete]    # default set per field if omitted
must_capture: ["a specific fact (must itself be atomic)"]
max_claims: 5                   # min_claims / max_claims = precision bounds
# variants:
#   given: ["a provided output"]   -> judge this instead of extracting (calibration / negative controls)
#   expect_fail: [grounded]        -> these criteria SHOULD fail (negative controls)
#   against: key_claims            -> judge `field` against the model's own claims (cross-output consistency)
```
Judge criteria library (in `src/judge.ts`): `grounded`, `atomic`, `complete`, `faithful`,
`representative`, `concise`, `consistent`, `justifies`. The judge is itself an LLM, so **validate
it** with `given`-mode controls (feed known-good → expect pass; known-bad → `expect_fail`) before
trusting a new/changed criterion.

### Diagnosing a failure (in order)

1. **Bad/ambiguous test?** Fix or relax it (use `*_in` only for genuinely judgment-call axes).
2. **Prompt gap?** Refine `prompts/graph-prompts.yml` or `prompts/edge-types.yml` (descriptions are injected).
3. **Logic/schema bug?** Fix in `src/local-schemas.ts` (staged) and log it in `PORT_BACK.md`.

### Gotchas learned the hard way

- The node `analyze_node` prompt is **shared** by all node outputs — a change for one field can
  regress another (e.g. dense prompt dropped `external_refs`). Re-confirm the whole node suite after edits.
- `classify_edge` is near gemma4's complexity ceiling: adding instructions (e.g. a metadata field)
  can flip the fuzzy relation pairs (supersedes↔contradicts, supports↔elaborates). Add sparingly; re-confirm relations.
- gemma4 effectively never emits the `unknown` enum value — it commits to a definite bucket.
- Reasoning *models* (native "thinking") are slow and unlike prod; keep `reasoning_effort=none`.
  This is different from reasoning-first CoT (a `reasoning` field inside the JSON), which is fine.
- After editing a judge criterion, re-run its positive AND negative calibration controls.

### Maintaining the docs & the feedback → push-back lifecycle

This workbench only has value if the docs stay honest and the refinements actually flow back to
production. The lifecycle, end to end:

1. **Run → record.** After each run, update `cases/COVERAGE.md` (status, case, model, findings) and,
   for NL work, `cases/NL-TESTPLAN.md`'s learnings log. `COVERAGE.md` has its own "How to maintain"
   section — follow it. Treat the matrix as the live state of the project.
2. **Feed changes back into the editable sources, not ad hoc.** When you fix a miss, the change goes
   into one of three places and nowhere else:
   - prompt wording → `prompts/graph-prompts.yml` (`analyze_node` / `classify_edge`)
   - relation vocabulary/descriptions → `prompts/edge-types.yml`
   - schema/logic → `src/local-schemas.ts`
   Every such change gets a row in `PORT_BACK.md` (what, why, where it lands in `src/graph`).
3. **Re-run and re-confirm.** Because the prompts are shared, re-run the affected suite(s) and update
   `COVERAGE.md`. A green you didn't re-verify after a shared-prompt edit is not green.
4. **Decide.** Iterate until the suite is green on the target model(s). Use `--baseline` to quantify
   improvement over the unmodified production prompts, and a second model (`--model`) for robustness.
5. **Push back to production (the whole point).** When you're satisfied, apply the **consolidated
   `PORT_BACK.md` deltas to `src/graph` in ONE deliberate change** — the prompt YAML, edge-types
   descriptions, and the schema/logic edits together — then run this suite against the real instance
   to confirm nothing drifted. Items marked DEFERRED (e.g. `low_confidence_flag`) do NOT go in;
   note them for a stronger model. This single, reviewed push is how refinement reaches production
   without the uncontrolled mid-stream changes the safety policy forbids.

`PORT_BACK.md` is therefore both a changelog and the production push manifest — keep it accurate;
it is what a human reviews before the one-shot merge.

### Planned: a skill to drive this workflow

A skill (e.g. `flashquery-graph-testgen`) is planned to let an agent operate this workbench
reliably. It should be **thin orchestration over the docs in this repo** (this README, `COVERAGE.md`,
`cases/README.md`, `NL-TESTPLAN.md`, `PORT_BACK.md` are the source of truth) — inline the guardrails
and the step order, reference the docs for detailed schemas/commands so it doesn't drift as the
harness evolves. It should trigger on things like "create/refine a graph test", "cover `<axis/
relation>`", "fill a coverage gap", "test analyze_node / classify_edge", "run the graph golden-model".

Workflows it must support, and the actions in each:

1. **Author a test.** Read `COVERAGE.md` to pick a gap → choose the kind (node | edge | nl) → write
   the expectation *a priori* (never from a model) → create the `cases/*.yml` → add/update the
   `COVERAGE.md` row in the same step.
2. **Run & diagnose.** Run the case(s) (`tsx src/run.ts ...`, `reasoning_effort=none`, cache makes
   it resumable) → read `results/<ts>/report.md` → classify any miss in order: bad/ambiguous test →
   prompt gap → logic/schema bug.
3. **Refine & feed back.** Apply the fix to exactly one editable source — `prompts/graph-prompts.yml`,
   `prompts/edge-types.yml`, or `src/local-schemas.ts` (NEVER `src/graph`) → log it in `PORT_BACK.md`
   → re-run → re-confirm shared-prompt consumers (whole node/edge suite) → update `COVERAGE.md`.
4. **Validate the judge (NL).** Before trusting a new/changed judge criterion, run `given`-mode
   positive and negative controls; never let a model author the expected answer.
5. **Compare & stress.** A/B against production prompts with `--baseline`; run a second model with
   `--model` for robustness; aggregate with `src/aggregate.ts`.
6. **Maintain docs.** Keep `COVERAGE.md` (status banner + rows) and `NL-TESTPLAN.md` (learnings log)
   current; record findings and model-ceiling items honestly (⚠/DEFERRED with the trade-off).
7. **Push back to production.** When green on the target model(s), apply the consolidated
   `PORT_BACK.md` deltas to `src/graph` in one reviewed change; exclude DEFERRED items; re-run the
   suite against the real instance.

Non-negotiables the skill must enforce regardless of what's read: don't touch `src/graph` during
refinement; `must_capture` facts must be atomic; validate the judge with controls; re-run
calibration after any criterion edit; the production push is a separate, deliberate, reviewed step.

## The loop

1. Run the suite against a model. Read `results/<timestamp>/report.md`.
2. Where expectations miss, refine **locally**: prompt wording in
   `prompts/graph-prompts.yml` / `prompts/edge-types.yml`; schema/logic in
   `src/local-schemas.ts`. Log the change in `PORT_BACK.md`.
3. Re-run. Repeat until the suite passes on the target model.
4. Swap the model (`--model ...`) and re-run to test robustness model-to-model.
5. Compare against the unmodified production prompts any time with `--baseline`.
6. When stable, push all staged changes to production in one shot and test there.

Refinement levers in the toolkit: sharper field/relation definitions, reasoning-first
(CoT inside the JSON), explicit array/format rules, and **few-shot format examples**
(a neutral, content-free example embedded in a template — stabilizes wobbly fields).

## Configure

Copy `.env.example` to `.env` and set the two things that matter:

```
GRAPH_GOLDEN_BASE_URL=http://192.168.15.12:11434/v1   # OpenAI-compat base
GRAPH_GOLDEN_MODEL=granite4                            # default model (comma-separate for several)
```

Both are overridable per run: `--base-url`, `--model`, `--api-key`.

## Run

```
npm install
npm run all                                  # node + edge cases, default model
npm run node                                 # node cases only
npm run edge                                 # edge cases only
npm run selftest                             # offline (canned model) — verifies the harness itself
npx tsx src/run.ts all --model granite4,llama3.1:8b   # several models, one report
```

Useful flags: `--only <substr[,substr...]>` (subset of cases), `--baseline` (use the
unmodified production prompts instead of the local refined copies — A/B), `--model a,b`
(several models, one report), `--temperature`, `--no-cache` / `--clear-cache`.

### Resumable runs (response cache)

Model responses are cached on disk (`.cache/`, gitignored) keyed by a hash of the exact
request (model + params + messages). This makes slow multi-call cases — notably end-to-end
`nl` cases that do extract **then** judge — **resumable across separate runs**: if a run is
interrupted, completed calls replay instantly on the next run and only the unfinished call
hits the model. It also speeds iteration (unchanged calls never re-run; editing a prompt
changes the hash and correctly re-runs). Disable with `--no-cache`; wipe with `--clear-cache`.
This exists because each shell invocation here is wall-clock limited; the cache lets a run
that needs more total time finish over multiple invocations.

**Reasoning models vs. our `--reasoning` lever — don't conflate them.** A reasoning
*model* (e.g. gemma4) runs a slow internal thinking pass before answering, which the
production graph path does not use. The workbench disables it by default via
`reasoning_effort: "none"` (Ollama maps this to its internal Think switch; plain models
ignore it). With it off, gemma4 dropped from a 44s timeout to ~26s. Override with
`--reasoning-effort <none|low|medium|high>` (or `--extra-body '{"think": false}'` for the
native field). The refined prompt's reasoning-first (a `reasoning` field inside the JSON)
is a cheap single-completion technique and is unrelated to a reasoning model.

## What it tests

Two LLM operations, mirrored faithfully:

- **Node analysis** — extracts `key_claims`, `chunk_summary`, `certainty_level`,
  `staleness_risk`, `question_status`, `external_refs`, `temporal_markers`, …
- **Edge classification** — types a chunk pair into the 10 classified relations
  (`supports`, `contradicts`, `supersedes`, `duplicates`, `depends_on`, `elaborates`,
  `summarizes`, `rationale_for`, `extends`, `resolves`) with reasoning, confidence, and
  metadata qualifiers.

The local prompts started as verbatim copies of what the code sends today; the as-wired
versions are still reachable with `--baseline`. The headline early finding was that the
as-wired prompts showed the model neither the JSON schema nor the relation vocabulary —
both now in the refined local prompts.

## Natural-language outputs (LLM-as-judge)

Enum axes (certainty, relation, …) have exact answers. Natural-language outputs —
`key_claims`, `chunk_summary`, edge `reasoning` — don't, so `kind: nl` cases evaluate them
with an **LLM judge** (gemma4): the source text + the extracted output + a rubric of
content-independent criteria (`grounded`, `atomic`, `complete`, `faithful`, `representative`,
`concise`, plus per-fact `captures: X`) go back to the model, which returns a per-criterion
pass/fail verdict. The judge is a testing tool, not a production prompt.

Because the judge is itself an LLM, it's validated with `given`-mode calibration cases that
feed known-good / known-bad output and assert the verdict (e.g. a hallucinated claim must be
`grounded: fail`). See `cases/COVERAGE.md` → *Natural-language extraction*. An end-to-end
`nl` case makes 2 model calls (extract + judge); run those where there's no per-call timeout.

```
npm run nl                                   # natural-language cases
```

## Aggregating batched runs

gemma4 is slow enough that a full suite can exceed a single run window, so run in
batches (e.g. `--only "edge-supports,edge-extends"`); each batch writes its own report.
`npx tsx src/aggregate.ts --model gemma4:latest` stitches the latest result per case
into one scorecard + confusion matrix (it ignores `--mock` reports).

## The report

Every run writes `results/<timestamp>/report.json` (complete) and `report.md`
(human-readable). For **every case and every model** it captures: the model used,
the exact prompt sent, the raw model output, the parsed result, validation errors,
each expectation pass/fail, and — for edges — a relation confusion matrix. That
confusion matrix is the headline: it shows which relation types the model blurs, i.e.
which prompt/vocabulary descriptions need sharpening.

## Layout

```
cases/                 YAML test cases (grow this; see cases/README.md)
cases/COVERAGE.md      indicator × axis matrix with per-model status
prompts/graph-prompts.yml   EDITABLE local copy of the prod prompt templates
prompts/edge-types.yml      EDITABLE local copy of the prod relation vocabulary
src/local-schemas.ts   staged schema deltas (workbench parses against these)
src/prompts.ts         renders messages from prompts/*.yml via the real loaders
src/*.ts               runner, ops, scorer, report, aggregate, probe
results/               generated reports (gitignored)
PORT_BACK.md           manifest of everything to push to production in one shot
```
