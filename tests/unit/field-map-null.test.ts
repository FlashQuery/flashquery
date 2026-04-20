import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (minimal — only what the module imports at load time)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn() },
}));
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('pg', () => ({
  default: {
    Client: vi.fn(),
    escapeIdentifier: vi.fn((s: string) => `"${s}"`),
    escapeLiteral: vi.fn((s: string) => `'${s}'`),
  },
}));
vi.mock('../../src/utils/pg-client.js', () => ({
  createPgClientIPv4: vi.fn(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue({ rows: [] }),
    end: vi.fn().mockResolvedValue(undefined),
  })),
}));
vi.mock('../../src/storage/vault.js', () => ({
  atomicWriteFrontmatter: vi.fn().mockResolvedValue(undefined),
  vaultManager: { rootPath: '/vault' },
}));
vi.mock('../../src/plugins/manager.js', () => ({
  pluginManager: { getEntry: vi.fn(), getAllEntries: vi.fn() },
  getTypeRegistryMap: vi.fn(() => new Map()),
}));
vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(''),
}));

// ─────────────────────────────────────────────────────────────────────────────
// System-under-test import (AFTER mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { applyFieldMap } from '../../src/services/plugin-reconciliation.js';

// ─────────────────────────────────────────────────────────────────────────────
// Reset before each test
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: applyFieldMap (RECON-06 / field_map NULL behavior, D-12, D-16)
// ─────────────────────────────────────────────────────────────────────────────

describe('applyFieldMap (RECON-06 / field_map NULL behavior)', () => {
  it('maps all present frontmatter fields to their target column values', () => {
    const fieldMap = { name: 'full_name', email: 'email_address' };
    const frontmatter = { name: 'Alice', email: 'a@b.com' };

    const result = applyFieldMap(fieldMap, frontmatter);

    expect(result).toEqual({ full_name: 'Alice', email_address: 'a@b.com' });
  });

  it('sets target column to NULL when frontmatter field is absent', () => {
    const fieldMap = { name: 'full_name', email: 'email_address' };
    const frontmatter = { name: 'Alice' }; // email absent

    const result = applyFieldMap(fieldMap, frontmatter);

    expect(result.full_name).toBe('Alice');
    expect(result.email_address).toBeNull();
    // Column must be present, not omitted
    expect('email_address' in result).toBe(true);
  });

  it('sets all target columns to NULL when all frontmatter fields are absent', () => {
    const fieldMap = { name: 'full_name', email: 'email_address', age: 'age_years' };
    const frontmatter = {}; // all absent

    const result = applyFieldMap(fieldMap, frontmatter);

    expect(result).toEqual({ full_name: null, email_address: null, age_years: null });
    expect(result.full_name).toBeNull();
    expect(result.email_address).toBeNull();
    expect(result.age_years).toBeNull();
  });

  it('preserves falsy but defined values (0, false, empty string) — confirms ?? null semantics, NOT || null', () => {
    const fieldMap = { count: 'count_col', flag: 'flag_col', note: 'note_col' };
    const frontmatter = { count: 0, flag: false, note: '' };

    const result = applyFieldMap(fieldMap, frontmatter);

    expect(result.count_col).toBe(0);
    expect(result.flag_col).toBe(false);
    expect(result.note_col).toBe('');
  });

  it('returns empty object when fieldMap is undefined', () => {
    const result = applyFieldMap(undefined, { name: 'Alice' });

    expect(result).toEqual({});
  });
});
