# Phase 142 Source Coverage Audit

## Source Items

| Source | Item | Coverage |
|--------|------|----------|
| GOAL | Expose brokered tools to the host MCP surface and unify consumer-aware filtering, tracing, and lazy-spawn behavior across host and delegated callers. | Plans 142-02, 142-03, 142-04, 142-05 |
| REQ | REQ-005, REQ-006, REQ-007, REQ-008, REQ-009, REQ-010 | Plans 142-01, 142-02, 142-05, 142-06 |
| REQ | REQ-031, REQ-035 | Plans 142-01, 142-02, 142-04, 142-05, 142-06 |
| REQ | REQ-065, REQ-066, REQ-067 | Plans 142-02, 142-03, 142-05, 142-06 |
| REQ | REQ-113, REQ-114, REQ-115, REQ-116, REQ-117, REQ-118 | Plans 142-01, 142-02, 142-03, 142-04, 142-05, 142-06 |
| RESEARCH | Host brokered registration gap in `src/mcp/server.ts` | Plan 142-02 |
| RESEARCH | Consumer filtering via shared `Broker.listToolsForConsumer(ctx)` | Plans 142-01, 142-02, 142-04 |
| RESEARCH | Host/direct and delegated `tool_calls` trace coverage | Plans 142-03, 142-05, 142-06 |
| RESEARCH | Host search index lifecycle and list_changed behavior | Plan 142-04 |
| RESEARCH | Directed/YAML Phase D gates and ledger updates | Plan 142-05 |
| CONTEXT | Mandatory downstream reading of MCP Broker Requirements and Test Plan | Every PLAN task includes both files in `<read_first>` and plan notes |
| CONTEXT | `host:` peer section, additive with `host_mcp_tools` | Plans 142-01, 142-02, 142-05 |
| CONTEXT | ConsumerContext carries trace scope and `interactive`; inherited across nested macro frames | Plan 142-03 |
| CONTEXT | Host and delegated consumers share server instances and TOFU pins | Plan 142-04 |
| CONTEXT | Host-direct drift bundling parity from Phase 140 | Plan 142-02 |
| CONTEXT | Trace/cost metadata for host, delegated, and host macro paths | Plans 142-02, 142-03, 142-05 |

## Deferred Ideas Excluded

- Per-tool subsetting in `host.mcp_servers` or `purposes.<name>.mcp_servers`.
- Persistent TOFU across FlashQuery restarts.
- Streamable HTTP transport, OAuth/DCR, MCP resources/prompts/sampling/elicitation forwarding, and semantic vector tool routing.

## Audit Result

No unplanned source items found.
