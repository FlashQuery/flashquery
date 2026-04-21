import { describe, it, expect } from 'vitest';
import { serializeOrderedFrontmatter } from '../../src/mcp/utils/frontmatter-sanitizer.js';

describe('serializeOrderedFrontmatter', () => {
  it('removes all internal fields (content_hash, ownership_plugin_id, embedding, instance_id)', () => {
    const input = {
      fqc_id: 'test-uuid-1234',
      title: 'Test Doc',
      content_hash: 'sha256-abc123',
      ownership_plugin_id: 'plugin-xyz',
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      instance_id: 'instance-123',
      status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result).not.toHaveProperty('content_hash');
    expect(result).not.toHaveProperty('ownership_plugin_id');
    expect(result).not.toHaveProperty('embedding');
    expect(result).not.toHaveProperty('instance_id');
    expect(result.fqc_id).toBe('test-uuid-1234');
    expect(result.title).toBe('Test Doc');
    expect(result.status).toBe('active');
  });

  it('preserves user-provided fields', () => {
    const input = {
      fqc_id: 'test-uuid-1234',
      title: 'Test Doc',
      tags: ['tag1', 'tag2'],
      custom_field_1: 'value1',
      custom_field_2: 'value2',
      status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result.fqc_id).toBe('test-uuid-1234');
    expect(result.title).toBe('Test Doc');
    expect(result.tags).toEqual(['tag1', 'tag2']);
    expect(result.custom_field_1).toBe('value1');
    expect(result.custom_field_2).toBe('value2');
    expect(result.status).toBe('active');
  });

  it('maintains key order (preserved fields first)', () => {
    const input = {
      tags: ['tag1'],
      custom: 'value',
      fqc_id: 'test-uuid',
      title: 'Test Doc',
      status: 'active',
      created: '2026-04-12T00:00:00Z',
      updated: '2026-04-12T01:00:00Z',
    };

    const result = serializeOrderedFrontmatter(input);
    const keys = Object.keys(result);

    // Preserved order fields should come first (if they exist in input)
    const expectedStart = ['fqc_id', 'status', 'title', 'tags', 'created', 'updated'];
    const resultStart = keys.slice(0, expectedStart.length);

    expect(resultStart).toEqual(expectedStart);
    expect(keys).toContain('custom');
  });

  it('handles empty object', () => {
    const input = {};
    const result = serializeOrderedFrontmatter(input);
    expect(result).toEqual({});
  });

  it('strips instance_id and embedding fields', () => {
    const input = {
      fqc_id: 'test-uuid',
      title: 'Test Doc',
      instance_id: 'instance-123',
      embedding: JSON.stringify([0.1, 0.2]),
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result).not.toHaveProperty('instance_id');
    expect(result).not.toHaveProperty('embedding');
    expect(result.fqc_id).toBe('test-uuid');
    expect(result.title).toBe('Test Doc');
  });

  it('preserves fqc_instance (allowed field)', () => {
    const input = {
      fqc_id: 'test-uuid',
      fqc_instance: 'my-instance',
      content_hash: 'should-be-removed',
      title: 'Test Doc',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result.fqc_instance).toBe('my-instance');
    expect(result).not.toHaveProperty('content_hash');
  });

  it('does not mutate input object', () => {
    const input = {
      fqc_id: 'test-uuid',
      content_hash: 'sha256-abc',
      title: 'Test Doc',
    };

    const originalInput = { ...input };
    serializeOrderedFrontmatter(input);

    expect(input).toEqual(originalInput);
    expect(input).toHaveProperty('content_hash');
  });

  it('preserves nested objects and arrays', () => {
    const input = {
      fqc_id: 'test-uuid',
      tags: ['tag1', 'tag2', 'tag3'],
      custom_object: { nested: 'value' },
      status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result.tags).toEqual(['tag1', 'tag2', 'tag3']);
    expect(result.custom_object).toEqual({ nested: 'value' });
  });

  it('handles multiple DB-only fields in one call', () => {
    const input = {
      fqc_id: 'test-uuid',
      title: 'Test Doc',
      content_hash: 'hash1',
      ownership_plugin_id: 'plugin1',
      embedding: 'vector1',
      instance_id: 'inst1',
      status: 'active',
      tags: ['tag1'],
    };

    const result = serializeOrderedFrontmatter(input);

    const internalFields = [
      'content_hash',
      'ownership_plugin_id',
      'embedding',
      'instance_id',
    ];

    for (const field of internalFields) {
      expect(result).not.toHaveProperty(field);
    }

    expect(result.fqc_id).toBe('test-uuid');
    expect(result.title).toBe('Test Doc');
    expect(result.status).toBe('active');
    expect(result.tags).toEqual(['tag1']);
  });
});
