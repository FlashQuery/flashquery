import { describe, expect, it } from 'vitest';
import {
  ToolRegistry,
  isRegistryKey,
  makeRegistryKey,
  parseMacroRef,
  parseRegistryKey,
} from '../../src/services/mcp-broker/registry.js';

describe('mcp broker registry utilities', () => {
  it('T-U-006 parses macro refs by splitting on the first dot', () => {
    expect(parseMacroRef('brave_search.web_search_v2')).toEqual({
      serverId: 'brave_search',
      toolName: 'web_search_v2',
    });
    expect(parseMacroRef('server.tool.with.dot')).toEqual({
      serverId: 'server',
      toolName: 'tool.with.dot',
    });
    expect(() => parseMacroRef('no_dot_here')).toThrow(/Invalid broker tool ref/);
    expect(() => parseMacroRef('.missing_server')).toThrow(/Invalid broker tool ref/);
    expect(() => parseMacroRef('missing_tool.')).toThrow(/Invalid broker tool ref/);
  });

  it('T-U-007 creates and parses stable double-underscore registry keys', () => {
    expect(makeRegistryKey('brave_search', 'web_search')).toBe('brave_search__web_search');
    expect(isRegistryKey('brave_search__web_search')).toBe(true);
    expect(parseRegistryKey('brave_search__web_search')).toEqual({
      serverId: 'brave_search',
      toolName: 'web_search',
    });
    expect(() => parseRegistryKey('brave_search.web_search')).toThrow(/Invalid broker registry key/);
  });

  it('T-U-046 keeps FQ-native tool names bare instead of fq-prefixed registry keys', () => {
    expect(ToolRegistry.nativeToolName('write_document')).toBe('write_document');
    expect(() => makeRegistryKey('fq', 'write_document')).toThrow(/FQ-native tools are not broker registry keys/);
  });

  it('T-U-047 keeps colliding tool names distinct across servers', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        a: { costPerCall: 0.1 },
        b: { costPerCall: 0.2 },
      },
      host: { mcpServers: ['a', 'b'] },
    });

    registry.registerTool({
      serverId: 'a',
      toolName: 'search',
      description: 'Search from A',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-a',
    });
    registry.registerTool({
      serverId: 'b',
      toolName: 'search',
      description: 'Search from B',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-b',
    });

    expect(registry.get('a', 'search')?.registryKey).toBe('a__search');
    expect(registry.get('b', 'search')?.registryKey).toBe('b__search');
    expect(registry.listToolsForConsumer({ kind: 'host', traceId: 'trace' }).map((tool) => tool.registryKey)).toEqual([
      'a__search',
      'b__search',
    ]);
  });

  it('T-U-036 filters host views to host.mcp_servers and excludes hidden servers', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        brave_search: {
          costPerCall: 0.25,
          toolOverrides: {
            web_search: {
              costPerCall: 0.5,
              descriptionOverride: 'Search with Brave',
            },
          },
        },
        github: { costPerCall: 0.75 },
        slack: { costPerCall: 0.9 },
      },
      host: { mcpServers: ['brave_search'] },
      llm: {
        purposes: [
          { name: 'research', mcpServers: ['brave_search', 'github'] },
          { name: 'coding', mcpServers: ['github'] },
        ],
      },
    });
    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      description: 'Upstream Brave description',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-brave',
    });
    registry.registerTool({
      serverId: 'github',
      toolName: 'search',
      description: 'GitHub search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-github',
    });
    registry.registerTool({
      serverId: 'slack',
      toolName: 'post_message',
      description: 'Slack post',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-slack',
    });

    const hostTools = registry.listToolsForConsumer({ kind: 'host', traceId: 'trace-host' });

    expect(hostTools.map((tool) => tool.registryKey)).toEqual(['brave_search__web_search']);
    expect(hostTools[0]).toMatchObject({
      description: 'Search with Brave',
      upstreamDescription: 'Upstream Brave description',
      costPerCall: 0.5,
      tofuHash: 'hash-brave',
    });
    hostTools[0].description = 'mutated copy';
    expect(registry.get('brave_search', 'web_search')?.description).toBe('Search with Brave');
  });

  it('T-U-037 filters purpose views to their own mcp_servers and keeps returned tools cloned', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        brave_search: {
          costPerCall: 0.25,
          toolOverrides: {
            web_search: {
              costPerCall: 0.5,
              descriptionOverride: 'Search with Brave',
            },
          },
        },
        github: { costPerCall: 0.75 },
        slack: { costPerCall: 0.9 },
      },
      host: { mcpServers: ['brave_search'] },
      llm: {
        purposes: [
          { name: 'research', mcpServers: ['github'] },
          { name: 'ops', mcpServers: ['slack'] },
        ],
      },
    });
    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      description: 'Upstream Brave description',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-brave',
    });
    registry.registerTool({
      serverId: 'github',
      toolName: 'search',
      description: 'GitHub search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-github',
    });
    registry.registerTool({
      serverId: 'slack',
      toolName: 'post_message',
      description: 'Slack post',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-slack',
    });

    const hostTools = registry.listToolsForConsumer({ kind: 'host', traceId: 'trace-host' });
    hostTools[0].description = 'mutated host-view copy';

    const researchTools = registry.listToolsForConsumer({
      kind: 'purpose',
      purposeId: 'research',
      traceId: 'trace-research',
    });
    const opsTools = registry.listToolsForConsumer({ kind: 'purpose', purposeId: 'ops', traceId: 'trace-ops' });

    expect(researchTools.map((tool) => tool.registryKey)).toEqual(['github__search']);
    expect(researchTools.map((tool) => tool.registryKey)).not.toContain('brave_search__web_search');
    expect(researchTools.map((tool) => tool.registryKey)).not.toContain('slack__post_message');
    expect(opsTools.map((tool) => tool.registryKey)).toEqual(['slack__post_message']);
    expect(registry.get('brave_search', 'web_search')?.description).toBe('Search with Brave');
  });

  it('removes a blocked tool from host and purpose consumer views', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        brave_search: { costPerCall: 0 },
      },
      host: { mcpServers: ['brave_search'] },
      llm: {
        purposes: [{ name: 'research', mcpServers: ['brave_search'] }],
      },
    });
    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      description: 'Search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-old',
    });

    expect(registry.hasTool('brave_search', 'web_search')).toBe(true);
    expect(registry.unregisterTool('brave_search', 'web_search')).toBe(true);

    expect(registry.hasTool('brave_search', 'web_search')).toBe(false);
    expect(registry.get('brave_search', 'web_search')).toBeUndefined();
    expect(registry.listToolsForConsumer({ kind: 'host', traceId: 'trace-host' })).toEqual([]);
    expect(
      registry.listToolsForConsumer({ kind: 'purpose', purposeId: 'research', traceId: 'trace-research' })
    ).toEqual([]);
  });

  it('re-registering an approved tool restores consumer visibility', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        brave_search: { costPerCall: 0 },
      },
      host: { mcpServers: ['brave_search'] },
    });
    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      description: 'Search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-old',
    });
    registry.unregisterTool('brave_search', 'web_search');

    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      description: 'Search approved schema',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      tofuHash: 'hash-new',
    });

    expect(registry.hasTool('brave_search', 'web_search')).toBe(true);
    expect(registry.listToolsForConsumer({ kind: 'host', traceId: 'trace-host' })).toMatchObject([
      {
        serverId: 'brave_search',
        toolName: 'web_search',
        description: 'Search approved schema',
        tofuHash: 'hash-new',
      },
    ]);
  });

  it('unregisterTools removes multiple server/tool refs and tolerates missing entries', () => {
    const registry = new ToolRegistry({
      mcpServers: {
        brave_search: { costPerCall: 0 },
        github: { costPerCall: 0 },
      },
      host: { mcpServers: ['brave_search', 'github'] },
    });
    registry.registerTool({
      serverId: 'brave_search',
      toolName: 'web_search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-brave',
    });
    registry.registerTool({
      serverId: 'github',
      toolName: 'search',
      inputSchema: { type: 'object' },
      tofuHash: 'hash-github',
    });

    const removed = registry.unregisterTools([
      { serverId: 'brave_search', toolName: 'web_search' },
      { serverId: 'missing', toolName: 'tool' },
      makeRegistryKey('github', 'search'),
    ]);

    expect(removed).toEqual(['brave_search__web_search', 'github__search']);
    expect(registry.listToolsForConsumer({ kind: 'host', traceId: 'trace-host' })).toEqual([]);
  });
});
