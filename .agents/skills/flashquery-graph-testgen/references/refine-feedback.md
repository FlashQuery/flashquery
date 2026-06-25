# Refine And Feed Back

Use this workflow after a miss has been diagnosed and a minimal staged fix is needed.

## Read First

- `tests/graph-golden-model/README.md` sections 2, 3.7, 9, 10, and 11.3
- The diagnosis packet from the run
- `tests/graph-golden-model/PORT_BACK.md`

## Editable Surfaces

Choose exactly one primary editable source for each fix:

- Prompt text: `tests/graph-golden-model/prompts/graph-prompts.yml`
- Relation vocabulary descriptions: `tests/graph-golden-model/prompts/edge-types.yml`
- Local schema or logic override: `tests/graph-golden-model/local-overrides/src/graph/schemas.ts`, or a new mirror under `local-overrides/` for another production TS bug

Do not edit `src/graph` during this workflow.

## Behavior

1. Make the smallest change that addresses the diagnosis.
2. Add or update a `PORT_BACK.md` row explaining what changed, why, and where it will land.
3. Re-run the targeted case.
4. If a shared prompt changed, re-confirm the full affected suite:
   - `analyze_node` prompt change: re-run node and relevant NL extraction cases.
   - `classify_edge` prompt or vocabulary change: re-run edge cases.
5. Update `cases/COVERAGE.md` after verification.
6. If the fix regresses another case, revert or rethink before stacking more changes.

## Known Levers

- For malformed dense JSON, strengthen well-formed JSON instructions.
- For claim under-capture, balance consolidation with not dropping consequences, conditions, or comparatives.
- For enumerations, split list items into separate claims.
- For certainty, staleness, question status, provenance, refs, or temporal markers, refine per-field definitions.
- For edge relation confusion, prefer relation-description sharpening in `edge-types.yml`; keep `classify_edge` lean.
- Do not add deferred `low_confidence_flag` behavior unless the user explicitly reopens that product trade-off.

## Output

Finish with the staged file changed, `PORT_BACK.md` row touched, verification command, report path, and coverage update.
