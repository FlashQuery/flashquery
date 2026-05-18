import { describe, expect, it } from 'vitest';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

describe('NullMcpBroker', () => {
  it('T-U-231 always reports brokered servers as disconnected', async () => {
    const broker = new NullMcpBroker();

    await expect(broker.isConnected('brave_search')).resolves.toBe(false);
    await expect(broker.isConnected('anything')).resolves.toBe(false);
  });

  it('T-U-232 never exposes brokered tools to consumers', async () => {
    const broker = new NullMcpBroker();

    await expect(broker.listToolsForConsumer({ kind: 'host', traceId: 'trace-null-broker' })).resolves.toEqual([]);
  });
});
