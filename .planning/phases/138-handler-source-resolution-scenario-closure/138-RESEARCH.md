# Phase 138: Handler, Source Resolution, Scenario Closure - Research

**Researched:** 2026-05-15
**Question:** What do we need to know to plan Phase 138 well?

## Summary

Phase 138 is a finishing phase. The codebase already contains `src/macro/` modules for parser, evaluator, source-ref helpers, fence extraction, dry-run, progress, budgets, task registry, and dispatch. The public handler in `src/mcp/tools/macro.ts` accepts the production request schema and runs inline `source`, but it still returns `unsupported` with `details.reason: "source_ref_not_implemented"` for `source_ref`.

The plan should therefore focus on handler-boundary tests, source_ref document resolution, integration/E2E/scenario closure, and POC fixture validation. It should not re-open parser, evaluator, builtin, permission, trace, progress, budget, or task lifecycle internals except where the handler must pass existing options through the new source_ref path.

## Canonical Product Docs

Downstream agents MUST read these before implementation:
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`

Relevant spec mapping:
- Spec Phase 9: MCP handler + `source_ref` doc-level resolution + integration tests + scenario tests.
- Requirements: REQ-001, REQ-002, REQ-003, REQ-004, REQ-058.
- Local IDs: `MACRO-SRC-01`, `MACRO-SRC-02`, `MACRO-SRC-03`, `MACRO-SRC-04`, `MACRO-INT-02`.

## Current Code Findings

### Handler

`src/mcp/tools/macro.ts`:
- `callMacroInputSchema` already accepts `source`, `source_ref`, `input_vars`, `budget`, `dry_run`, `trace`, and `progress`.
- `runMacroSource` only accepts a concrete `source: string`, parses with `parseMacroSource(options.source, 'inline')`, and executes/dry-runs the parsed program.
- `registerMacroTools` validates only the broad source/source_ref branch and treats `source_ref` as unsupported:
  - both or neither: `invalid_input` / `exactly_one_required`
  - `source_ref`: `unsupported` / `source_ref_not_implemented`
- Inline source passes `budget`, `dry_run`, `trace`, `progress`, `_meta.progressToken`, and notifications correctly into `runMacroSource`.

### Source Helpers

`src/macro/source-ref.ts`:
- `splitMacroSourceRef(value)` handles optional `::name`.
- `validateMacroBlockName(name)` enforces `[A-Za-z][A-Za-z0-9_-]{0,63}`.
- `selectMacroSourceBlock(blocks, blockName, identifier)` implements `no_macro_blocks`, `ambiguous_macro_block`, `block_not_found`, and `duplicate_block_name` matrices.

`src/macro/fence-extractor.ts`:
- `extractMacroFences(markdown, identifier)` extracts `fqm` fences and named `fqm name=<identifier>` blocks.
- Malformed attributes return `parse_error` with `reason: "malformed_fence_attributes"`.

### Document Resolver

`src/mcp/utils/resolve-document.ts`:
- `resolveDocumentIdentifier(config, supabase, identifier, logger)` is the standard path / `fq_id` / filename resolver used by document tools.
- It returns `ResolvedDocument` with `absPath`, `relativePath`, `fqcId`, and `resolvedVia`.
- It throws `DocumentNotFoundError`, `AmbiguousDocumentIdentifierError`, or `DocumentReadError` for failure cases.

Implementation implication:
- The handler should call this resolver for `source_ref` doc-level resolution.
- After reading the resolved file, it must inspect frontmatter/status and map archived docs to `not_found`.
- Permission behavior should be inherited from the resolver or document-output path where available; if no explicit permission layer exists for local file reads, tests should pin the current inherited behavior without inventing a new macro-only ACL.

### Tests and Scenario State

Existing macro unit and integration test files already include many prior phase rows:
- `tests/unit/macro-handler.test.ts`
- `tests/unit/macro-source-ref.test.ts`
- `tests/unit/macro-fence-extractor.test.ts`
- `tests/integration/macro-parse-error.test.ts`
- `tests/integration/macro-concurrency.test.ts`
- `tests/integration/macro-call-macro-session.test.ts`
- `tests/integration/macro-shell-verbs.integration.test.ts`
- `tests/integration/macro-tool-dispatch.test.ts`

`tests/config/vitest.integration.config.ts` uses an explicit include list. New integration files must be added there.

Existing scenario files cover cancellation, permissions, shell, trace, progress, and budgets, but Phase 138 still needs source_ref/named-block, archived source_ref, macro write-lock inheritance, E2E public transport paths, and POC fixture closure.

## Planning Implications

1. Add contract tests first for handler schema/defaults and source/source_ref invalid-input matrix.
2. Implement source resolution in a small helper so unit tests can exercise it without running the whole server.
3. Reuse existing source-ref and fence-extractor helpers.
4. Keep `runMacroSource` as the inline execution primitive; add a higher-level resolver path that obtains the concrete source string and identifier before calling it.
5. Add integration tests that use real document creation/resolution, including named macro library docs and archived docs.
6. Add E2E tests over a real MCP transport for success, dry-run, parse-error, and progress notifications.
7. Add directed/YAML scenarios and update coverage matrices using the project-local FlashQuery scenario skills when useful.
8. Add a POC fixture suite or fixture runner that executes all 17 migrated examples under the production engine.

## Validation Architecture

Use the existing test stack:
- Unit: `npm test -- --reporter=verbose macro-handler macro-source-ref macro-fence-extractor`
- Integration: `npm run test:integration -- --reporter=verbose macro`
- E2E: focused e2e macro transport command if present, or the e2e macro test file through Vitest.
- Directed scenarios: `python3 tests/scenarios/directed/run_suite.py --managed --filter macro`
- YAML scenarios: `python3 tests/scenarios/integration/run_integration.py --managed --filter macro`
- Final: `npm run build` plus all focused macro unit/integration/scenario commands.

## Risks

- `source_ref` can accidentally bypass existing document resolver behavior if implemented as raw file reads from the handler. Mitigation: read `resolveDocumentIdentifier` first and use it for doc-level lookup.
- Archived documents can be misclassified as active because the resolver returns file paths regardless of frontmatter status. Mitigation: parse frontmatter after resolution and explicitly map archived status to `not_found`.
- Inline and source_ref paths can diverge on dry-run/budget/trace/progress/session behavior. Mitigation: resolve source_ref into the same `runMacroSource` path used by inline source.
- Scenario coverage IDs can collide with existing matrices. Mitigation: check `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` before registering rows and use existing macro ID conventions from the Test Plan.

## Open Questions

None blocking. The product docs are sufficient for planning. Permission-denied behavior should be inherited from the existing resolver/document read path; implementation should not invent a new ACL.

## RESEARCH COMPLETE
