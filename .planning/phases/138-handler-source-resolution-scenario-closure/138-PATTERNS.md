# Phase 138: Handler, Source Resolution, Scenario Closure - Pattern Map

**Mapped:** 2026-05-15
**Files analyzed:** Phase 138 expected touch points

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp/tools/macro.ts` | controller/route | request-response | existing `src/mcp/tools/macro.ts`; `src/mcp/tools/documents.ts` get/read patterns | exact-existing |
| `src/macro/source-ref.ts` | utility | transform | existing `src/macro/source-ref.ts` | exact-existing |
| `src/macro/fence-extractor.ts` | utility | transform | existing `src/macro/fence-extractor.ts` | exact-existing |
| `src/mcp/utils/resolve-document.ts` | resolver | request-response | existing document resolver | exact-existing |
| `tests/unit/macro-handler.test.ts` | test | request-response | existing handler progress-token tests | exact-existing |
| `tests/unit/macro-source-ref.test.ts` | test | transform | existing source-ref unit tests | exact-existing |
| `tests/integration/macro-source-ref.integration.test.ts` | test | request-response | `tests/integration/macro-parse-error.test.ts`, document integration tests | role-match |
| `tests/integration/macro-write-lock.integration.test.ts` | test | concurrency | `tests/integration/archive-document-lock.test.ts`, `tests/integration/macro-concurrency.test.ts` | role-match |
| `tests/e2e/macro-call-macro.test.ts` | test | real transport | `tests/e2e/http-transport.test.ts`, `tests/integration/macro-parse-error.test.ts` | role-match |
| `tests/scenarios/directed/testcases/test_macro_source_ref_named_block.py` | scenario | MCP workflow | existing directed macro scenarios | role-match |
| `tests/scenarios/integration/tests/macro_search_archive_workflow.yml` | scenario | declarative workflow | existing YAML macro scenarios | role-match |
| `tests/fixtures/macro/poc-examples/` | fixtures | transform/request-response | product `macro-prototype/examples/` | source-of-truth |

## Pattern Assignments

### `src/mcp/tools/macro.ts`

Use the existing handler as the integration point. Preserve:
- `callMacroInputSchema` field names and defaults.
- `_meta.progressToken` capture and `notifications/progress` sink.
- `registerMacroTools` returning `{ registrationSessionId }`.
- `runMacroSource` as the shared execution primitive for inline and resolved sources.

Implementation should add a source resolver helper inside this file or a small adjacent function:
```typescript
type ResolveMacroSourceInput = {
  source?: string;
  source_ref?: string;
  config: FlashQueryConfig;
  supabase: SupabaseClient;
};

type ResolveMacroSourceResult =
  | { ok: true; source: string; identifier: string }
  | { ok: false; result: ToolResult };
```

The helper should:
- Validate exactly one non-empty source.
- Use `splitMacroSourceRef` for `source_ref`.
- Call `resolveDocumentIdentifier(config, supabase, docRef, logger)`.
- Read the resolved file.
- Parse frontmatter with `gray-matter`.
- Return `not_found` when `status` is `archived`.
- Call `extractMacroFences` and `selectMacroSourceBlock`.
- Feed the resulting concrete source into `runMacroSource`.

### `src/macro/source-ref.ts`

Use existing helpers. Do not duplicate:
- `splitMacroSourceRef`
- `validateMacroBlockName`
- `describeAvailableMacroBlocks`
- `selectMacroSourceBlock`

If the handler needs stricter doc-ref validation beyond `::name`, add it here with unit tests and stable `invalid_input` reason strings from the product spec.

### `tests/unit/macro-handler.test.ts`

Extend, do not replace. Existing tests assert progress-token threading and handler return-contract strings. Add `T-U-216` through `T-U-224` where practical:
- schema accepts documented fields
- defaults apply
- both source/source_ref -> `exactly_one_required`
- neither -> `exactly_one_required`
- empty source -> `empty_source`
- empty source_ref -> `empty_source_ref`
- `::foo` -> `invalid_source_ref_format`
- invalid block name -> `invalid_block_name_format`
- concurrent invocations remain isolated

### Integration Tests

New integration files must be added to `tests/config/vitest.integration.config.ts`.

Use `tests/integration/macro-parse-error.test.ts` as the simplest MCP in-memory pattern. Use document integration tests and `archive-document-lock.test.ts` for vault/Supabase setup and write-lock assertions.

### Scenarios

Use existing project-local scenario authoring conventions:
- Directed scenarios under `tests/scenarios/directed/testcases/test_macro_*.py`.
- Module-level `COVERAGE = [...]`.
- YAML scenarios under `tests/scenarios/integration/tests/*.yml`.
- Update `DIRECTED_COVERAGE.md` and `INTEGRATION_COVERAGE.md` after adding tests.

### POC Fixtures

The product docs identify `macro-prototype/examples/` as canonical fixture seeds. Phase 138 should copy or migrate all 17 examples into a repo-local fixture location and run them through the production engine. The production tests must not depend on mutable product repo state at runtime unless the test explicitly documents that dependency.
