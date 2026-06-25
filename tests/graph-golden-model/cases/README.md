# Graph test cases

One YAML file per case. The runner auto-discovers every `*.yml` here, so you grow
the suite by adding files — no code changes. Name files `node-*` / `edge-*` for
readability (the `kind` field is what actually dispatches).

## Node case

Tests the per-chunk categorizations/indicators node analysis must extract.

```yaml
kind: node
description: One line on what this case probes.
input: |
  The chunk text the model analyzes.
expect:                      # all keys optional — assert only what matters
  certainty_level: high      # high | medium | low | unknown  (exact)
  staleness_risk: high       # low | medium | high | unknown  (exact)
  question_status: open      # open | deferred | resolved | null  (exact)
  key_claims_min: 2          # at least N claims
  key_claims_contains:       # each substring must appear in some claim (case-insensitive)
    - deprecat
  temporal_markers_min: 1
  external_refs_contains:
    - RFC-0042
```

## Edge case

Tests relationship classification between two chunks.

```yaml
kind: edge
description: One line on the relationship being probed.
source:
  chunk_id: a
  key_claims: ["..."]        # faithful to production: edge prompt sees claims, not text
target:
  chunk_id: b
  key_claims: ["..."]
expect:
  primary_relation: contradicts   # the one right answer (drives the confusion matrix)
  expect_relations: [contradicts] # at least one VALID edge with each
  forbid_relations: [supports]    # no valid edge may carry these
  min_edges: 1
  max_edges: 3
```

Either edge side may instead supply raw `text:` (no `key_claims:`). The runner then
derives claims by running node analysis first — the chained pipeline — matching how
node quality bottlenecks edge quality in production.

## Case design guidance

Three layers make the suite informative:

1. **Clean positives** — one per relation type, engineered to obviously be that type.
2. **Confounders** — pairs plausibly two types (e.g. supports vs. elaborates,
   duplicates vs. summarizes); these reveal which type descriptions don't separate.
3. **Negatives/distractors** — related-but-unconnected pairs with `min_edges: 0`,
   `max_edges: 0` to measure false-positive rate.

## Test-design discipline (read this)

The loop is hypothesis-first:

1. **Author the expectation a priori.** Decide what a correct system *should* produce
   for a chunk/pair based on our own judgment, then write the case. Do NOT ask a model
   what the answer is and encode that — a test the model wrote is guaranteed to pass and
   proves nothing. (Probing a model with `src/probe.ts` is fine for *investigation*, but
   its output never becomes the expected value.)
2. **Run it and see what actually happens.**
3. **Diagnose a failure in this order:**
   - *Bad test case?* Ambiguous, unfair, or wrong expectation → fix or remove the case.
   - *Prompt gap?* The expectation is sound but the prompt doesn't give the model what it
     needs → refine the prompt in `src/prompts.ts`, then port back.
   - *Logic/schema bug?* The model produced the right content but our TS rejected or
     mishandled it → fix in `src/graph`, log in `PORT_BACK.md`.

Reserve the `*_in` (accept-one-of) tolerances for axes that are genuinely ambiguous to a
careful human reviewer — not as a way to launder a flaky test into a pass. Default to
strict single-value expectations.
