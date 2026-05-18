---
phase: 140-tofu-schema-pinning-and-tool-list-change-handling
status: planned
created: 2026-05-18
---

# Phase 140 Source Coverage Audit

Canonical source priority: `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` and `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md` override generated phase artifacts on conflict.

## GOAL Coverage

| Source Item | Covered By |
|---|---|
| Always-on in-memory TOFU protection | 140-01, 140-02, 140-04 |
| Schema-drift blocking from callable/indexed surfaces | 140-01, 140-02, 140-04 |
| Re-approval signaling with old/new schema and diff summary | 140-03, 140-05, 140-06 |
| `notifications/tools/list_changed` routing | 140-02, 140-04 |
| Phase B tests including approval, rejection, autonomous blocking, audit logging | 140-04, 140-05, 140-06 |

## REQ Coverage

| Requirement IDs | Covered By |
|---|---|
| REQ-038..049 | 140-01, 140-02, 140-03, 140-04, 140-05, 140-06 |
| REQ-061..064 | 140-01, 140-02, 140-04, 140-06 |
| REQ-068 | 140-02, 140-04, 140-06 |
| REQ-070 | 140-03, 140-04, 140-05, 140-06 |
| REQ-105 | 140-03, 140-05, 140-06 |

## RESEARCH Coverage

| Research Item | Covered By |
|---|---|
| Broker-owned in-memory TOFU state machine | 140-01 |
| Manual SDK list_changed handler with explicit refresh | 140-02 |
| Registry visibility as callable gate | 140-01, 140-02 |
| Synchronous no-op index sink seam for Phase 141 BM25 | 140-01, 140-02, 140-04 |
| Macro `needs_user_input` propagation path | 140-03, 140-05, 140-06 |
| Audit records for decisions and blocked autonomous drift | 140-03, 140-04, 140-05 |

## CONTEXT Decision Coverage

| Decision | Covered By |
|---|---|
| Canonical MCP Broker docs must be read first | Every task in 140-01 through 140-06 includes both docs in `<read_first>`. |
| Persistent TOFU out of scope | 140-01 and 140-03 explicitly prohibit vault/Supabase/filesystem persistence. |
| Hash upstream description, not `description_override` | 140-01 and 140-04 cover source and integration assertions. |
| Bulk list_changed re-approval payload | 140-02, 140-03, 140-04 |
| Autonomous no-live-chat blocks and records `blocked_on_user` | 140-03, 140-04 |
| Phase B test set | 140-01, 140-04, 140-05, 140-06 |

## Test ID Coverage

| Test IDs | Covered By |
|---|---|
| T-U-035 | 140-01 |
| T-I-004..007 | 140-02, 140-04 |
| T-I-013..020 | 140-04 |
| T-I-027, T-I-032a, T-I-032b | 140-04 |
| T-E-B1 | 140-05 |
| T-S-003, T-S-004, T-S-005, T-S-017 | 140-05 |
| T-Y-012 | 140-06 |

## Exclusions

Deferred and excluded by source artifacts: persistent TOFU storage, HTTP transport, OAuth/DCR, MCP resources/prompts/sampling forwarding, semantic vector routing, hot-reload, BM25 implementation, and host surface registration.
