import { describe, it, expect } from 'vitest';
import { serializeOrderedFrontmatter } from '../../src/mcp/utils/frontmatter-sanitizer.js';
import { FM } from '../../src/constants/frontmatter-fields.js';

describe('serializeOrderedFrontmatter', () => {
  it('removes all internal fields (content_hash, ownership_plugin_id, embedding, instance_id)', () => {
    const input = {
      fq_id: 'test-uuid-1234',
      fq_title: 'Test Doc',
      content_hash: 'sha256-abc123',
      ownership_plugin_id: 'plugin-xyz',
      embedding: JSON.stringify([0.1, 0.2, 0.3]),
      instance_id: 'instance-123',
      fq_status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result).not.toHaveProperty('content_hash');
    expect(result).not.toHaveProperty('ownership_plugin_id');
    expect(result).not.toHaveProperty('embedding');
    expect(result).not.toHaveProperty('instance_id');
    expect(result[FM.ID]).toBe('test-uuid-1234');
    expect(result[FM.TITLE]).toBe('Test Doc');
    expect(result[FM.STATUS]).toBe('active');
  });

  it('preserves user-provided fields', () => {
    const input = {
      fq_id: 'test-uuid-1234',
      fq_title: 'Test Doc',
      fq_tags: ['tag1', 'tag2'],
      custom_field_1: 'value1',
      custom_field_2: 'value2',
      fq_status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result[FM.ID]).toBe('test-uuid-1234');
    expect(result[FM.TITLE]).toBe('Test Doc');
    expect(result[FM.TAGS]).toEqual(['tag1', 'tag2']);
    expect(result.custom_field_1).toBe('value1');
    expect(result.custom_field_2).toBe('value2');
    expect(result[FM.STATUS]).toBe('active');
  });

  it('maintains key order (user fields first, fq_* fields after)', () => {
    const input = {
      fq_tags: ['tag1'],
      custom: 'value',
      fq_id: 'test-uuid',
      fq_title: 'Test Doc',
      fq_status: 'active',
      fq_created: '2026-04-12T00:00:00Z',
      fq_updated: '2026-04-12T01:00:00Z',
    };

    const result = serializeOrderedFrontmatter(input);
    const keys = Object.keys(result);

    // User field 'custom' must appear before any fq_* fields
    expect(keys[0]).toBe('custom');
    const fqFields = keys.filter((k) => k.startsWith('fq_'));
    expect(fqFields).toEqual(['fq_title', 'fq_status', 'fq_tags', 'fq_created', 'fq_updated', 'fq_id']);
    // The custom field appears before all fq_ fields
    expect(keys.indexOf('custom')).toBeLessThan(keys.indexOf(FM.TITLE));
  });

  it('handles empty object', () => {
    const input = {};
    const result = serializeOrderedFrontmatter(input);
    expect(result).toEqual({});
  });

  it('strips instance_id and embedding fields', () => {
    const input = {
      fq_id: 'test-uuid',
      fq_title: 'Test Doc',
      instance_id: 'instance-123',
      embedding: JSON.stringify([0.1, 0.2]),
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result).not.toHaveProperty('instance_id');
    expect(result).not.toHaveProperty('embedding');
    expect(result[FM.ID]).toBe('test-uuid');
    expect(result[FM.TITLE]).toBe('Test Doc');
  });

  it('preserves fq_instance (allowed field)', () => {
    const input = {
      fq_id: 'test-uuid',
      fq_instance: 'my-instance',
      content_hash: 'should-be-removed',
      fq_title: 'Test Doc',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result[FM.INSTANCE]).toBe('my-instance');
    expect(result).not.toHaveProperty('content_hash');
  });

  it('does not mutate input object', () => {
    const input = {
      fq_id: 'test-uuid',
      content_hash: 'sha256-abc',
      fq_title: 'Test Doc',
    };

    const originalInput = { ...input };
    serializeOrderedFrontmatter(input);

    expect(input).toEqual(originalInput);
    expect(input).toHaveProperty('content_hash');
  });

  it('preserves nested objects and arrays', () => {
    const input = {
      fq_id: 'test-uuid',
      fq_tags: ['tag1', 'tag2', 'tag3'],
      custom_object: { nested: 'value' },
      fq_status: 'active',
    };

    const result = serializeOrderedFrontmatter(input);

    expect(result[FM.TAGS]).toEqual(['tag1', 'tag2', 'tag3']);
    expect(result.custom_object).toEqual({ nested: 'value' });
  });

  it('handles multiple DB-only fields in one call', () => {
    const input = {
      fq_id: 'test-uuid',
      fq_title: 'Test Doc',
      content_hash: 'hash1',
      ownership_plugin_id: 'plugin1',
      embedding: 'vector1',
      instance_id: 'inst1',
      fq_status: 'active',
      fq_tags: ['tag1'],
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

    expect(result[FM.ID]).toBe('test-uuid');
    expect(result[FM.TITLE]).toBe('Test Doc');
    expect(result[FM.STATUS]).toBe('active');
    expect(result[FM.TAGS]).toEqual(['tag1']);
  });
});
