# Macro Testing Framework

Exhaustive behavioural test coverage for the FlashQuery **macro engine** (`src/macro/`).
Tests are declarative YAML "pilots"; the runner drives the real production engine
in-process and compares its structured output to an expectation that has been
**reconciled against an independent golden implementation**.

This is the sixth Vitest tier, a peer of `tests/unit/`, `tests/integration/`,
`tests/e2e/`, `tests/scenarios/`, and `tests/benchmark/`.

The authoritative spec is
`flashquery-product/Roadmap/Features/Macro Testing Framework/Macro Testing Framework Requirements.md`.
`§N` references throughout point there. The macro **language** is specified by the
archived `FlashQuery Macro Language Requirements.md` (REQ-001..063) and the active
`MCP Broker Requirements.md` §7.15 (REQ-103..118).

> **New here? Read §1, then §13 ("Orientation for an AI dev agent") — that section
> is the fast path to doing anything in this directory.**

---

## 1. The core idea — three-oracle reconciliation

A test's expected output is never asserted by one source. Three independent
oracles must agree before a pilot is trusted:

1. **AI prediction** (`predicted_expect:`) — what the pilot's author (usually an
   AI) predicted the engine would do, written from the spec.
2. **Golden model** (`macro-golden-model/`) — a separate, independent TypeScript
   implementation of the macro language that encodes the spec. It is *executed*
   to capture the real envelope.
3. **Production engine** (`src/macro/`) — the actual shipping engine the suite
   runs against.

The **reconciliation gate**: the AI prediction is compared to the golden
capture. If they **disagree**, work stops — either the prediction misread the
spec or the golden has a bug; you investigate before the pilot enters the
corpus. If they **agree**, that agreed envelope becomes the pilot's `expect:`
block and the Vitest suite runs *production* against it. Every pilot's
`reconciliation:` block records the verdict (`clean_match` or
`predicted_diverges_from_golden`).

A second, wider check — the **P/G envelope diff** — compares golden vs.
production *field by field* across the whole corpus, catching divergences the
narrow reconciliation (outcome / return_result / error.code only) would miss.

When golden and production genuinely disagree, the divergence is triaged
against the **spec** — never against whichever engine you happen to trust — and
filed in `GOLDEN_GAPS.md` (golden bug) or `PRODUCTION_GAPS.md` (production bug).

Today the corpus is **510 pilots** across **77 coverage cells**; the suite is
**511 Vitest tests** (510 pilots + 1 framework self-test).

---

## 2. Directory layout

```
tests/macro-framework/
  README.md                  ← this file
  GOLDEN_GAPS.md              ← log of golden-model bugs found + fixed (GG-NNN)
  PRODUCTION_GAPS.md          ← log of production-engine gaps found (PG-NNN)
  eval-log.md                 ← calibration history for the testgen/author skills
  cases.test.ts               ← Vitest entrypoint (pinned by the vitest config)
  tsconfig.json               ← editor / `tsc --noEmit` config

  src/                        ← the framework harness (library code, imported)
    runner.ts                 ← YAML loader + driveTest + Vitest translator + comparator
    framework-registry.ts     ← thin tool-registry construction for tests
    framework-mirror-check.ts ← production-drift tripwire (see §11)

  scripts/                    ← runnable pipeline tools (run directly, never imported)
    capture-runner.ts         ← corpus-wide golden capture → JSON
    apply-captures.py         ← writes capture JSON back into pilot reconciliation blocks
    validate-pilots.py        ← required-field validator (the batch-done gate)
    pg-envelope-diff.ts        ← golden-vs-production field-by-field diff
    tier2-batch-generator.ts  ← one-time Tier-2 pilot generator (kept for provenance)

  cases/                      ← the pilot corpus, by category (see §6)
    grammar/ semantics/ control-flow/ dispatch/ lifecycle/ errors/ isolation/
  cases-ts/                   ← escape-hatch for imperative TS tests (normally empty)
  cases-fresh/                ← gitignored: fresh-cadence generated tests, never committed

  coverage/                   ← the MTF-* coverage matrix
    manifest.ts               ← source of truth for the cell list
    render.ts                 ← regenerates the three outputs below
    coverage.json  MTF_COVERAGE.md  MTF_INTERACTIONS.md

  fixtures/                   ← fake broker, fake clock, fake LLM, vault + progress helpers
  golden-bridge/              ← per-pilot capture machinery used by the testgen skill
  triage/                     ← failure classification + triage-record writer (Phase 6)
  state-notes/                ← state_notes schema + assertions + render
  macro-golden-model/         ← the golden model (separate npm package — see §9)

  failures/                   ← runtime output: triage records (gitignored except .gitkeep)
```

Conventions:

- **`src/` is library code** — imported by `cases.test.ts` and the other modules.
  **`scripts/` is runnable tools** — invoked directly, never imported.
- There is **no leading-underscore "scratch" convention** — it used to exist and
  it gitignored two load-bearing tools by accident. Everything outside
  `cases-fresh/` and `failures/` is real and committed.
- Two pilots keep a leading underscore on purpose because they are framework
  self-test *fixtures*: `cases/control-flow/_placeholder-loop.yml` (the
  `expect_state_notes` integrity-check witness, cell MTF-FW-002) and
  `cases/errors/_intentional-mismatch-fake-expected-result.yml` (the comparator
  divergence self-test, MTF-E-003). Leave them as they are.

---

## 3. Quick start — run the suite

```sh
# from the flashquery/ repo root

# Run the whole suite (510 pilots)
npm run test:macro-framework

# Verbose per-pilot output
npm run test:macro-framework -- --reporter=verbose

# Filter by pilot id or category (test names are `macro-framework/<category>`)
npm run test:macro-framework -- --testNamePattern=mtf-d-885
npm run test:macro-framework -- --testNamePattern='macro-framework/dispatch'
```

The Vitest config is `tests/config/vitest.macro-framework.config.ts` —
single-worker (`maxWorkers: 1`) to avoid Supabase singleton races. It loads one
entrypoint, `cases.test.ts`, which calls `loadCases()` at module-load time and
registers a `describe(macro-framework/<category>)` per category with one
`it(<pilot-id>)` per pilot.

To run, triage, and report failures with classification, use the
`flashquery-macro-run` skill or its npm script directly (see §10).

---

## 4. The skills — the operator surface

Four `.claude/skills/` skills wrap this framework. They are the intended way to
generate, run, and maintain it. Each is invoked conversationally (the trigger
phrases are in each skill's `description`) and most also have a direct npm
script. **If you are an AI agent, prefer the skills** — they enforce the
reconciliation gate that hand-editing would skip.

| Skill | Purpose | Direct script |
|---|---|---|
| **`flashquery-macro-author`** | English description → macro **source**. Generate + verify workflows. | (skill only) |
| **`flashquery-macro-testgen`** | Wrap a macro into a runnable **test pilot** YAML; capture the golden snapshot; reconcile. | `npm run testgen:macro-framework` |
| **`flashquery-macro-covgen`** | Regenerate the **coverage matrix** from the corpus. | `npm run coverage:macro-framework` |
| **`flashquery-macro-run`** | Run the suite, **classify + triage** failures, write triage records. | `npm run run:macro-framework` |

The dependency order for creating a new pilot is **author → testgen →
covgen**, then **run** to confirm. `author` produces the macro; `testgen` wraps
+ reconciles it; `covgen` refreshes the matrix; `run` executes and triages.

---

## 5. Generating a macro (`flashquery-macro-author`)

A macro is the small, shell-flavoured program under test. The macro **language**
is specified in `.claude/skills/flashquery-macro-author/macro-spec.md` — that
file is the single source of truth for what production currently supports
(grammar, builtins, the `--flag value` argument form, what the language does
*not* have). Read it before writing macro source by hand.

The `flashquery-macro-author` skill translates English ⇄ macro source. Two
workflows:

- **generate** — `description` → macro source. Runs in three modes:
  *zero-shot* (generate only), *validated* (generate → verify → auto-fix
  mechanical issues → loop up to 2 retries on algorithmic misses — the default),
  *calibration* (generate → verify → return raw + diagnostics, no fixes — for
  skill development).
- **verify** — `description` + macro source → conformance report. Can run
  standalone ("verify this macro against my intent"). Distinguishes *mechanical*
  issues (one deterministic fix — auto-corrected) from *algorithmic misses* (the
  macro structurally won't do what was asked — triggers regeneration).

A **pre-generation feasibility check** catches descriptions that name a
construct the language lacks (no try/catch, no list indexing, no `lower`
builtin, etc.) and returns a suggested restatement instead of inventing syntax.

The skill produces **only the macro source**. Wrapping it into a test pilot is
`flashquery-macro-testgen`'s job; running it is the host (`fq.call_macro`) or
the suite.

Macro-language essentials (full detail in `macro-spec.md`):

- Line-oriented, shell-flavoured. Builtins are called shell-style:
  `total = add $a $b`, not `add(a, b)`.
- Tool calls use `server.tool({ args })`. Object/list literals may span lines.
- `for x in <list|range> do … done`, `while <cond> do … done`,
  `if <cond> then … else … fi`. Ranges are end-exclusive: `1..4` → `1,2,3`.
- `true` / `false` / `null` are first-class lowercase literals. `continue` /
  `break` work inside loops. Strings interpolate `$var`, `${var}`, `$var.field`.
- Reserved keywords and the ~28 builtin names cannot be used as variable names.

---

## 6. Generating a test pilot (`flashquery-macro-testgen`)

`flashquery-macro-testgen` turns a macro into a runnable pilot. It wraps the
macro with a tool surface, vault state, expectations, coverage tags, and a
golden snapshot, then runs the **reconciliation gate** before the pilot is
considered complete.

### Three modes

```sh
# committed — one pilot per named cell, written under cases/<category>/, git-tracked
npm run testgen:macro-framework -- --mode=committed --target=MTF-C-008
npm run testgen:macro-framework -- --mode=committed --target=MTF-G-006 --target=MTF-S-007

# fresh — N pilots for the lowest-density cells, written to cases-fresh/ (gitignored, run-once)
npm run testgen:macro-framework -- --mode=fresh --count=5

# refresh — re-capture snapshots for pilots whose golden_version is behind
npm run testgen:macro-framework -- --mode=refresh --auto-accept-identical
```

### The five-step pipeline

Every committed pilot goes through this pipeline (the skill orchestrates it):

1. **`flashquery-macro-author` / generate** — description → macro source
   (verify runs internally with an auto-correction loop).
2. **`flashquery-macro-author` / verify** — "is the macro what was asked for?"
3. **testgen / wrap** — macro + intent → a *draft* pilot YAML, including
   `predicted_expect:` (the AI's prediction).
4. **testgen / strengthen** — analyses the draft for test-rigor gaps
   (multi-exit specificity, side-effect coverage, branch coverage, negative
   assertions, intent fidelity) and tightens the assertions.
5. **golden capture + reconciliation gate** — run the macro through the golden;
   compare `predicted_expect` to the golden capture. On match → promote to
   `expect:` and embed `golden_snapshot:`. On divergence → **hard stop** and
   triage (AI wrong? golden wrong? intent ambiguous?).

### The non-negotiable rule

**Every pilot MUST pass through the golden capture + reconciliation gate before
it is considered complete.** Hand-writing an `expect:` block and skipping the
gate is the one thing this framework exists to prevent. A complete pilot has a
populated `reconciliation:` block (`predicted_matched_captured` not null,
`captured_at` a real timestamp, `divergence_kind` set) and a `golden_snapshot:`
block. `scripts/validate-pilots.py` is the enforcement (see §8).

After generating: run `npm run test:macro-framework` to confirm nothing
regressed, then `flashquery-macro-covgen` to refresh the matrix.

---

## 7. The pilot YAML schema

Pilots live at `cases/<category>/<NN-slug>.yml`. The seven categories map to
language subsystems: `grammar` (G), `semantics` (S), `control-flow` (C),
`dispatch` (D), `lifecycle` (L), `errors` (E), `isolation` (I). The runner
discovers every `*.yml` recursively; the directory grouping is for humans.

```yaml
id: mtf-d-885-dispatch-basic-bind        # unique pilot id
name: Dispatch — basic single brokered call
intent: |                                # the plain-English design intent
  A single brokered ReadOnlyTool call returns an object the macro binds.
description: |                            # test mechanics + REQ citations
  ...
covers: [MTF-D-001, MTF-D-003]            # MTF-* coverage cells this pilot feeds
golden_version: "0.3.0"                   # golden package version at capture time
golden_run_at: 2026-05-20T17:40:00Z

macro: |                                  # the macro source under test
  r = svc.fetch({ id: 7 })
  exit { r: $r }
input_vars: {}                            # bound at runtime
vault: {}                                 # seed vault state (built per-test in a tmpdir)
tools:                                    # tool surface — archetypes per fixtures/fake-broker/
  svc:
    archetype: ReadOnlyTool
    tool_name: fetch
    returns: { ok: true, id: 7 }

# dry_run: true                           # optional — dispatch through runDryRun()
# trace_mode: summary|none|full           # optional — REQ-047 trace verbosity
# progress_mode: full|milestones|silent   # optional — REQ-048

predicted_expect:                         # ORACLE 1 — the AI/author prediction
  outcome: success                        # success | fail | error
  return_result: { r: { ok: true, id: 7 } }
  side_effects: { tool_call_count: 1 }

reconciliation:                           # written by apply-captures.py / the gate
  predicted_matched_captured: true
  divergence_kind: clean_match            # clean_match | predicted_diverges_from_golden
  captured_at: "..."
  golden_version: "0.3.0"

expect:                                   # ORACLE 2/3 — what the suite asserts
  outcome: success                        # (equals predicted_expect once reconciled)
  return_result: { r: { ok: true, id: 7 } }
  side_effects: { tool_call_count: 1 }

golden_snapshot:                          # captured golden detail (not live-compared)
  captured_trace_kinds: ["tool_call", "exit"]
  captured_tool_calls: [{ server: svc, tool: fetch }]
```

The fastest way to learn the schema is to read a recent pilot — e.g.
`cases/dispatch/885-dispatch-basic-bind.yml` or
`cases/semantics/1262-truthy-zero-float.yml`. Tool archetypes (`ReadOnlyTool`,
`ScriptedTool`, `StructuredContentTool`, `JSONTextTool`, `ThrowingTool`,
`IsErrorTool`, etc.) are defined in `fixtures/fake-broker/archetypes.ts`.

---

## 8. The reconciliation pipeline (`scripts/`)

After authoring or editing pilots — or to re-verify the whole corpus — run the
`scripts/` tools directly, in order:

```sh
# 1. Capture every pilot's macro through the GOLDEN model -> JSON
npx tsx tests/macro-framework/scripts/capture-runner.ts > /tmp/captures.json

# 2. Write the captures back into each pilot's reconciliation + golden_snapshot
#    blocks. Reports clean_match vs predicted_diverges_from_golden counts.
python3 tests/macro-framework/scripts/apply-captures.py /tmp/captures.json

# 3. Validate every pilot has the required fields filled in (the batch-done gate)
python3 tests/macro-framework/scripts/validate-pilots.py

# 4. Run the suite — drives PRODUCTION against the reconciled expectations
npm run test:macro-framework

# 5. Wide check — golden vs production, field by field, across the corpus
npx tsx tests/macro-framework/scripts/pg-envelope-diff.ts > /tmp/pg-diff.json
```

A healthy corpus: capture+apply all `clean_match`, validator `0 incomplete`,
the Vitest suite all-pass, the P/G diff `0 divergent`. The golden model's own
meta-tests are a separate gate:
`cd macro-golden-model && npx tsx src/test-snapshot.ts`.

(`scripts/tier2-batch-generator.ts` is a one-time generator kept for
provenance; you will not normally run it.)

---

## 9. Running and debugging failures

When `npm run test:macro-framework` reports a failure, **do not guess** — the
framework gives you structured signal. Use the `flashquery-macro-run` skill (or
`npm run run:macro-framework`), which runs the suite and writes a
classified triage record into `failures/` for every failure.

### The §5.8 five-way classification

Every failure is first-pass classified into one of five kinds:

| Classification | Meaning | Next step |
|---|---|---|
| **stale-expectations** | The pilot's `golden_version` is behind the current golden. | `flashquery-macro-testgen --mode=refresh` against the pilot. |
| **engine-bug** | Production diverged from a golden-corroborated expectation. | Investigate the `src/macro/` code path; file in `PRODUCTION_GAPS.md`. |
| **golden-bug** | The golden's captured value contradicts the spec. | Fix the golden, file in `GOLDEN_GAPS.md`. Verify against the spec. |
| **generator-misread** | An AI-generated pilot misread the spec. | Regenerate via `flashquery-macro-testgen --mode=committed`. |
| **spec-ambiguity** | None of the above fit; the spec is genuinely unclear. | Surface to the operator; consider a spec clarifier REQ. |

Only `stale-expectations` is high-confidence automatable. Every other
classification is a first-pass call the operator confirms or overrides.
Triage records under `failures/` carry the classification, confidence,
expected-vs-actual, the golden state-notes table, and a suggested remediation.
Re-triage an existing record with
`npm run run:macro-framework -- --triage <record-path>`.

### Debugging checklist

1. **Run one pilot in isolation:**
   `npm run test:macro-framework -- --testNamePattern=<pilot-id> --reporter=verbose`.
2. **Is it stale?** `npm run run:macro-framework -- --stale-check` lists pilots
   whose `golden_version` is behind. Stale → refresh, don't debug.
3. **A `predicted_diverges_from_golden` in `apply-captures.py` output** means the
   AI prediction and the golden disagree — the pilot's `predicted_expect` and
   the golden capture differ. Read the pilot's `reconciliation.notes`, then
   decide against the **spec** which oracle is right.
4. **A P/G diff finding** means golden and production disagree on a field. The
   finding names the pilot and the field, with both values. Triage against the
   spec → `GOLDEN_GAPS.md` or `PRODUCTION_GAPS.md`.
5. **Probe production directly** when you need ground truth: parse a macro with
   `parseMacroSource` and run it through `evaluateProgram` from `src/macro/`
   (see how the gap-log entries describe this — a tiny throwaway script that
   prints the real envelope). The golden has the same shape via
   `captureSnapshot` in `macro-golden-model/src/snapshot.ts`.
6. **The golden self-tests** (`macro-golden-model/src/test-snapshot.ts`) are the
   golden's own regression gate — run them after any golden change.

---

## 10. The golden model

`macro-golden-model/` is a versioned, separate-`package.json` TypeScript
implementation of the macro language — the independent oracle. Per §9.2 it
co-evolves with the spec: the golden adopts new behaviour first, production
follows. Its version is `macro-golden-model/src/version.ts` (`GOLDEN_VERSION`).
It is **read-only at framework runtime** (INV-MTF-04) — only `golden-bridge/*`
and the `scripts/` capture tools execute it.

Bumping the golden (operator-gated, §11.6): patch the golden, run its
meta-tests (`src/test-snapshot.ts`), bump `package.json`, then run the testgen
skill in `--mode=refresh` to re-capture snapshots, or let the
stale-expectations classification flag pilots one at a time.

---

## 11. The coverage matrix and the drift tripwire

**Coverage matrix.** `coverage/manifest.ts` is the source of truth for the 77
`MTF-*` cells (categories G/S/C/D/L/E/I plus the framework-self-test FW).
`coverage/render.ts` (`npm run coverage:macro-framework`, or the
`flashquery-macro-covgen` skill) reads the manifest + every pilot's `covers:`
array and regenerates `coverage.json`, `MTF_COVERAGE.md` (per-cell table), and
`MTF_INTERACTIONS.md` (category×category heatmap). A `covers:` entry is a claim
that the pilot genuinely exercises that cell — never pad it. Five cells are
`status: planned` (deliberate zero-coverage planning signal) because the
in-process harness structurally cannot reach them; their `requires` notes in
the manifest explain why.

**Drift tripwire.** `src/framework-registry.ts`'s `wrapBrokerToolForFramework`
is a hand-written mirror of production's module-private `wrapBrokerTool` in
`src/macro/registry.ts`. `src/framework-mirror-check.ts` runs at suite startup:
it SHA-256-hashes `registry.ts` and the body of `wrapBrokerTool` and compares to
pinned constants. A mismatch fires a `framework-integrity` failure. When it
fires: check the `src/macro/registry.ts` diff, mirror any behaviour change into
`wrapBrokerToolForFramework`, paste the new hashes from the failure message into
`PINNED_FILE_HASH` / `PINNED_FUNCTION_HASH`, re-run.

---

## 12. Gap logs, the eval log, and cleanup

- **`GOLDEN_GAPS.md`** — every golden-model bug the framework surfaced, with
  spec citation, fix, and post-fix retest. Entries are `GG-NNN`.
- **`PRODUCTION_GAPS.md`** — confirmed production-engine gaps, for the engine
  dev agent. Entries are `PG-NNN`.
- **`eval-log.md`** — calibration history for the testgen/author skills
  (convergence stats, per-run findings). A working diary, not a spec.

Cleanup: **`failures/`** is runtime output — the runner writes a triage record
on a genuine FAIL; it is gitignored except `.gitkeep`, delete freely.
**`cases-fresh/`** is fresh-cadence generated pilots — gitignored, never
committed, normally empty. The golden model's `node_modules/` is gitignored.
`/tmp/captures.json` and `/tmp/pg-diff.json` are disposable pipeline scratch.

What is **committed**: `cases/**`, `coverage/**`, `src/**`, `scripts/**`,
`golden-bridge/**`, `triage/**`, `state-notes/**`, `fixtures/**`,
`macro-golden-model/{src,examples,sample-vault,package*.json,tsconfig.json,README.md}`,
the gap logs, `eval-log.md`, `cases.test.ts`, `tsconfig.json`, this README.

---

## 13. Orientation for an AI dev agent

If you are picking this framework up cold:

1. **To run everything:** `npm run test:macro-framework` (from `flashquery/`).
   That one command tells you if the corpus is healthy.
2. **To generate a macro:** use the `flashquery-macro-author` skill, or read
   `.claude/skills/flashquery-macro-author/macro-spec.md` and write it by hand.
3. **To generate a test pilot:** use the `flashquery-macro-testgen` skill
   (`npm run testgen:macro-framework -- --mode=committed --target=<cell>`). It
   runs the five-step pipeline (§6) including the mandatory reconciliation gate.
   **Never hand-write `expect:` and skip the gate** — run §8's pipeline.
4. **To run + triage:** use `flashquery-macro-run` — it classifies every
   failure and writes a triage record. Then refresh the matrix with
   `flashquery-macro-covgen`.
5. **If a pilot fails:** §9. Classify it (stale / engine-bug / golden-bug /
   generator-misread / spec-ambiguity), triage against the **spec**, file the
   gap in `GOLDEN_GAPS.md` or `PRODUCTION_GAPS.md`.
6. **To add a new coverage cell:** edit `coverage/manifest.ts` first
   (`status: actionable` if the feature ships today, `planned` with a `requires`
   note if not), then author pilots for it.
7. **Load-bearing code is `src/` and `scripts/`** and is committed. The spec is
   authoritative: when the golden and production disagree, the requirements
   docs decide who is right — production is never treated as ground truth.
