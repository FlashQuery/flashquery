# Compare And Stress

Use this workflow to quantify whether staged refinements beat baseline prompts, hold across models, and improve record-batch failure patterns.

## Read First

- `tests/graph-golden-model/README.md` sections 5.4, 5.4a, 5.5, 9.8, 11.5, and 11.8
- Latest relevant reports under `tests/graph-golden-model/results/`

## Commands

Run from `tests/graph-golden-model`:

```bash
npx tsx src/run.ts all --baseline --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts all --model "granite4,gemma4:latest" --reasoning-effort none
npm run analyze -- --kind record --model gemma4:latest
npx tsx src/aggregate.ts --model gemma4:latest
```

Use `--only` batches when a full uncached run is too slow. Aggregation stitches latest non-mock reports per case.

## Behavior

1. Use `--baseline` to answer whether refined prompts beat current production/as-wired prompts.
2. Use `--model a,b` to separate prompt issues from model-capability issues.
3. Ignore mock runs for quality conclusions.
4. Record model-ceiling items as limitations or deferred decisions, not green passes.
5. For record loops, compare `results/SESSION-FAILURES.md` before and after a refinement; a good change clears or reduces the target FIELD bucket without creating a new bucket.
6. Feed aggregate numbers into `cases/COVERAGE.md`.

## Output

Finish with A/B delta, per-model scorecard or confusion-matrix findings, record failure-bucket changes when applicable, aggregate command/report paths, and documentation updates needed.
