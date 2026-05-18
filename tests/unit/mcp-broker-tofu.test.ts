import { describe, expect, it } from 'vitest';
import { canonicalJson, hashToolSchema } from '../../src/services/mcp-broker/tofu.js';

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
});
