# Author Tests

Use this workflow to turn an uncovered or under-covered graph behavior into one runnable case, or to author full-record cases and record batches.

## Read First

- `tests/graph-golden-model/README.md` sections 6, 11.1, 11.1R, 11.1W, and 14
- `tests/graph-golden-model/cases/README.md`
- `tests/graph-golden-model/cases/COVERAGE.md`
- For edge relation names: `tests/graph-golden-model/prompts/edge-types.yml`
- For enum values: `tests/graph-golden-model/local-overrides/src/graph/schemas.ts`, then production schema only if needed
- For record field coverage: `tests/graph-golden-model/src/score.ts` (`NODE_FIELD_COVERAGE` and `EDGE_FIELD_COVERAGE`)

## Behavior

1. Pick the case kind from the target:
   - `node` for indicators and enum fields from `analyze_node`
   - `edge` for relation or metadata behavior from `classify_edge`
   - `nl` for natural-language outputs such as `key_claims`, `chunk_summary`, or edge reasoning
   - `record` for production-faithful full-object checks, especially new regression coverage
2. Write the expectation a priori from human judgment.
3. Create exactly one `tests/graph-golden-model/cases/<kind>-<name>.yml`.
4. Update the matching `COVERAGE.md` row in the same change, marking the new case as pending until run.
5. Do not call the model in this workflow.
6. Do not edit `src/`, `prompts/`, or local overrides while authoring.

## Record Cases

Use `kind: record` as the going-forward regression standard when the user asks for records, realistic whole-object tests, or web-sourced test inputs.

1. Set `op: node` for `analyze_node` or `op: edge` for `classify_edge`.
2. Use production-faithful input:
   - node: `input: |` with one self-contained chunk.
   - edge: `source` and `target` with `key_claims`, or `text:` only when deriving claims first is intentional.
3. Set `input_source: synthetic` for hand-written input or `input_source: external` for real text. Set `source_note` for external input.
4. For every output field in `NODE_FIELD_COVERAGE` or `EDGE_FIELD_COVERAGE`, add one of:
   - `expect` for enum, choice, structural, count, containment, and presence checks.
   - `judge` for natural-language fields such as `key_claims`, `chunk_summary`, and edge `reasoning`.
   - `structural_only` for deliberate waivers such as `analyzed_content_hash`, non-persisted meta-reasoning, or edge metadata fields outside the case purpose.
5. Keep judge `must_capture` facts atomic. Use criteria from README section 7.
6. Use `repeat: N` only when the user wants an every-run determinism check.
7. Validate loading with `--mock` after authoring; the coverage guard must be clean.

Name record files `record-<op>-<name>.yml` or `record-<op>-ext-<name>.yml` for external input.

## Web-Researched Record Inputs

Use web research only for `record` cases where realistic external prose is desired. Before browsing, ask the user for any missing required parameter:

- Topics or source families to search for. If the user has no preference, propose a spread across PRDs/product specs, research abstracts, RFCs/standards, changelogs/deprecation notices, dataset/benchmark reports, and ADRs/postmortems.
- Relative excerpt size: `smaller` for faster runs (about 40-80 words), `larger` for more realistic embedding-like chunks (about 100-180 words), or `medium` when the user wants a balance (about 80-130 words).

When researching:

1. Prefer stable, static, attributable sources such as official docs, RFC Editor pages, arXiv abstracts, standards pages, changelogs, and public postmortems.
2. Copy a verbatim excerpt into `input`; perform only light whitespace or markdown cleanup.
3. Do not paraphrase, summarize, or synthesize the excerpt.
4. Do not copy large chunks of copyrighted text. Use the minimum excerpt needed for the case, with attribution in `source_note`.
5. Author expectations from human judgment after reading the excerpt. Do not let the source's title, author framing, or a model summary become the expected graph output automatically.
6. Default a batch to roughly 3-4 external cases among 12-18 total record cases unless the user asks for an all-external batch.

## Case Discipline

- Quote or avoid colons in `description`.
- Assert only what matters.
- Use legal enum and relation values.
- Keep `must_capture` facts atomic.
- Use `*_in` only when a careful human would accept more than one value.
- Do not derive expectations from model output. `src/probe.ts` is investigation-only.
- For external inputs, preserve source attribution and keep excerpts short enough for test runtime and copyright hygiene.

## Output

Finish with the new case path, the coverage row updated, and any assumptions that should be revisited after the first run.
