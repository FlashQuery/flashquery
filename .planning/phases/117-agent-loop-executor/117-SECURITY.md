---
phase: 117
slug: agent-loop-executor
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-06
---

# Phase 117 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Host-authored `call_model` request -> delegated model | Host messages and hydrated references are sent to the configured provider. | User prompt/reference content; provider-visible tool schemas. |
| Delegated model -> native tool dispatcher | Model returns tool-call names and arguments. | Untrusted model-produced JSON tool-call payloads. |
| Native dispatcher -> FlashQuery MCP handlers | Approved native tools invoke internal handlers. | Validated arguments, abort signal, trace/instance context. |
| Loop executor -> usage accounting | Completed loop writes one aggregate usage row. | Aggregate tokens, cost, latency, model/provider/fallback metadata. |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-117-01 | Elevation of Privilege | Dispatcher registry lookup / Mode 2 branch | mitigate | `assembleNativeToolRegistry()` preserves hard exclusions; `dispatchNativeToolCall()` requires the tool name to appear in immutable `nativeToolNames` and the captured catalog before handler invocation. Unit/E2E tests cover caller-provided tool rejection and registry-limited dispatch. | closed |
| T-117-02 | Tampering | Tool argument validation | mitigate | `dispatchNativeToolCall()` parses model arguments through the registered Zod schema/raw shape before invoking handlers; invalid arguments become recoverable JSON tool errors. Dispatcher tests cover invalid arguments and handler errors. | closed |
| T-117-03 | Information Disclosure | Model-produced references in tool args/results | mitigate | Reference hydration remains host-only before loop execution. The executor and dispatcher never call the reference resolver on assistant messages, tool arguments, or tool results. Directed/native tests cover literal model-produced reference payload behavior. | closed |
| T-117-04 | Denial of Service | Provider/tool loop guardrails | mitigate | `executeAgentLoop()` enforces timeout, max iterations, max token budget, and max cost budget before additional model calls; review fix routes the loop `AbortSignal` into in-flight provider calls and seeds first-call cost estimates from the selected purpose model. Unit, E2E, directed, lint, and full unit gates passed. | closed |
| T-117-05 | Repudiation/Tampering | Usage aggregation and trace metadata | mitigate | Mode 2 uses `chatByPurposeUnrecorded()` and writes one aggregate `recordLlmUsage()` row. Calls-log token sums equal public aggregate metadata; review fix stamps final metadata/usage from the latest successful fallback result. Unit and E2E tests cover aggregate/fallback accounting. | closed |

## Accepted Risks Log

No accepted risks.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-06 | 5 | 5 | 0 | Codex local verification |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-06

