import { describe, expect, it } from 'vitest';
import { NullMcpBroker } from '../../src/services/mcp-broker.js';

describe('NullMcpBroker', () => {
  it('T-U-231 always reports brokered servers as disconnected', async () => {
    const broker = new NullMcpBroker();

    await expect(broker.isConnected('brave_search')).resolves.toBe(false);
    await expect(broker.isConnected('anything')).resolves.toBe(false);
  });

  it('T-U-232 never exposes a brokered tool handler', () => {
    const broker = new NullMcpBroker();

    expect(broker.getToolHandler('brave_search', 'web_search')).toBeNull();
    expect(broker.getToolHandler('anything', 'anything')).toBeNull();
  });
});
