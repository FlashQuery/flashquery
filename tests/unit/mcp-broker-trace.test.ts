import { describe, expect, it } from 'vitest';
import {
  clearBrokerAuditTrace,
  getBrokerAuditTraceSnapshot,
  recordBrokerAuditEvent,
} from '../../src/services/mcp-broker/trace.js';

describe('mcp broker audit trace', () => {
  it('adds an ISO timestamp to audit events at the central recording boundary', () => {
    clearBrokerAuditTrace();
    const before = Date.now();

    recordBrokerAuditEvent({
      type: 'mcp_broker_tofu_blocked',
      server: 'brave_search',
      tool: 'web_search',
      status: 'blocked_on_user',
      old_hash: 'old',
      new_hash: 'new',
      trace_id: 'trace-1',
    });

    const [event] = getBrokerAuditTraceSnapshot();
    const after = Date.now();
    const ts = Date.parse(event?.ts ?? '');

    expect(event).toMatchObject({
      type: 'mcp_broker_tofu_blocked',
      server: 'brave_search',
      tool: 'web_search',
      ts: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(ts).toBeGreaterThanOrEqual(before - 1000);
    expect(ts).toBeLessThanOrEqual(after + 1000);
  });
});
