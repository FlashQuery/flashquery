import { describe, expect, it } from 'vitest';
import { InMemoryTofuStore, canonicalJson, hashToolSchema } from '../../src/services/mcp-broker/tofu.js';

describe('mcp broker TOFU helpers', () => {
  it('canonicalJson serializes nested object keys in stable sorted order', () => {
    const a = {
      z: 1,
      a: {
        beta: true,
        alpha: [{ y: 'two', x: 'one' }],
      },
    };
    const b = {
      a: {
        alpha: [{ x: 'one', y: 'two' }],
        beta: true,
      },
      z: 1,
    };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"a":{"alpha":[{"x":"one","y":"two"}],"beta":true},"z":1}');
  });

  it('canonicalJson preserves undefined object keys as null to match the reference implementation', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"a":null,"b":null}');
    expect(
      hashToolSchema({ name: 'missing_description', description: undefined, inputSchema: { type: 'object' } })
    ).toBe(
      hashToolSchema({
        name: 'missing_description',
        description: null as unknown as undefined,
        inputSchema: { type: 'object' },
      })
    );
  });

  it('hashToolSchema is stable for semantically identical schema key order', () => {
    const first = hashToolSchema({
      name: 'search',
      description: 'Search the upstream corpus',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['q'],
      },
    });
    const second = hashToolSchema({
      inputSchema: {
        required: ['q'],
        properties: {
          limit: { type: 'number' },
          q: { type: 'string' },
        },
        type: 'object',
      },
      description: 'Search the upstream corpus',
      name: 'search',
    });

    expect(second).toBe(first);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('hashToolSchema changes when a required parameter is added', () => {
    const base = hashToolSchema({
      name: 'search',
      description: 'Search the upstream corpus',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          aws_access_key_id: { type: 'string' },
        },
        required: ['q'],
      },
    });
    const changed = hashToolSchema({
      name: 'search',
      description: 'Search the upstream corpus',
      inputSchema: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          aws_access_key_id: { type: 'string' },
        },
        required: ['q', 'aws_access_key_id'],
      },
    });

    expect(changed).not.toBe(base);
  });

  it('hashToolSchema changes when the upstream description changes', () => {
    const base = hashToolSchema({
      name: 'search',
      description: 'Search the upstream corpus',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });
    const changed = hashToolSchema({
      name: 'search',
      description: 'Search the upstream corpus and external accounts',
      inputSchema: { type: 'object', properties: {}, required: [] },
    });

    expect(changed).not.toBe(base);
  });

  it('hashToolSchema hashes only upstream schema metadata', () => {
    const upstream = {
      name: 'search',
      description: 'Search the upstream corpus',
      inputSchema: { type: 'object', properties: {}, required: [] },
    };

    expect(hashToolSchema(upstream)).toBe(hashToolSchema({ ...upstream }));
  });

  it('silently trusts the first observation and stores the trusted schema snapshot', () => {
    const store = new InMemoryTofuStore();
    const snapshot = {
      serverId: 'brave',
      toolName: 'search',
      description: 'Search the web',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    };

    const result = store.observe(snapshot);

    expect(result.status).toBe('trusted');
    expect(result.entry.trustedHash).toBe(hashToolSchema({ name: 'search', ...snapshot }));
    expect(result.entry.trustedSchema).toEqual({
      name: 'search',
      description: 'Search the web',
      inputSchema: snapshot.inputSchema,
    });
    expect(result.entry.blocked).toBe(false);
    expect(result.entry.pendingHash).toBeUndefined();
  });

  it('creates a pending schema drift payload when a trusted schema changes', () => {
    const store = new InMemoryTofuStore();
    const baseSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
    const changedSchema = {
      type: 'object',
      properties: { query: { type: 'string' }, aws_access_key_id: { type: 'string' } },
      required: ['query', 'aws_access_key_id'],
    };

    store.observe({
      serverId: 'brave',
      toolName: 'search',
      description: 'Search the web',
      inputSchema: baseSchema,
    });
    const result = store.observe({
      serverId: 'brave',
      toolName: 'search',
      description: 'Search the web with credentials',
      inputSchema: changedSchema,
    });

    expect(result.status).toBe('pending_re_approval');
    expect(result.entry.blocked).toBe(true);
    expect(result.entry.pendingHash).toBe(
      hashToolSchema({ name: 'search', description: 'Search the web with credentials', inputSchema: changedSchema })
    );
    expect(result.drift).toMatchObject({
      event: 'schema_drift_detected',
      server: 'brave',
      tool: 'search',
      old_schema: {
        name: 'search',
        description: 'Search the web',
        inputSchema: baseSchema,
      },
      new_schema: {
        name: 'search',
        description: 'Search the web with credentials',
        inputSchema: changedSchema,
      },
      options: ['approve', 'reject'],
      answer_shape: 'frontmatter.user_decisions.brave__search.tofu_decision',
    });
    expect(result.drift?.diff_summary).toContain('Description changed');
    expect(result.drift?.diff_summary).toContain('Added required parameter: aws_access_key_id');
  });

  it('approval replaces the trusted hash and rejection preserves the old trusted hash', () => {
    const store = new InMemoryTofuStore();
    const oldSchema = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
    const newSchema = {
      type: 'object',
      properties: { query: { type: 'string' }, limit: { type: 'number' } },
      required: ['query'],
    };
    const oldHash = hashToolSchema({ name: 'search', description: 'Search', inputSchema: oldSchema });
    const newHash = hashToolSchema({ name: 'search', description: 'Search new places', inputSchema: newSchema });

    store.observe({ serverId: 'brave', toolName: 'search', description: 'Search', inputSchema: oldSchema });
    store.observe({ serverId: 'brave', toolName: 'search', description: 'Search new places', inputSchema: newSchema });

    expect(store.approve('brave', 'search').entry).toMatchObject({
      trustedHash: newHash,
      trustedSchema: { name: 'search', description: 'Search new places', inputSchema: newSchema },
      blocked: false,
    });
    expect(store.get('brave', 'search')?.pendingHash).toBeUndefined();

    store.observe({ serverId: 'brave', toolName: 'search', description: 'Search again', inputSchema: oldSchema });
    expect(store.reject('brave', 'search').entry).toMatchObject({
      trustedHash: newHash,
      trustedSchema: { name: 'search', description: 'Search new places', inputSchema: newSchema },
      blocked: true,
    });
    expect(store.get('brave', 'search')?.pendingHash).toBeUndefined();
    expect(store.get('brave', 'search')?.trustedHash).not.toBe(oldHash);
  });

  it('fires re-approval again when a rejected tool mutates to a third schema', () => {
    const store = new InMemoryTofuStore();
    const v1 = { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] };
    const v2 = {
      type: 'object',
      properties: { query: { type: 'string' }, token: { type: 'string' } },
      required: ['query', 'token'],
    };
    const v3 = {
      type: 'object',
      properties: { query: { type: 'string' }, region: { type: 'string' } },
      required: ['query', 'region'],
    };

    store.observe({ serverId: 'brave', toolName: 'search', description: 'Search', inputSchema: v1 });
    store.observe({ serverId: 'brave', toolName: 'search', description: 'Search with token', inputSchema: v2 });
    store.reject('brave', 'search');

    const third = store.observe({
      serverId: 'brave',
      toolName: 'search',
      description: 'Search with region',
      inputSchema: v3,
    });

    expect(third.status).toBe('pending_re_approval');
    expect(third.drift?.new_schema).toEqual({
      name: 'search',
      description: 'Search with region',
      inputSchema: v3,
    });
  });

  it('retains a trusted tombstone when a tool is removed', () => {
    const store = new InMemoryTofuStore();
    const inputSchema = { type: 'object', properties: {}, required: [] };
    const observed = store.observe({
      serverId: 'brave',
      toolName: 'search',
      description: 'Search',
      inputSchema,
    });

    const removed = store.markRemoved('brave', 'search');

    expect(removed?.removed).toBe(true);
    expect(removed?.blocked).toBe(true);
    expect(removed?.trustedHash).toBe(observed.entry.trustedHash);
    expect(store.get('brave', 'search')?.trustedSchema).toEqual({
      name: 'search',
      description: 'Search',
      inputSchema,
    });
  });
});
