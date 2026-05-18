# Carry-Forward From Phase 141

## REQ-100b -- Host MCP surface description_override substitution

**Source:** [MCP Broker Gap Analysis.md](../../../../../flashquery-product/Roadmap/Features/MCP%20Broker/MCP%20Broker%20Gap%20Analysis.md) Gap 6 + Gap 7.D.

**Constraint:** When the host MCP surface registers a brokered tool (Phase 142's new host registration path, REQ-113..118), the registered description MUST be `BrokeredTool.description` -- which already reflects `description_override` per the broker registry at [src/services/mcp-broker/registry.ts](../../../src/services/mcp-broker/registry.ts).

**MUST NOT:** Re-fetch the upstream description at host registration time.

**Verification:** T-Y-010 (already in test plan §2.6) must assert that for a brokered tool with `description_override: "X"`, the host MCP `tools/list` response shows "X" as the registered description, not the upstream original.

**Audit gate:** Before signing Phase 142 off, re-verify Gap 6 in the Gap Analysis (currently marked OPEN by the Phase 141 auditor) and update its Auditor Verification section with a Phase 142 status update.
