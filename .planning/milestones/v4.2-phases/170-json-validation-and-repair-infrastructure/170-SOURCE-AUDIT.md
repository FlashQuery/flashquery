# Phase 170 Source Coverage Audit

## Coverage Summary

| Source Type | Item | Coverage |
|-------------|------|----------|
| GOAL | Add shared LLM JSON repair/schema-validation infrastructure and retrofit current parse sites so repairable JSON is deterministic and irreparable structured-channel failures do not silently succeed. | Plans 170-01 through 170-04 |
| REQ | REQ-001 | 170-01 |
| REQ | REQ-002 | 170-01 |
| REQ | REQ-003 | 170-01 |
| REQ | REQ-004 | 170-02, 170-04 |
| REQ | REQ-005 | 170-02, 170-04 |
| REQ | REQ-006 | 170-02, 170-04 |
| REQ | REQ-007 | 170-03 |
| REQ | REQ-008 | 170-03 |
| REQ | REQ-009 | 170-03 |
| REQ | REQ-010 | 170-02, 170-04 |
| REQ | REQ-011 | 170-01, 170-04 |
| RESEARCH | Add `jsonrepair@3.14.0` as runtime dependency with ESM import. | 170-01 |
| RESEARCH | Pure `src/llm/json-repair.ts` parser with Zod `safeParse()`. | 170-01 |
| RESEARCH | Macro evaluator, host-template, and macro task result silent-failure retrofits. | 170-02 |
| RESEARCH | Provider argument normalization, brokered tool coercion, native unchanged regression. | 170-03 |
| RESEARCH | Public workflow evidence and scenario matrix updates when scenarios are added. | 170-04 |
| CONTEXT | D-01 and D-02 canonical source order. | Every plan context and every behavior-interpreting `<read_first>` includes canonical Requirements/Test Plan docs. |
| CONTEXT | D-03 through D-07 shared utility decisions. | 170-01 |
| CONTEXT | D-08 through D-11 high-priority retrofit decisions. | 170-02 |
| CONTEXT | D-12 through D-14 compatibility retrofit decisions. | 170-03 |
| CONTEXT | D-15 through D-18 testing and public verification decisions. | 170-01 through 170-04 |
| CONTEXT | D-19 through D-21 discretion decisions. | 170-01 uses flexible names, 170-02/170-03 allow conservative JSON-like helper, 170-04 chooses scenario coverage and matrix updates. |

## Deferred/Excluded Items

| Source | Item | Reason |
|--------|------|--------|
| CONTEXT deferred | Graph edge classification, key-claims extraction, node analysis, contradiction assessment, graph-specific schemas. | Explicitly deferred to Graph Intelligence implementation. |
| CONTEXT deferred | Higher-order LLM retry helpers and dead-letter persistence. | Deferred unless a current Phase 170 call site can use them without broad flow changes; no plan introduces them. |
| CONTEXT deferred | Web UI, review surfaces, dashboards, database schema changes, global replacement of every `JSON.parse()`. | Explicitly out of scope. |
| REQ out of scope | `src/macro/registry.ts` strictness changes. | REQ-009 and D-14 require unchanged-regression tests only. |

## Result

No unplanned source items found.
