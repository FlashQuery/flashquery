---
name: flashquery-graph-testgen
description: Operate FlashQuery's graph golden-model workbench for creating, running, diagnosing, refining, documenting, comparing, and pushing back graph tests. Use when the user asks to create or refine a graph test, cover a graph axis/relation/indicator, fill a graph coverage gap, test analyze_node or classify_edge, run the graph golden-model, diagnose graph golden-model failures, validate NL judge criteria, update graph coverage docs, compare graph prompts across models or baseline, or push validated graph prompt/schema/vocabulary changes back to production.
---

# FlashQuery Graph Testgen

Use this skill as thin orchestration over `tests/graph-golden-model/`. Do not duplicate the workbench docs into memory unless the requested workflow needs them.

## Core Guardrails

- Work from the repo root.
- Treat `tests/graph-golden-model/README.md` as the source of truth, especially section 11.
- During refinement, do not edit `src/graph`. Only the push-back workflow may touch production graph files.
- Author expected outputs from human judgment before running a model. Never use `src/probe.ts` output as an expectation.
- Keep `must_capture` facts atomic.
- Reserve `*_in` tolerances for genuinely ambiguous axes, not flaky outcomes.
- After editing a shared prompt (`analyze_node` or `classify_edge`), re-confirm the whole affected node or edge suite.
- For NL judge criteria, require a positive control that passes and a negative control that fails.
- Treat production push-back as a separate, reviewed, one-shot step gated by green target-model runs and human review of `PORT_BACK.md`.

## Workflow Router

Always read the workbench README section for the requested workflow first:

```bash
sed -n '450,572p' tests/graph-golden-model/README.md
```

Then load only the relevant reference:

- **Author a test**: read `references/author-tests.md` when creating a new case, covering an axis/relation, or filling a gap.
- **Run and diagnose**: read `references/run-diagnose.md` when executing cases, reading reports, or classifying failures.
- **Refine and feed back**: read `references/refine-feedback.md` when applying prompt, vocabulary, or local schema fixes.
- **Validate the NL judge**: read `references/validate-judge.md` when adding/changing NL judge criteria or controls.
- **Compare and stress**: read `references/compare-stress.md` when running baseline A/B, multi-model checks, or aggregation.
- **Maintain docs**: read `references/maintain-docs.md` when updating coverage, learnings, manifest, or product open questions.
- **Push back to production**: read `references/push-production.md` when landing validated deltas in `src/graph`.

If a user asks for a full loop, compose the references in this order:

1. `author-tests.md`
2. `run-diagnose.md`
3. `refine-feedback.md`
4. `validate-judge.md` for NL work only
5. `compare-stress.md`
6. `maintain-docs.md`
7. `push-production.md` only when explicitly requested or clearly at that stage

## Workbench Files

- Main design and operations: `tests/graph-golden-model/README.md`
- Case authoring rules: `tests/graph-golden-model/cases/README.md`
- Coverage matrix: `tests/graph-golden-model/cases/COVERAGE.md`
- NL plan and learnings: `tests/graph-golden-model/cases/NL-TESTPLAN.md`
- Production push manifest: `tests/graph-golden-model/PORT_BACK.md`
- Editable prompt surface: `tests/graph-golden-model/prompts/graph-prompts.yml`
- Editable relation vocabulary: `tests/graph-golden-model/prompts/edge-types.yml`
- Local schema override: `tests/graph-golden-model/local-overrides/src/graph/schemas.ts`
- Runner: `tests/graph-golden-model/src/run.ts`
- Aggregator: `tests/graph-golden-model/src/aggregate.ts`
- Judge criteria: `tests/graph-golden-model/src/judge.ts`

## Default Commands

Run from `tests/graph-golden-model` unless a command explicitly uses a repo-root path:

```bash
npm run selftest
npx tsx src/run.ts all --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts edge --only "edge-supports,edge-contradicts" --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts nl --only "nl-judge-grounded" --model gemma4:latest --reasoning-effort none
npx tsx src/aggregate.ts --model gemma4:latest
```

Use `--mock` only for wiring checks. Use `.cache/` resumability for long or interrupted runs rather than restarting work from scratch.
