# Maintain Docs

Use this workflow to keep graph golden-model records current after authoring, runs, or refinements.

## Read First

- `tests/graph-golden-model/README.md` sections 10, 11.6, and 12
- `tests/graph-golden-model/cases/COVERAGE.md`
- `tests/graph-golden-model/cases/NL-TESTPLAN.md`
- `tests/graph-golden-model/PORT_BACK.md`
- Latest relevant reports or aggregate output

## Behavior

1. Update `COVERAGE.md` according to its own maintenance instructions.
2. Add every new case to the matrix.
3. Record findings, model differences, and confusions, not just pass/fail.
4. Mark model-ceiling or deferred items as warning/deferred with the trade-off.
5. Update `NL-TESTPLAN.md` when NL cases, judge behavior, or learnings change.
6. Keep `PORT_BACK.md` aligned with every staged production-bound delta.
7. Add product-behavior open questions to README section 12 when a decision belongs to the user.
8. Leave architecture or implementation questions for the dev/arch agent unless the user asks to plan them.

## Output

Finish with each doc touched and the source report, aggregate, or decision that justified the update.
