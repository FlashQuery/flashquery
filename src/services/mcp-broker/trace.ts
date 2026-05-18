import type { BrokerAuditEvent, BrokerAuditEventInput } from './types.js';

export interface BrokeredToolCallTraceEntry {
  server: string;
  tool: string;
  count: number;
  cost: number;
}

interface RecordBrokeredToolCallInput {
  traceId?: string | null;
  serverId: string;
  toolName: string;
  costPerCall?: number;
}

const _brokeredToolCalls = new Map<string, Map<string, BrokeredToolCallTraceEntry>>();
const _brokerAuditEvents: BrokerAuditEvent[] = [];

function traceKey(serverId: string, toolName: string): string {
  return `${serverId}\u0000${toolName}`;
}

export function recordBrokeredToolCall(input: RecordBrokeredToolCallInput): void {
  if (!input.traceId) return;
  const costPerCall = input.costPerCall ?? 0;
  const calls = _brokeredToolCalls.get(input.traceId) ?? new Map<string, BrokeredToolCallTraceEntry>();
  const key = traceKey(input.serverId, input.toolName);
  const existing = calls.get(key);
  const count = (existing?.count ?? 0) + 1;
  calls.set(key, {
    server: input.serverId,
    tool: input.toolName,
    count,
    cost: count * costPerCall,
  });
  _brokeredToolCalls.set(input.traceId, calls);
}

export function getBrokeredToolCallTraceSnapshot(traceId: string): BrokeredToolCallTraceEntry[] {
  return [...(_brokeredToolCalls.get(traceId)?.values() ?? [])].map((entry) => ({ ...entry }));
}

export function clearBrokeredToolCallTrace(traceId?: string): void {
  if (traceId === undefined) {
    _brokeredToolCalls.clear();
    return;
  }
  _brokeredToolCalls.delete(traceId);
}

export function recordBrokerAuditEvent(event: BrokerAuditEventInput): BrokerAuditEvent {
  const timestamped: BrokerAuditEvent = {
    ...event,
    ts: event.ts ?? new Date().toISOString(),
  } as BrokerAuditEvent;
  _brokerAuditEvents.push(structuredClone(timestamped));
  return timestamped;
}

export function getBrokerAuditTraceSnapshot(): BrokerAuditEvent[] {
  return _brokerAuditEvents.map((event) => structuredClone(event));
}

export function clearBrokerAuditTrace(): void {
  _brokerAuditEvents.length = 0;
}
