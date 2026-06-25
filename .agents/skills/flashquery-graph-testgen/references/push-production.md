# Push Back To Production

Use this workflow only when validated workbench deltas are ready to land in `src/graph`.

## Read First

- `tests/graph-golden-model/README.md` sections 2, 10.5, 11.7, and 12
- `tests/graph-golden-model/PORT_BACK.md`, especially sections 1.1-1.5 and 2
- Current staged workbench files named by `PORT_BACK.md`
- Production graph tests listed in `PORT_BACK.md`

## Preconditions

- Target model runs are green or explicitly accepted by the user.
- `PORT_BACK.md` has been reviewed by a human.
- Deferred items are identified and excluded.
- Every staged delta still fits the current production prompt renderer and template variables.

## Production File Map

Edit prompt text in both:

- `src/graph/prompts.ts` (`FALLBACK_GRAPH_PROMPTS`)
- `src/graph/defaults/graph-prompts.yml`

Edit relation descriptions in both:

- `src/graph/vocabulary.ts` (`FALLBACK_GRAPH_RELATIONS`)
- `src/graph/defaults/edge-types.yml`

Edit schema changes in:

- `src/graph/schemas.ts`

Keep in-code fallbacks and packaged YAML pairs in parity.

## Behavior

1. Treat this as one deliberate, reviewed change, not incremental refinement.
2. Exclude `PORT_BACK.md` deferred items.
3. Update affected unit and integration tests listed by `PORT_BACK.md`.
4. Run graph unit/integration tests required by the changed files.
5. Run the graph golden-model suite against the real instance after the push to confirm no drift.
6. If the on-instance run drifts, return to run-and-diagnose then refine-and-feed-back.

## Caveat

If any staged delta needs new prompt wiring, structured output, a new template variable, a system/user message split, or changed message assembly, do not copy it as content. Route that item to the dev/arch agent as an architecture change.

## Output

Finish with production files changed, tests run, graph golden-model confirmation, and any excluded/deferred items.
