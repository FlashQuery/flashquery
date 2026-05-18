# Macro Testing Framework

The `macro-framework/` layer is the sixth Vitest tier (peer of `tests/unit/`, `tests/integration/`, `tests/e2e/`, `tests/scenarios/`, `tests/benchmark/`). It exhaustively validates the FlashQuery macro engine — language behaviors, dispatch, lifecycle, errors, isolation — by replaying YAML-authored permutation tests against the production engine while comparing structured outputs to an embedded golden-snapshot.

The full design lives in `flashquery-product/Roadmap/Features/Macro Testing Framework/Macro Testing Framework Requirements.md`. Key references: §5.4 (canonical YAML schema), §5.6.1 (`StateNote` schema), §5.7 (fake-broker archetypes), §5.8 (failure-triage), §9.1 (directory layout).

## Authoring a test

Create a YAML file under `cases/<category>/<descriptive-name>.yml`. The categories mirror the coverage matrix (`grammar`, `semantics`, `control-flow`, `dispatch`, `lifecycle`, `errors`, `isolation`). Required fields: `id`, `macro`, `golden_version`, `golden_run_at`, `expect`, `golden_snapshot`. Optional: `input_vars`, `vault`, `tools` (archetype config when brokered tools are involved), `expect_state_notes`, `covers`, `generator`. Tests are self-sufficient — the `expect:` block is captured from the golden at generation time and frozen in the YAML.

For TypeScript escape-hatch tests (stress, AST construction, etc.) drop a `*.test.ts` file under `cases-ts/`.

## Running

```
npm run test:macro-framework
```

Add `-- --reporter=verbose` for per-case output. The runner is in-process (Vitest, single fork) so Supabase singleton races are avoided per §9.3 / §9.7.

## Architecture at a glance

- **`runner.ts`** — discovers YAML cases, parses each per the §5.4 schema, builds the fixture vault + fake broker (when declared), drives `evaluateProgram()` from `src/macro/`, and compares structured outputs to `expect:` per INV-MTF-07.
- **`fixtures/`** — fake-broker archetype library (§5.7), `fake-llm.ts`, `fake-clock.ts`, vault helper, progress-event capture.
- **`golden-bridge/`** — testgen / refresh-only surface that loads `macro-golden-model/` and invokes `captureSnapshot()`. Not used at runtime per §5.6.
- **`state-notes/`** — `StateNote` schema (re-export from golden), `expect_state_notes` load-time integrity check, failure-triage table renderer per §5.6.1.
- **`coverage/`** — manifest + reports (Phase 4).
- **`failures/`** — auto-generated failure-triage records per §9.6 (Phase 6).
- **`macro-golden-model/`** — the patched-POC golden reference (`v0.3.0`, spec-aligned). Co-located here per §9.2.

## Interpreting failures

When a YAML test fails, the comparator reports the structured diff between the production engine's output and the `expect:` block. The `golden_snapshot.state_notes` from the YAML render as a `step | kind | summary` table for human triage (see §5.6.1) — this is the load-bearing benefit: "what was `$i` when the loop failed?" is already in the failure record. Phase 6's `flashquery-macro-run` skill will write a full triage record under `failures/<YYYY-MM-DD>-<HHMMSS>-<id>.md`; Phase 2 only logs the assertion failure inline.

## Phase plan

Built per the gated plan in §10. Phase 2 (this scaffold) — directory layout, runner, fixtures, golden bridge, state-notes module, one placeholder test passing end-to-end. Phase 3 — 12 hand-authored pilot tests. Phase 4 — coverage matrix + `flashquery-macro-covgen`. Phase 5 — `flashquery-macro-testgen`. Phase 6 — `flashquery-macro-run` + triage workflow.
