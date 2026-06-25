# Author Tests

Use this workflow to turn an uncovered or under-covered graph behavior into one runnable case.

## Read First

- `tests/graph-golden-model/README.md` sections 6 and 11.1
- `tests/graph-golden-model/cases/README.md`
- `tests/graph-golden-model/cases/COVERAGE.md`
- For edge relation names: `tests/graph-golden-model/prompts/edge-types.yml`
- For enum values: `tests/graph-golden-model/local-overrides/src/graph/schemas.ts`, then production schema only if needed

## Behavior

1. Pick the case kind from the target:
   - `node` for indicators and enum fields from `analyze_node`
   - `edge` for relation or metadata behavior from `classify_edge`
   - `nl` for natural-language outputs such as `key_claims`, `chunk_summary`, or edge reasoning
2. Write the expectation a priori from human judgment.
3. Create exactly one `tests/graph-golden-model/cases/<kind>-<name>.yml`.
4. Update the matching `COVERAGE.md` row in the same change, marking the new case as pending until run.
5. Do not call the model in this workflow.
6. Do not edit `src/`, `prompts/`, or local overrides while authoring.

## Case Discipline

- Quote or avoid colons in `description`.
- Assert only what matters.
- Use legal enum and relation values.
- Keep `must_capture` facts atomic.
- Use `*_in` only when a careful human would accept more than one value.
- Do not derive expectations from model output. `src/probe.ts` is investigation-only.

## Output

Finish with the new case path, the coverage row updated, and any assumptions that should be revisited after the first run.
