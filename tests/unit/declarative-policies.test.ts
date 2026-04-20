import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('pg', () => {
  return {
    default: {
      Client: vi.fn(),
      escapeIdentifier: vi.fn((s: string) => `"${s}"`),
      escapeLiteral: vi.fn((s: string) => `'${s}'`),
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import { parsePluginSchema } from '../../src/plugins/manager.js';
import type { DocumentTypePolicy } from '../../src/plugins/manager.js';
import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// YAML fixtures
// ─────────────────────────────────────────────────────────────────────────────

const SCHEMA_ALL_POLICY_FIELDS = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
      - name: tags
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      access: read-only
      on_added: auto-track
      on_moved: stop-tracking
      on_modified: sync-fields
      track_as: contacts
      template: contact-template.md
      field_map:
        title: full_name
        labels: tags
`;

const SCHEMA_NO_POLICY_FIELDS = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
`;

const SCHEMA_AUTO_TRACK_NO_TRACK_AS = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      on_added: auto-track
`;

const SCHEMA_AUTO_TRACK_UNKNOWN_TABLE = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      on_added: auto-track
      track_as: nonexistent_table
`;

const SCHEMA_FIELD_MAP_INVALID_COLUMN = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      on_added: auto-track
      track_as: contacts
      field_map:
        title: does_not_exist
`;

const SCHEMA_FIELD_MAP_VALID_COLUMN = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      on_added: auto-track
      track_as: contacts
      field_map:
        title: full_name
`;

// ─────────────────────────────────────────────────────────────────────────────
// Tests: declarative policy field parsing
// ─────────────────────────────────────────────────────────────────────────────

describe('declarative policy field parsing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses schema with all 7 policy fields and returns correct values', () => {
    const schema = parsePluginSchema(SCHEMA_ALL_POLICY_FIELDS);
    const type = schema.documents?.types[0] as DocumentTypePolicy;

    expect(type.id).toBe('contact');
    expect(type.folder).toBe('CRM/Contacts');
    expect(type.access).toBe('read-only');
    expect(type.on_added).toBe('auto-track');
    expect(type.on_moved).toBe('stop-tracking');
    expect(type.on_modified).toBe('sync-fields');
    expect(type.track_as).toBe('contacts');
    expect(type.template).toBe('contact-template.md');
    expect(type.field_map).toEqual({ title: 'full_name', labels: 'tags' });
  });

  it('returns conservative defaults when policy fields are absent', () => {
    const schema = parsePluginSchema(SCHEMA_NO_POLICY_FIELDS);
    const type = schema.documents?.types[0] as DocumentTypePolicy;

    expect(type.access).toBe('read-write');
    expect(type.on_added).toBe('ignore');
    expect(type.on_moved).toBe('keep-tracking');
    expect(type.on_modified).toBe('ignore');
    expect(type.track_as).toBeUndefined();
    expect(type.template).toBeUndefined();
    expect(type.field_map).toBeUndefined();
  });

  it('throws when on_added is auto-track but track_as is missing', () => {
    expect(() => parsePluginSchema(SCHEMA_AUTO_TRACK_NO_TRACK_AS)).toThrow(/track_as/);
  });

  it('throws when on_added is auto-track with track_as pointing to non-existent table', () => {
    expect(() => parsePluginSchema(SCHEMA_AUTO_TRACK_UNKNOWN_TABLE)).toThrow(/nonexistent_table/);
  });

  it('logs a warning for field_map column target that does not exist in the track_as table but accepts the schema', () => {
    let parsed: ReturnType<typeof parsePluginSchema> | undefined;
    expect(() => {
      parsed = parsePluginSchema(SCHEMA_FIELD_MAP_INVALID_COLUMN);
    }).not.toThrow();
    expect(parsed).toBeDefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('field_map target column')
    );
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('does_not_exist')
    );
  });

  it('does not log a warning when field_map column target exists in the track_as table', () => {
    expect(() => parsePluginSchema(SCHEMA_FIELD_MAP_VALID_COLUMN)).not.toThrow();
    const warnCalls = vi.mocked(logger.warn).mock.calls;
    const fieldMapWarnings = warnCalls.filter((args) =>
      String(args[0]).includes('field_map target column')
    );
    expect(fieldMapWarnings).toHaveLength(0);
  });
});
