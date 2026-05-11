# Phase 121: Foundation Validation Strategy

**Date:** 2026-05-11
**Status:** Required by planning

## Validation Architecture

Phase 121 is accepted only when the foundation proves both API contracts and downstream test scaffolding. The phase must not rely on "later phases will add tests" as acceptance evidence.

## Required Coverage

| Requirement source | Unit target | Integration target | E2E target | Directed row | Integration scenario row |
|---|---|---|---|---|---|
| FND-01, FND-02 metadata registry | `tests/unit/tool-metadata.test.ts`, `tests/unit/llm-tool-registry.test.ts`, `tests/unit/mcp-server-tools.test.ts` | registration/catalog metadata smoke | `tests/e2e/protocol.test.ts` listTools metadata-backed smoke if available | `D-foundation-tools-*` | `INT-foundation-tools-*` |
| FND-03, FND-04, FND-05, FND-06 JSON helpers | `tests/unit/response-formats.test.ts` | `tests/integration/tools-response-format.test.ts` representative helper-backed handler smoke | protocol JSON parse/error round-trip | `D-foundation-json-*` | `INT-foundation-json-*` |
| FND-07 frontmatter constants | `tests/unit/frontmatter-fields.test.ts`, `tests/unit/no-hardcoded-extensions.test.ts` or new hardcoded `fq_*` guard | representative scan/document constant usage smoke if changed | not required unless a host tool is touched | `D-foundation-frontmatter-*` | `INT-foundation-frontmatter-*` |
| FND-08 descriptions | `tests/unit/tool-metadata.test.ts` or `tests/unit/mcp-server-tools.test.ts` | registration description smoke from actual registered metadata | listTools description smoke if stable | `D-foundation-description-*` | not required |
| TEST-01..TEST-06 traceability and scenario scaffolding | runner/helper unit tests | runner integration fixture if practical | protocol representative smoke | coverage rows plus runnable directed JSON assertion scenario | coverage rows plus runnable YAML JSON assertion workflow |

## Verification Commands

Minimum commands to run before claiming Phase 121 complete:

```bash
npm test -- tests/unit/response-formats.test.ts tests/unit/mcp-server-tools.test.ts tests/unit/llm-tool-registry.test.ts tests/unit/frontmatter-fields.test.ts
npm run test:integration -- tests/integration/tools-response-format.test.ts
npm run test:e2e -- tests/e2e/protocol.test.ts
python tests/scenarios/directed/run_suite.py --managed foundation
python tests/scenarios/integration/run_integration.py --managed foundation
npm run build
```

If Supabase or external-provider prerequisites are missing, use the existing helper skip mechanisms only. The tests, coverage rows, and skip reason must still exist.

## Blocking Rules

- No broad tool migration starts before JSON helper unit tests pass.
- No selector or filtering work starts before metadata registry unit tests pass.
- No phase completion without a phase-local traceability table committed in the plan/SUMMARY artifacts.
- No new hardcoded managed frontmatter field literals outside `src/constants/frontmatter-fields.ts` and explicit allowlist contexts.
