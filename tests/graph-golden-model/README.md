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
