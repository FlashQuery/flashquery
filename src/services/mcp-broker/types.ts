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
  onToolListChanged?: (serverId: string, tools: BrokeredTool[]) => void | Promise<void>;
}

export type RegistryKey = string;

export interface BrokerToolRef {
  serverId: string;
  toolName: string;
}

export type ConsumerContext =
  | { kind: 'host'; traceId: string; interactive?: boolean }
  | { kind: 'purpose'; purposeId: string; traceId: string; interactive?: boolean };

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

export type TofuDecision = 'approve' | 'reject';

export interface TofuToolSchemaSnapshot {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface TofuDriftPayload {
  event: 'schema_drift_detected';
  server: string;
  tool: string;
  question: string;
  old_schema: TofuToolSchemaSnapshot;
  new_schema: TofuToolSchemaSnapshot;
  diff_summary: string;
  options: ['approve', 'reject'];
  answer_shape: string;
}

export interface TofuDriftBundle {
  event: 'schema_drift_detected';
  server: string;
  changes: TofuDriftPayload[];
}

export class SchemaDriftNeedsUserInputError extends Error {
  constructor(public readonly payload: TofuDriftPayload | TofuDriftBundle) {
    super('Brokered tool schema drift requires user input.');
    this.name = 'SchemaDriftNeedsUserInputError';
  }
}

export interface TofuEntry {
  serverId: string;
  toolName: string;
  trustedHash: string;
  trustedSchema: TofuToolSchemaSnapshot;
  pendingHash?: string;
  pendingSchema?: TofuToolSchemaSnapshot;
  rejectedHash?: string;
  rejectedSchema?: TofuToolSchemaSnapshot;
  blocked: boolean;
  removed: boolean;
}

export type TofuObservationStatus = 'trusted' | 'pending_re_approval' | 'blocked';

export interface TofuObservationResult {
  status: TofuObservationStatus;
  key: string;
  entry: TofuEntry;
  drift?: TofuDriftPayload;
}

export interface ToolIndexSink {
  addTools(tools: BrokeredTool[]): void;
  removeTools(keys: RegistryKey[]): void;
}

export interface SchemaDriftDecisionInput {
  server: string;
  tool: string;
  decision: TofuDecision;
}

export interface SchemaDriftResolution {
  server: string;
  tool: string;
  decision: TofuDecision;
}

export interface SchemaDriftResolutionContext {
  traceId?: string;
  purposeId?: string;
}

export interface ToolListSnapshotOptions {
  interactive?: boolean;
  traceId?: string;
  purposeId?: string;
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
  ensureConnected(serverId: string, options?: ToolListSnapshotOptions): Promise<void>;
  callTool(ref: BrokerToolRef, args: unknown, ctx: ConsumerContext): Promise<CallToolResult>;
  isConnected(serverId: string, opts?: BrokerConnectionOptions): Promise<boolean>;
  listToolsForConsumer(ctx: ConsumerContext): Promise<BrokeredTool[]>;
  getPendingSchemaDrift(ctx?: SchemaDriftResolutionContext): TofuDriftPayload[];
  resolveSchemaDrift(
    decisions: SchemaDriftDecisionInput[],
    ctx?: SchemaDriftResolutionContext
  ): SchemaDriftResolution[];
  shutdown(graceMs?: number): Promise<void>;
}

export type BrokerAuditEvent =
  | {
      ts: string;
      type: 'mcp_broker_reverse_request_rejected';
      serverId: string;
      method: string;
      status: 'rejected_unsupported';
      traceId?: string;
      purposeId?: string;
    }
  | {
      ts: string;
      type: 'mcp_broker_tofu_decision';
      server: string;
      tool: string;
      decision: TofuDecision;
      old_hash: string;
      new_hash: string;
      trace_id?: string;
      purpose_id?: string;
    }
  | {
      ts: string;
      type: 'mcp_broker_tofu_blocked';
      server: string;
      tool: string;
      status: 'blocked_on_user';
      old_hash: string;
      new_hash: string;
      trace_id?: string;
      purpose_id?: string;
    };

export type BrokerAuditEventInput =
  | (Omit<Extract<BrokerAuditEvent, { type: 'mcp_broker_reverse_request_rejected' }>, 'ts'> & { ts?: string })
  | (Omit<Extract<BrokerAuditEvent, { type: 'mcp_broker_tofu_decision' }>, 'ts'> & { ts?: string })
  | (Omit<Extract<BrokerAuditEvent, { type: 'mcp_broker_tofu_blocked' }>, 'ts'> & { ts?: string });
