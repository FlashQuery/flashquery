# Phase 121 Pattern Map

## Source Of Truth

All implementation agents must read:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Requirements.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Tool Consolidation/MCP Tool Consolidation Test Plan.md`
- `.planning/phases/121-foundation-metadata-response-helpers-test-harness/121-CONTEXT.md`
- `.planning/phases/121-foundation-metadata-response-helpers-test-harness/121-RESEARCH.md`

## Closest Existing Analogs

| Planned file | Role | Existing analog | Pattern to reuse |
|---|---|---|---|
| `src/mcp/tool-metadata.ts` | central static metadata and selector primitives | `src/llm/tool-registry.ts`, `src/mcp/tool-catalog.ts` | exported const arrays/maps, pure resolver functions, typed diagnostics |
| `src/mcp/utils/response-formats.ts` | JSON MCP response helper exports | current `src/mcp/utils/response-formats.ts`, `src/mcp/tools/documents.ts` get_document path | preserve MCP content array shape; make `content[0].text` parseable JSON |
| `src/constants/frontmatter-fields.ts` | managed frontmatter field names | existing `FM` object | use `as const`, update `FrontmatterFieldName` automatically |
| `tests/unit/response-formats.test.ts` | helper contract tests | existing helper tests | keep focused, table-like expectations with exact JSON shapes |
| `tests/unit/mcp-server-tools.test.ts` | metadata/description/registration tests | current smoke test | replace static strings with real registry/catalog assertions |
| `tests/unit/llm-tool-registry.test.ts` | delegated tool tier behavior | existing tests | expectations derive from metadata instead of local hardcoded arrays |
| `tests/scenarios/framework/fqc_client.py` or new helper module | JSON assertion helper | current scenario client/runner parsing | add helper without removing text assertion compatibility |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | directed coverage ledger | existing D-* rows | add `D-foundation-*` rows and leave pre-migration rows intact |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | integration coverage ledger | existing INT-* rows | add `INT-foundation-*` rows |

## Local Constraints

- Do not use CommonJS.
- Do not build a web UI.
- MCP tool responses remain `{ content: [{ type: "text", text: "..." }] }`; JSON is inside text.
- Expected errors use JSON payloads and `isError: false`; runtime failures may use `isError: true`.
- Preserve existing legacy helpers until all current callers are migrated or tests are deliberately ported.
