# Plan 128-07 Summary

## Status

Completed.

## Changes

- Converted `get_briefing` to structured JSON with `generated_at`, `entity_types`, `groups`, and `removal_gate: "call_macro parity"`.
- Converted `insert_doc_link` to structured JSON with source/target identification, `status: "updated" | "unchanged"`, and the same `call_macro` removal gate.
- Kept both transitional tools registered and explicitly documented as macro-gated transitional helpers.
- Replaced old prose-format unit coverage with JSON contract and metadata gate assertions.
- Replaced compound integration coverage with focused real-vault/real-Supabase tests for structured `insert_doc_link` and `get_briefing`.
- Hardened the protocol E2E section-edit fixture with a unique path and explicit create assertion to avoid stale fixture conflicts.

## Verification

- `npm test -- tests/unit/reference-resolver.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/llm-usage-tool.test.ts`
- `npm run test:e2e -- tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts tests/e2e/protocol.test.ts`
- `npm test -- tests/unit/compound-tools.test.ts tests/unit/get-briefing.test.ts && npm run test:integration -- tests/integration/compound-tools.integration.test.ts && npm run test:e2e -- tests/e2e/protocol.test.ts`
- `! rg -n "No documents found\.|No memories found\.|Plugin Records \(|Documents \(" tests/unit/get-briefing.test.ts tests/unit/compound-tools.test.ts`
- `grep -q "call_macro" src/mcp/tool-metadata.ts src/mcp/tools/compound.ts tests/unit/compound-tools.test.ts tests/unit/get-briefing.test.ts`
- `grep -q "unchanged" tests/unit/compound-tools.test.ts`
- `grep -q "doc-read" tests/e2e/call-model-agent-loop.e2e.test.ts tests/e2e/call-model-template-tools.e2e.test.ts tests/e2e/protocol.test.ts`
- `grep -q "get_llm_usage" tests/unit/llm-usage-tool.test.ts`

## Notes

- Integration setup still logs the existing schema-migration warning about dropping a missing `description` column; the tests pass.
