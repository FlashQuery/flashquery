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

import {
  PluginManager,
  parsePluginSchema,
  buildPluginTableDDL,
  resolveTableName,
  validatePluginId,
  validateInstanceName,
  initPlugins,
} from '../../src/plugins/manager.js';
import { logger } from '../../src/logging/logger.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_SCHEMA_YAML = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
  description: Contact relationship management

tables:
  - name: contacts
    description: People in your network
    embed_fields:
      - notes
    columns:
      - name: full_name
        type: text
        required: true
      - name: email
        type: text
      - name: notes
        type: text
        default: ""
`;

const SCHEMA_NO_EMBED = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1

tables:
  - name: businesses
    columns:
      - name: company_name
        type: text
        required: true
      - name: employee_count
        type: integer
        default: 0
`;

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: 'test', id: 'test-instance-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db', skipDdl: false },
    git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
  } as unknown as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: parsePluginSchema
// ─────────────────────────────────────────────────────────────────────────────

describe('parsePluginSchema', () => {
  it('parses valid YAML and returns ParsedPluginSchema', () => {
    const schema = parsePluginSchema(VALID_SCHEMA_YAML);

    expect(schema.plugin.id).toBe('crm');
    expect(schema.plugin.name).toBe('CRM Plugin');
    expect(schema.plugin.version).toBe('1');
    expect(schema.plugin.description).toBe('Contact relationship management');
    expect(schema.tables).toHaveLength(1);
    expect(schema.tables[0].name).toBe('contacts');
    expect(schema.tables[0].columns).toHaveLength(3);
    expect(schema.tables[0].embed_fields).toEqual(['notes']);
  });

  it('throws on invalid column type', () => {
    const yaml = `
plugin:
  id: test
  name: Test
  version: 1
tables:
  - name: records
    columns:
      - name: data
        type: jsonb
`;
    expect(() => parsePluginSchema(yaml)).toThrow(/jsonb/);
  });

  it('throws when embed_fields references unknown column', () => {
    const yaml = `
plugin:
  id: test
  name: Test
  version: 1
tables:
  - name: records
    embed_fields:
      - nonexistent_col
    columns:
      - name: title
        type: text
`;
    expect(() => parsePluginSchema(yaml)).toThrow(/nonexistent_col/);
  });

  it('throws when plugin_id contains invalid characters', () => {
    const yaml = `
plugin:
  id: My-Plugin
  name: Test
  version: 1
tables: []
`;
    expect(() => parsePluginSchema(yaml)).toThrow();
  });

  it('parses schema without embed_fields successfully', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    expect(schema.tables[0].embed_fields).toBeUndefined();
    expect(schema.tables[0].columns[1].default).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: buildPluginTableDDL
// ─────────────────────────────────────────────────────────────────────────────

describe('buildPluginTableDDL', () => {
  it('includes implicit columns (id, instance_id, status, created_at, updated_at, last_seen_updated_at)', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    expect(ddl).toContain('id UUID PRIMARY KEY DEFAULT gen_random_uuid()');
    expect(ddl).toContain('instance_id TEXT NOT NULL');
    expect(ddl).toContain("status TEXT DEFAULT 'active'");
    expect(ddl).toContain('created_at TIMESTAMPTZ DEFAULT now()');
    expect(ddl).toContain('updated_at TIMESTAMPTZ DEFAULT now()');
    expect(ddl).toContain('last_seen_updated_at TIMESTAMPTZ');
  });

  it('escapes table name with pg.escapeIdentifier', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    // Mock wraps in double quotes
    expect(ddl).toContain('"fqcp_crm_default_businesses"');
  });

  it('escapes column names with pg.escapeIdentifier', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    expect(ddl).toContain('"company_name"');
    expect(ddl).toContain('"employee_count"');
  });

  it('adds NOT NULL for required columns', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    expect(ddl).toMatch(/"company_name".*NOT NULL/);
  });

  it('adds embedding columns when embed_fields is present', () => {
    const schema = parsePluginSchema(VALID_SCHEMA_YAML);
    const ddl = buildPluginTableDDL('fqcp_crm_default_contacts', schema.tables[0], 1536);

    expect(ddl).toContain('embedding vector(1536)');
    expect(ddl).toContain('embedding_updated_at TIMESTAMPTZ');
  });

  it('omits embedding columns when no embed_fields', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    expect(ddl).not.toContain('embedding');
  });

  it('uses CREATE TABLE IF NOT EXISTS', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('includes integer DEFAULT without quotes', () => {
    const schema = parsePluginSchema(SCHEMA_NO_EMBED);
    const ddl = buildPluginTableDDL('fqcp_crm_default_businesses', schema.tables[0], 1536);

    // Integer default should render as raw number, not quoted
    expect(ddl).toMatch(/"employee_count" INTEGER DEFAULT 0/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: PluginManager class
// ─────────────────────────────────────────────────────────────────────────────

describe('PluginManager', () => {
  let manager: PluginManager;

  beforeEach(() => {
    manager = new PluginManager();
  });

  it('getEntry returns undefined for unknown plugin', () => {
    expect(manager.getEntry('crm', 'default')).toBeUndefined();
  });

  it('loadEntry and getEntry round-trip correctly', () => {
    const schema = parsePluginSchema(VALID_SCHEMA_YAML);
    manager.loadEntry({
      plugin_id: 'crm',
      plugin_instance: 'default',
      table_prefix: 'fqcp_crm_default_',
      schema,
    });

    const entry = manager.getEntry('crm', 'default');
    expect(entry).toBeDefined();
    expect(entry!.plugin_id).toBe('crm');
    expect(entry!.plugin_instance).toBe('default');
    expect(entry!.table_prefix).toBe('fqcp_crm_default_');
    expect(entry!.schema.plugin.id).toBe('crm');
  });

  it('getAllEntries returns all loaded entries', () => {
    const schema = parsePluginSchema(VALID_SCHEMA_YAML);
    manager.loadEntry({ plugin_id: 'crm', plugin_instance: 'default', table_prefix: 'fqcp_crm_default_', schema });
    manager.loadEntry({ plugin_id: 'crm', plugin_instance: 'work', table_prefix: 'fqcp_crm_work_', schema });

    const entries = manager.getAllEntries();
    expect(entries).toHaveLength(2);
  });

  it('loadEntry overwrites existing entry with same key', () => {
    const schema = parsePluginSchema(VALID_SCHEMA_YAML);
    manager.loadEntry({ plugin_id: 'crm', plugin_instance: 'default', table_prefix: 'fqcp_crm_default_', schema });
    manager.loadEntry({ plugin_id: 'crm', plugin_instance: 'default', table_prefix: 'fqcp_crm_default_v2_', schema });

    expect(manager.getAllEntries()).toHaveLength(1);
    expect(manager.getEntry('crm', 'default')!.table_prefix).toBe('fqcp_crm_default_v2_');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: resolveTableName
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveTableName', () => {
  it('returns fqcp_{plugin_id}_{instance_name}_{table_name}', () => {
    expect(resolveTableName('crm', 'default', 'contacts')).toBe('fqcp_crm_default_contacts');
    expect(resolveTableName('crm', 'work', 'businesses')).toBe('fqcp_crm_work_businesses');
  });

  it('handles single-word ids correctly', () => {
    expect(resolveTableName('billing', 'default', 'invoices')).toBe('fqcp_billing_default_invoices');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: validatePluginId and validateInstanceName
// ─────────────────────────────────────────────────────────────────────────────

describe('validatePluginId', () => {
  it('accepts valid plugin ids', () => {
    expect(() => validatePluginId('crm')).not.toThrow();
    expect(() => validatePluginId('my_plugin')).not.toThrow();
    expect(() => validatePluginId('plugin123')).not.toThrow();
  });

  it('rejects plugin ids with uppercase letters', () => {
    expect(() => validatePluginId('CRM')).toThrow();
    expect(() => validatePluginId('My-Plugin')).toThrow();
  });

  it('rejects plugin ids with hyphens', () => {
    expect(() => validatePluginId('my-plugin')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => validatePluginId('')).toThrow();
  });
});

describe('validateInstanceName', () => {
  it('accepts valid instance names', () => {
    expect(() => validateInstanceName('default')).not.toThrow();
    expect(() => validateInstanceName('work')).not.toThrow();
    expect(() => validateInstanceName('my_instance')).not.toThrow();
  });

  it('rejects instance names with uppercase', () => {
    expect(() => validateInstanceName('Work')).toThrow();
  });

  it('rejects instance names with spaces', () => {
    expect(() => validateInstanceName('my instance')).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: initPlugins
// ─────────────────────────────────────────────────────────────────────────────

describe('initPlugins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loads active registry entries and populates pluginManager', async () => {
    const mockData = [
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        table_prefix: 'fqcp_crm_default_',
        schema_yaml: VALID_SCHEMA_YAML,
      },
    ];

    const mockEq2 = vi.fn().mockResolvedValue({ data: mockData, error: null });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const config = makeConfig();
    await initPlugins(config);

    expect(mockFrom).toHaveBeenCalledWith('fqc_plugin_registry');
    expect(mockSelect).toHaveBeenCalledWith('plugin_id, plugin_instance, table_prefix, schema_yaml');
  });

  it('warns and starts with empty registry when supabase query fails', async () => {
    const mockEq2 = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB error' } });
    const mockEq1 = vi.fn().mockReturnValue({ eq: mockEq2 });
    const mockSelect = vi.fn().mockReturnValue({ eq: mockEq1 });
    const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });

    vi.mocked(supabaseManager.getClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof supabaseManager.getClient>);

    const config = makeConfig();
    // Should NOT throw — logs warning and starts with empty registry
    await expect(initPlugins(config)).resolves.toBeUndefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('registry load failed')
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: documents.types section parsing (Phase 54)
// ─────────────────────────────────────────────────────────────────────────────

describe('documents.types parsing', () => {
  it('parses valid documents.types section from plugin schema', () => {
    const yaml = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
  description: Contact relationship management
documents:
  types:
    - id: contact
      folder: CRM/Contacts
      description: Individual contact person
    - id: company
      folder: CRM/Companies
      description: Business entity
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
`;
    const schema = parsePluginSchema(yaml);
    expect(schema.documents).toBeDefined();
    expect(schema.documents?.types).toHaveLength(2);
    expect(schema.documents?.types[0].id).toBe('contact');
    expect(schema.documents?.types[0].folder).toBe('CRM/Contacts');
    expect(schema.documents?.types[1].id).toBe('company');
    expect(schema.documents?.types[1].folder).toBe('CRM/Companies');
  });

  it('handles missing documents section gracefully', () => {
    const yaml = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
`;
    const schema = parsePluginSchema(yaml);
    expect(schema.documents).toBeUndefined();
  });

  it('logs warning for invalid documents.types entries (missing id or folder)', () => {
    const yaml = `
plugin:
  id: crm
  name: CRM Plugin
  version: 1
documents:
  types:
    - id: contact
      # missing folder
    - folder: CRM/Companies
      # missing id
tables:
  - name: contacts
    columns:
      - name: full_name
        type: text
`;
    const schema = parsePluginSchema(yaml);
    // Should still parse but with empty values
    expect(schema.documents?.types).toBeDefined();
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('documents.types entry missing id or folder')
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests: getFolderClaimsMap (Phase 54)
// ─────────────────────────────────────────────────────────────────────────────

describe('getFolderClaimsMap', () => {
  it('builds correct folder→plugin mapping from plugin registry', async () => {
    const { getFolderClaimsMap, pluginManager } = await import('../../src/plugins/manager.js');

    // Mock pluginManager singleton with entries
    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        schema: {
          documents: {
            types: [
              { id: 'contact', folder: 'CRM/Contacts', description: 'Contact' },
              { id: 'company', folder: 'CRM/Companies', description: 'Company' },
            ],
          },
        },
      },
    ] as any);

    const mockConfig = makeConfig();
    const folderMap = getFolderClaimsMap(mockConfig);

    expect(folderMap).toBeInstanceOf(Map);
    expect(folderMap.size).toBe(2);
    expect(folderMap.get('crm/contacts')).toEqual({ pluginId: 'crm', typeId: 'contact' });
    expect(folderMap.get('crm/companies')).toEqual({ pluginId: 'crm', typeId: 'company' });
  });

  it('normalizes folder paths to lowercase for case-insensitive matching', async () => {
    const { getFolderClaimsMap, pluginManager } = await import('../../src/plugins/manager.js');

    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        schema: {
          documents: {
            types: [
              { id: 'contact', folder: 'CRM/Contacts/VIP', description: 'VIP Contact' },
            ],
          },
        },
      },
    ] as any);

    const mockConfig = makeConfig();
    const folderMap = getFolderClaimsMap(mockConfig);

    expect(folderMap.get('crm/contacts/vip')).toEqual({ pluginId: 'crm', typeId: 'contact' });
  });

  it('returns empty map when no plugins claim folders', async () => {
    const { getFolderClaimsMap, pluginManager } = await import('../../src/plugins/manager.js');

    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        schema: {
          documents: undefined, // No documents section
        },
      },
    ] as any);

    const mockConfig = makeConfig();
    const folderMap = getFolderClaimsMap(mockConfig);

    expect(folderMap.size).toBe(0);
  });

  it('returns empty map on error and logs warning', async () => {
    const { getFolderClaimsMap, pluginManager } = await import('../../src/plugins/manager.js');

    vi.spyOn(pluginManager, 'getAllEntries').mockImplementation(() => {
      throw new Error('Plugin registry error');
    });

    const mockConfig = makeConfig();
    const folderMap = getFolderClaimsMap(mockConfig);

    expect(folderMap.size).toBe(0);
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('getFolderClaimsMap: failed to build map')
    );
  });
});
