// McpBroker interface and a NullMcpBroker default (per REQ-062, golden patch
// item 21). This is the minimal surface the macro engine needs from the
// broker layer to perform live tool introspection (`_exists` probe — item 22)
// and brokered tool dispatch in the future. The production broker (a
// separate feature) will provide a full implementation; the golden ships
// with a Null implementation that satisfies the interface without doing
// anything.

import type { Value } from "./types.ts";

// Minimal `CallToolResult`-shaped envelope returned by brokered tool calls.
// Full MCP shape is richer; the golden uses just what the evaluator needs
// for the patch-list scope.
export type CallToolResult = {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Value;
  isError?: boolean;
};

// Options for the connectivity probe (REQ-109). `deepProbe: true` means the
// broker hits the server with a lightweight ping (a real tools/list call or
// similar) rather than just checking that the process is alive. A
// shallow probe (process-alive only) is INSUFFICIENT because a hung-but-
// alive server passes the shallow check but cannot respond — making the
// `if ! server._exists() then fail` guard a lie (POC Probe 8).
//
// Defaults: `deepProbe: true`, `timeoutMs: 250`. The macro engine wires
// these explicitly when calling `exists()` / `isConnected()` so the
// contract is unambiguous at the call site.
export type ExistsOptions = {
  deepProbe?: boolean;  // default true (REQ-109)
  timeoutMs?: number;   // default 250
};

export interface McpBroker {
  // Probe whether a brokered server is reachable / connected. Real brokers
  // hit the server with a lightweight ping (or check the stdio child is
  // alive). The golden's NullBroker returns false. Per REQ-109 the macro-
  // engine binding `<server>._exists()` MUST pass `{ deepProbe: true,
  // timeoutMs: 250 }`. The legacy single-number form (timeoutMs only) is
  // accepted for backward compatibility with the Phase 1 broker contract.
  exists(server: string, options?: ExistsOptions | number): Promise<boolean>;

  // Alias for `exists()` matching the production broker's name (per
  // REQ-109). Both names point at the same probe — `isConnected` is the
  // preferred spelling in the production engine; `exists` is the legacy
  // name kept for compatibility with Phase 1 callers.
  isConnected(server: string, options?: ExistsOptions): Promise<boolean>;

  // List the tools advertised by a brokered server. Used by `_list_tools`
  // (designed for, not yet shipped in the golden).
  listTools(server: string): Promise<string[]>;

  // Dispatch a brokered tool call. Returns a CallToolResult envelope; the
  // engine handles coercion via the §5.6.1 coerce path (REQ-106) plus the
  // fail-fast rule (REQ-107).
  callTool(server: string, tool: string, arg: Record<string, Value>): Promise<CallToolResult>;
}

// Null implementation — claims no servers exist, no tools advertised, throws
// on dispatch. Used when the macro evaluator is invoked without a real broker
// (the common golden-model standalone case). REQ-109: returns `false`
// regardless of options.
export class NullMcpBroker implements McpBroker {
  async exists(_server: string, _options?: ExistsOptions | number): Promise<boolean> {
    return false;
  }
  async isConnected(_server: string, _options?: ExistsOptions): Promise<boolean> {
    return false;
  }
  async listTools(_server: string): Promise<string[]> {
    return [];
  }
  async callTool(server: string, tool: string, _arg: Record<string, Value>): Promise<CallToolResult> {
    throw new Error(`NullMcpBroker cannot dispatch ${server}.${tool}`);
  }
}
