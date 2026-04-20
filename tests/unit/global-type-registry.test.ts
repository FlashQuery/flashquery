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
  buildGlobalTypeRegistry,
  getTypeRegistryMap,
} from '../../src/plugins/manager.js';
import { logger } from '../../src/logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeContactPolicy() {
  return {
    id: 'contact',
    folder: 'CRM/Contacts',
    access: 'read-write' as const,
    on_added: 'ignore' as const,
    on_moved: 'keep-tracking' as const,
    on_modified: 'ignore' as const,
  };
}

function makeDealPolicy() {
  return {
    id: 'deal',
    folder: 'CRM/Deals',
    access: 'read-write' as const,
    on_added: 'ignore' as const,
    on_moved: 'keep-tracking' as const,
    on_modified: 'ignore' as const,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests: global type registry
// ─────────────────────────────────────────────────────────────────────────────

describe('global type registry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds registry from 2 plugins with different type IDs, containing all types', async () => {
    const { pluginManager } = await import('../../src/plugins/manager.js');
    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        table_prefix: 'fqcp_crm_default_',
        schema: {
          plugin: { id: 'crm', name: 'CRM', version: '1' },
          tables: [],
          documents: { types: [makeContactPolicy()] },
        },
      },
      {
        plugin_id: 'finance',
        plugin_instance: 'default',
        table_prefix: 'fqcp_finance_default_',
        schema: {
          plugin: { id: 'finance', name: 'Finance', version: '1' },
          tables: [],
          documents: { types: [makeDealPolicy()] },
        },
      },
    ] as any);

    buildGlobalTypeRegistry();
    const map = getTypeRegistryMap();

    expect(map.size).toBe(2);
    expect(map.has('contact')).toBe(true);
    expect(map.has('deal')).toBe(true);
    expect(map.get('contact')?.pluginId).toBe('crm');
    expect(map.get('deal')?.pluginId).toBe('finance');
  });

  it('logs warning and first registration wins when two plugins register the same type ID', async () => {
    const { pluginManager } = await import('../../src/plugins/manager.js');
    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        table_prefix: 'fqcp_crm_default_',
        schema: {
          plugin: { id: 'crm', name: 'CRM', version: '1' },
          tables: [],
          documents: { types: [makeContactPolicy()] },
        },
      },
      {
        plugin_id: 'hr',
        plugin_instance: 'default',
        table_prefix: 'fqcp_hr_default_',
        schema: {
          plugin: { id: 'hr', name: 'HR', version: '1' },
          tables: [],
          documents: {
            types: [
              {
                id: 'contact',  // collision with crm
                folder: 'HR/People',
                access: 'read-write' as const,
                on_added: 'ignore' as const,
                on_moved: 'keep-tracking' as const,
                on_modified: 'ignore' as const,
              },
            ],
          },
        },
      },
    ] as any);

    buildGlobalTypeRegistry();
    const map = getTypeRegistryMap();

    // First registration wins
    expect(map.get('contact')?.pluginId).toBe('crm');
    expect(map.size).toBe(1);
    // Warning logged for collision
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.stringContaining('first registration wins')
    );
  });

  it('reflects current state after simulating register then unregister sequence', async () => {
    const { pluginManager } = await import('../../src/plugins/manager.js');
    const spy = vi.spyOn(pluginManager, 'getAllEntries');

    // Simulate: 1 plugin loaded
    spy.mockReturnValue([
      {
        plugin_id: 'crm',
        plugin_instance: 'default',
        table_prefix: 'fqcp_crm_default_',
        schema: {
          plugin: { id: 'crm', name: 'CRM', version: '1' },
          tables: [],
          documents: { types: [makeContactPolicy()] },
        },
      },
    ] as any);
    buildGlobalTypeRegistry();
    expect(getTypeRegistryMap().has('contact')).toBe(true);

    // Simulate: plugin unregistered
    spy.mockReturnValue([]);
    buildGlobalTypeRegistry();
    expect(getTypeRegistryMap().has('contact')).toBe(false);
    expect(getTypeRegistryMap().size).toBe(0);
  });

  it('returns empty Map when no plugins are loaded', async () => {
    const { pluginManager } = await import('../../src/plugins/manager.js');
    vi.spyOn(pluginManager, 'getAllEntries').mockReturnValue([]);

    buildGlobalTypeRegistry();
    const map = getTypeRegistryMap();

    expect(map.size).toBe(0);
  });
});
