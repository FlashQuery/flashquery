import { describe, expect, it } from 'vitest';
import { diffToolSnapshots } from '../../src/services/mcp-broker/diff.js';
import { hashToolSchema } from '../../src/services/mcp-broker/tofu.js';

function tool(serverId: string, toolName: string, description: string) {
  return {
    serverId,
    toolName,
    description,
    upstreamDescription: description,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
    },
    tofuHash: hashToolSchema({
      name: toolName,
      description,
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
        },
        required: ['query'],
      },
    }),
  };
}

describe('mcp broker tool snapshot diff', () => {
  it('T-U-035 classifies added, changed, removed, and unchanged tools', () => {
    const a = tool('alpha', 'a', 'Tool A');
    const b = tool('alpha', 'b', 'Tool B');
    const c = tool('alpha', 'c', 'Tool C');
    const bChanged = tool('alpha', 'b', 'Tool B changed');
    const d = tool('alpha', 'd', 'Tool D');

    const diff = diffToolSnapshots([a, b, c], [a, bChanged, d]);

    expect(diff.added.map((entry) => entry.toolName)).toEqual(['d']);
    expect(diff.changed.map((entry) => entry.toolName)).toEqual(['b']);
    expect(diff.removed.map((entry) => entry.toolName)).toEqual(['c']);
    expect(diff.unchanged.map((entry) => entry.toolName)).toEqual(['a']);
  });

  it('returns classifications in stable identity order regardless of input order', () => {
    const alphaA = tool('alpha', 'a', 'Tool A');
    const alphaB = tool('alpha', 'b', 'Tool B');
    const betaA = tool('beta', 'a', 'Tool A');
    const betaB = tool('beta', 'b', 'Tool B');
    const alphaBChanged = tool('alpha', 'b', 'Tool B changed');
    const gammaA = tool('gamma', 'a', 'Tool A');

    const first = diffToolSnapshots([betaA, alphaB, alphaA], [gammaA, alphaBChanged, alphaA, betaB]);
    const second = diffToolSnapshots([alphaA, betaA, alphaB], [betaB, alphaA, gammaA, alphaBChanged]);

    expect(first).toEqual(second);
    expect(first.added.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['beta:b', 'gamma:a']);
    expect(first.changed.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['alpha:b']);
    expect(first.removed.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['beta:a']);
    expect(first.unchanged.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['alpha:a']);
  });

  it('uses server ID plus upstream tool name as identity', () => {
    const oldSearch = tool('alpha', 'search', 'Alpha search');
    const newSearch = tool('beta', 'search', 'Alpha search');

    const diff = diffToolSnapshots([oldSearch], [newSearch]);

    expect(diff.added.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['beta:search']);
    expect(diff.removed.map((entry) => `${entry.serverId}:${entry.toolName}`)).toEqual(['alpha:search']);
    expect(diff.changed).toEqual([]);
    expect(diff.unchanged).toEqual([]);
  });
});
