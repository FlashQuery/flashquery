# Graph test cases — authoring guide

One YAML file per case. The runner auto-discovers every `*.yml` here, so you grow the suite by
adding files — no code changes. Name files `node-*` / `edge-*` / `nl-*` for readability (the `kind`
field is what actually dispatches).

**This is the authoring guide.** The authoritative, complete field reference for all three case
kinds is **README §6** (`../README.md`). The unique content here is the *design discipline*. Keep
this file consistent with README §6 and `COVERAGE.md`.

## Case kinds (summary — full schemas in README §6)

- `kind: node` — per-chunk indicator/enum extraction (README §6.2).
- `kind: edge` — relationship between two chunks; the edge prompt sees `key_claims`, not raw text.
  Either side may supply `text:` instead of `key_claims:` and the runner derives claims first — the
  chained pipeline, matching how node quality bottlenecks edge quality in production (README §6.3).
- `kind: nl` — natural-language outputs (`key_claims`, `chunk_summary`, edge `reasoning`) scored by
  the LLM judge, incl. `given`-mode calibration controls (README §6.4, §7).

YAML note: keep `description` colon-free or quote it — an unquoted `:` breaks the file, and the
loader reads the whole directory, so one bad file breaks every run.

## Case-design guidance

Three layers make the suite informative:

1. **Clean positives** — one per relation/axis, engineered to obviously be that type.
2. **Confounders** — pairs plausibly two types (e.g. supports vs. elaborates, duplicates vs.
   summarizes); they reveal which descriptions don't separate. Use `primary_relation_in` tolerance.
3. **Negatives/distractors** — related-but-unconnected pairs (`min_edges: 0`, `max_edges: 0`) to
   measure false-positive rate; and for NL, `given`-mode negative controls.

## Test-design discipline (read this)

The loop is hypothesis-first (see README §6.1, §10):

1. **Author the expectation a priori.** Decide what a correct system *should* produce, then write
   the case. Do NOT ask a model for the answer and encode it — a model-authored test is guaranteed
   to pass and proves nothing. (`src/probe.ts` is for investigation only; its output never becomes
   an expected value.)
2. **Run it and see what actually happens.**
3. **Diagnose a failure in this order:**
   - *Bad/ambiguous test?* → fix or remove the case.
   - *Prompt gap?* The expectation is sound but the prompt under-specifies → refine
     `prompts/graph-prompts.yml` or `prompts/edge-types.yml`, log in `PORT_BACK.md`.
   - *Logic/schema bug?* The model produced the right content but the TS rejected/mishandled it →
     fix in `src/local-schemas.ts` (staged), log in `PORT_BACK.md`. **Never edit `src/graph`**
     during refinement (README §2).

After any shared-prompt edit (`analyze_node` / `classify_edge`), re-confirm the whole node/edge
suite — a change for one field/relation can regress another (README §9.9). For NL, validate the
judge with positive AND negative `given`-mode controls before trusting a new/changed criterion
(README §7.3).

Reserve the `*_in` (accept-one-of) tolerances for axes genuinely ambiguous to a careful human
reviewer (README §6.5) — not to launder a flaky test into a pass. Default to strict single-value
expectations.
