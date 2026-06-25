# Run And Diagnose

Use this workflow to execute graph golden-model cases and classify misses.

## Read First

- `tests/graph-golden-model/README.md` sections 5, 6.1, 9, and 11.2
- The relevant generated `results/<timestamp>/report.md`
- `report.json` only when `report.md` does not expose enough raw output, parsed data, or judge detail

## Commands

Run from `tests/graph-golden-model`:

```bash
npx tsx src/run.ts all --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts node --only "<substr[,substr...]>" --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts edge --only "<substr[,substr...]>" --model gemma4:latest --reasoning-effort none
npx tsx src/run.ts nl --only "<substr[,substr...]>" --model gemma4:latest --reasoning-effort none
```

Use `npm run selftest` or `--mock` only for offline wiring checks. Mock passes do not validate model behavior.

## Behavior

1. Prefer targeted `--only` batches for slow suites, especially NL.
2. Keep `reasoning_effort` off unless the user explicitly asks to test native thinking.
3. Use `.cache/` resumability. If a run is interrupted, run the same command again.
4. After the run, read `report.md` before editing anything.
5. Classify each miss in this fixed order:
   - bad or ambiguous test
   - prompt gap
   - logic or schema bug
6. Diagnose only in this workflow. Do not apply fixes here.

## Evidence To Capture

- Case name and kind
- Model and command
- Exact expected field that failed
- Raw model output or judge reason when relevant
- Parsed result and validation errors
- For edge work, relation confusion-matrix signal
- Proposed diagnosis and why earlier diagnosis classes were ruled out

## Output

Finish with a short diagnosis packet per miss and the report path.
