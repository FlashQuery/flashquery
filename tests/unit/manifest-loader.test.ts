import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(),
  },
}));

vi.mock('../../src/plugins/manager.js', () => ({
  parsePluginSchema: vi.fn(),
}));

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Imports
// ─────────────────────────────────────────────────────────────────────────────

import {
  loadPluginManifests,
  reloadManifests,
  getFolderMappings,
  matchesFolderClaim,
  type FolderMapping,
} from '../../src/services/manifest-loader.js';
import { logger } from '../../src/logging/logger.js';
import { supabaseManager } from '../../src/storage/supabase.js';
import { parsePluginSchema } from '../../src/plugins/manager.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(): FlashQueryConfig {
  return {
    instance: { name: 'test', id: 'test-instance-id', vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] } },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost', serviceRoleKey: 'key', databaseUrl: 'postgresql://localhost/db', skipDdl: false },
    git: { autoCommit: true, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    embedding: { provider: 'openai', model: 'text-embedding-3-small', dimensions: 1536 },
  };
}

function makeValidPluginSchema(pluginId: string = 'crm') {
  return {
    plugin: { id: pluginId, name: 'Test Plugin', version: '1.0.0', description: 'A test plugin' },
    tables: [],
    documents: {
      types: [
        {
          id: 'contact',
          folder: 'CRM/Contacts',
          description: 'Contact record',
        },
      ],
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('manifest-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loadPluginManifests()', () => {
    it('should load valid manifests and build folder mappings (DISC-02)', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'crm',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml-1',
                    },
                    {
                      plugin_id: 'projects',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml-2',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema)
        .mockReturnValueOnce(makeValidPluginSchema('crm'))
        .mockReturnValueOnce({
          plugin: { id: 'projects', name: 'Projects', version: '1.0.0' },
          tables: [],
          documents: {
            types: [
              {
                id: 'project',
                folder: 'Projects',
                description: 'Project record',
              },
            ],
          },
        });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(2);
      expect(mappings.get('CRM/Contacts')).toEqual({
        pluginId: 'crm',
        pluginInstance: 'default',
        typeId: 'contact',
        description: 'Contact record',
      });
      expect(mappings.get('Projects')).toEqual({
        pluginId: 'projects',
        pluginInstance: 'default',
        typeId: 'project',
        description: 'Project record',
      });
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'Plugin manifests loaded: 2 folder mapping(s) from 2 plugin(s)'
      );
    });

    it('should skip plugins with missing documents section (COMPAT-01)', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'legacy',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockReturnValueOnce({
        plugin: { id: 'legacy', name: 'Legacy', version: '1.0.0' },
        tables: [],
        documents: null as any,
      });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(0);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("[COMPAT] Manifest validation: plugin 'legacy'")
      );
    });

    it('should allow empty documents.types (valid, no warning)', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'empty',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockReturnValueOnce({
        plugin: { id: 'empty', name: 'Empty', version: '1.0.0' },
        tables: [],
        documents: { types: [] },
      });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(0);
      expect(vi.mocked(logger.warn)).not.toHaveBeenCalled();
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'Plugin manifests loaded: 0 folder mapping(s) from 1 plugin(s)'
      );
    });

    it('should handle malformed YAML (COMPAT-02)', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'bad',
                      plugin_instance: 'default',
                      schema_yaml: 'invalid yaml',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockImplementationOnce(() => {
        throw new Error('Invalid YAML');
      });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(0);
      expect(vi.mocked(logger.error)).toHaveBeenCalledWith(
        expect.stringContaining("Failed to parse manifest for plugin 'bad'")
      );
    });

    it('should handle Supabase query failure gracefully', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: null,
                  error: { message: 'Connection failed' },
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(0);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load plugin manifests from database')
      );
    });

    it('should detect and log folder conflicts (Decision E)', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'crm-a',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml-1',
                    },
                    {
                      plugin_id: 'crm-b',
                      plugin_instance: 'default',
                      schema_yaml: 'mock-yaml-2',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema)
        .mockReturnValueOnce({
          plugin: { id: 'crm-a', name: 'CRM A', version: '1.0.0' },
          tables: [],
          documents: {
            types: [{ id: 'contact', folder: 'CRM' }],
          },
        })
        .mockReturnValueOnce({
          plugin: { id: 'crm-b', name: 'CRM B', version: '1.0.0' },
          tables: [],
          documents: {
            types: [{ id: 'contact', folder: 'CRM' }],
          },
        });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(1);
      expect(mappings.get('CRM')?.pluginId).toBe('crm-b'); // Last one wins
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.stringContaining("(overwriting claim)")
      );
    });

    it('should handle null plugin_instance (defaults to "default")', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    {
                      plugin_id: 'crm',
                      plugin_instance: null,
                      schema_yaml: 'mock-yaml',
                    },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockReturnValueOnce(makeValidPluginSchema('crm'));

      const mappings = await loadPluginManifests(config);

      expect(mappings.get('CRM/Contacts')?.pluginInstance).toBe('default');
    });

    it('should handle multiple plugins with multiple types', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    { plugin_id: 'a', plugin_instance: 'default', schema_yaml: 'a' },
                    { plugin_id: 'b', plugin_instance: 'default', schema_yaml: 'b' },
                    { plugin_id: 'c', plugin_instance: 'default', schema_yaml: 'c' },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema)
        .mockReturnValueOnce({
          plugin: { id: 'a', name: 'A', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't1', folder: 'A' }] },
        })
        .mockReturnValueOnce({
          plugin: { id: 'b', name: 'B', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't1', folder: 'B' }, { id: 't2', folder: 'B/Sub' }, { id: 't3', folder: 'B/Sub2' }] },
        })
        .mockReturnValueOnce({
          plugin: { id: 'c', name: 'C', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't1', folder: 'C' }, { id: 't2', folder: 'C/Sub' }] },
        });

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(6);
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'Plugin manifests loaded: 6 folder mapping(s) from 3 plugin(s)'
      );
    });

    it('should return empty map when no plugins exist', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);

      const mappings = await loadPluginManifests(config);

      expect(mappings.size).toBe(0);
      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        'Plugin manifests loaded: 0 folder mapping(s) from 0 plugin(s)'
      );
    });
  });

  describe('matchesFolderClaim()', () => {
    it('should match folders case-insensitively', () => {
      expect(matchesFolderClaim('CRM/Contacts/Sarah.md', 'crm/contacts')).toBe(true);
    });

    it('should match recursive deep paths', () => {
      expect(matchesFolderClaim('crm/contacts/archives/old/sarah.md', 'CRM/CONTACTS')).toBe(true);
    });

    it('should not match different folder paths', () => {
      expect(matchesFolderClaim('CRM/Companies/Acme.md', 'CRM/Contacts')).toBe(false);
    });

    it('should match exact folder paths', () => {
      expect(matchesFolderClaim('CRM/Contacts', 'CRM/Contacts')).toBe(true);
    });

    it('should not match prefix without slash separator', () => {
      expect(matchesFolderClaim('CRM/Contact', 'CRM/Contacts')).toBe(false);
    });
  });

  describe('reloadManifests()', () => {
    it('should rebuild mappings when called', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [{ plugin_id: 'a', plugin_instance: 'default', schema_yaml: 'a' }],
                  error: null,
                }),
              })
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [
                    { plugin_id: 'a', plugin_instance: 'default', schema_yaml: 'a' },
                    { plugin_id: 'b', plugin_instance: 'default', schema_yaml: 'b' },
                  ],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema)
        .mockReturnValueOnce({
          plugin: { id: 'a', name: 'A', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't', folder: 'A' }] },
        })
        .mockReturnValueOnce({
          plugin: { id: 'a', name: 'A', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't', folder: 'A' }] },
        })
        .mockReturnValueOnce({
          plugin: { id: 'b', name: 'B', version: '1.0.0' },
          tables: [],
          documents: { types: [{ id: 't', folder: 'B' }] },
        });

      let mappings = await reloadManifests(config);
      expect(mappings.size).toBe(1);

      mappings = await reloadManifests(config);
      expect(mappings.size).toBe(2);
    });
  });

  describe('getFolderMappings()', () => {
    it('should return current folder mappings', async () => {
      const config = makeConfig();
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: [{ plugin_id: 'a', plugin_instance: 'default', schema_yaml: 'a' }],
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockReturnValueOnce(makeValidPluginSchema('a'));

      await loadPluginManifests(config);
      const mappings = getFolderMappings();

      expect(mappings.size).toBe(1);
      expect(mappings.get('CRM/Contacts')).toBeDefined();
    });
  });

  describe('Performance (PERF-03)', () => {
    it('should load 20 plugins × 5 types in <50ms', async () => {
      const config = makeConfig();
      const pluginData = Array.from({ length: 20 }, (_, i) => ({
        plugin_id: `plugin-${i}`,
        plugin_instance: 'default',
        schema_yaml: `schema-${i}`,
      }));

      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockReturnValueOnce({
                eq: vi.fn().mockResolvedValueOnce({
                  data: pluginData,
                  error: null,
                }),
              }),
          }),
        }),
      };

      vi.mocked(supabaseManager.getClient).mockReturnValue(mockClient as any);
      vi.mocked(parsePluginSchema).mockImplementation((yaml) => ({
        plugin: {
          id: `plugin-${parseInt(yaml.split('-')[1])}`,
          name: `Plugin ${parseInt(yaml.split('-')[1])}`,
          version: '1.0.0',
        },
        tables: [],
        documents: {
          types: Array.from({ length: 5 }, (_, i) => ({
            id: `type-${i}`,
            folder: `Folder${parseInt(yaml.split('-')[1])}/Sub${i}`,
          })),
        },
      }));

      const startTime = performance.now();
      const mappings = await loadPluginManifests(config);
      const endTime = performance.now();

      const elapsed = endTime - startTime;
      expect(elapsed).toBeLessThan(50);
      expect(mappings.size).toBe(100); // 20 plugins × 5 types
    });
  });
});
