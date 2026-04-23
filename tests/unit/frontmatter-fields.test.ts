/**
 * Canary tests for FM constants (src/constants/frontmatter-fields.ts).
 * These tests verify exact string values and key ordering of the FM object.
 *
 * Part of Phase 90: Centralize frontmatter field names into FM constants.
 */
import { describe, it, expect } from 'vitest';
import { FM } from '../../src/constants/frontmatter-fields.js';

describe('FM constants', () => {
  it('each constant has the correct string value', () => {
    expect(FM.TITLE).toBe('fq_title');
    expect(FM.STATUS).toBe('fq_status');
    expect(FM.TAGS).toBe('fq_tags');
    expect(FM.CREATED).toBe('fq_created');
    expect(FM.UPDATED).toBe('fq_updated');
    expect(FM.OWNER).toBe('fq_owner');
    expect(FM.TYPE).toBe('fq_type');
    expect(FM.INSTANCE).toBe('fq_instance');
    expect(FM.ID).toBe('fq_id');
  });

  it('key ordering matches preferred write order', () => {
    const keys = Object.keys(FM);
    expect(keys).toEqual(['TITLE', 'STATUS', 'TAGS', 'CREATED', 'UPDATED', 'OWNER', 'TYPE', 'INSTANCE', 'ID']);
  });
});
