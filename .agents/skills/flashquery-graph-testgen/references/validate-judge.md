# Validate The NL Judge

Use this workflow for NL judge criteria, `given`-mode controls, or changes to `src/judge.ts`.

## Read First

- `tests/graph-golden-model/README.md` sections 7, 9.7, and 11.4
- `tests/graph-golden-model/src/judge.ts`
- Existing `tests/graph-golden-model/cases/nl-judge-*.yml` controls

## Behavior

1. Define the criterion in human terms before editing a model-facing rubric.
2. Create or update a known-good `given` control that should pass.
3. Create or update a known-bad `given` control with `expect_fail` that should fail.
4. Re-run both controls after any criterion edit.
5. Do not let a model author the expected verdict.
6. Treat judge calibration as workbench-only; this is not a production prompt change.

## Commands

Run from `tests/graph-golden-model`:

```bash
npx tsx src/run.ts nl --only "nl-judge-<criterion>" --model gemma4:latest --reasoning-effort none
```

Use a broader `--only` pattern if the positive and negative controls do not share a single name prefix.

## Output

Finish with the criterion changed, positive control result, negative control result, and the report path.
