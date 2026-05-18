import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type BrokerTransport = 'stdio';

export interface BrokerToolOverrideConfig {
  costPerCall: number;
  descriptionOverride?: string;
}

export interface BrokerServerConfig {
  transport: BrokerTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  costPerCall: number;
  perCallTimeoutMs: number;
  toolOverrides: Record<string, BrokerToolOverrideConfig>;
}

export interface BrokerClientConfig extends BrokerServerConfig {
  serverId: string;
  onAudit?: (event: BrokerAuditEvent) => void;
}

export type RegistryKey = string;

export interface BrokerToolRef {
  serverId: string;
  toolName: string;
}

export type ConsumerContext =
  | { kind: 'host'; traceId: string }
  | { kind: 'purpose'; purposeId: string; traceId: string };

export interface BrokeredTool {
  serverId: string;
  toolName: string;
  registryKey: RegistryKey;
  description?: string;
  upstreamDescription?: string;
  inputSchema: unknown;
  tofuHash: string;
  costPerCall: number;
}

export interface BrokerConnectionOptions {
  deepProbe?: boolean;
  timeoutMs?: number;
}

export type ToolErrorKind =
  | 'is_error_result'
  | 'unsupported_method'
  | 'bad_args'
  | 'transport_closed'
  | 'server_timeout'
  | 'server_crashed'
  | 'unknown_tool'
  | 'unknown_server'
  | 'schema_drift'
  | 'unknown';

export interface NormalizedToolError {
  kind: ToolErrorKind;
  message: string;
  serverId?: string;
  toolName?: string;
  code?: number | string;
  subkind?: string;
  raw?: unknown;
}

export interface Broker {
  ensureConnected(serverId: string): Promise<void>;
  callTool(ref: BrokerToolRef, args: unknown, ctx: ConsumerContext): Promise<CallToolResult>;
  isConnected(serverId: string, opts?: BrokerConnectionOptions): Promise<boolean>;
  listToolsForConsumer(ctx: ConsumerContext): Promise<BrokeredTool[]>;
  shutdown(graceMs?: number): Promise<void>;
}

export interface BrokerAuditEvent {
  type: 'mcp_broker_reverse_request_rejected';
  serverId: string;
  method: string;
  status: 'rejected_unsupported';
  traceId?: string;
  purposeId?: string;
}
