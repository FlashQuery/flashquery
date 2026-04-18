/**
 * Discovery test fixture helpers for Phase 59 integration tests.
 *
 * Provides reusable setup/teardown utilities for vault structure, plugin manifests,
 * test documents, and Supabase cleanup across all discovery test suites.
 */

import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import yaml from 'js-yaml';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import type { SupabaseClient } from '@supabase/supabase-js';

// Re-export test environment constants for convenience
export { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from './test-env.js';

// ─────────────────────────────────────────────────────────────────────────────
// PluginManifest — shape used by fixture builder (not manifest-loader's type)
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginDocumentType {
  id: string;
  folder: string;
  description?: string;
  access_level?: 'read-write' | 'read-only';
}

export interface PluginManifest {
  plugin_id: string;
  version: string;
  document_types: PluginDocumentType[];
}

// ─────────────────────────────────────────────────────────────────────────────
// createTestVault — Create standard directory structure for tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create standard vault directory structure for discovery tests.
 * Creates subdirectories: CRM/Contacts/, CRM/Companies/, Notes/, Tasks/, Documents/
 *
 * @param vaultPath - Root path for the test vault
 */
export async function createTestVault(vaultPath: string): Promise<void> {
  const dirs = [
    join(vaultPath, 'CRM', 'Contacts'),
    join(vaultPath, 'CRM', 'Companies'),
    join(vaultPath, 'CRM', 'Tasks'),
    join(vaultPath, 'Notes'),
    join(vaultPath, 'Tasks'),
    join(vaultPath, 'Documents'),
    join(vaultPath, 'Other'),
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createTestDocument — Write markdown file with YAML frontmatter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a markdown document in the vault with YAML frontmatter.
 * Automatically assigns a fqc_id if not provided in frontmatter.
 *
 * @param vaultPath - Root vault path
 * @param relativePath - Vault-relative path (e.g., 'CRM/Contacts/Sarah.md')
 * @param frontmatter - YAML frontmatter fields (fqc_id auto-generated if missing)
 * @param content - Markdown body content
 */
export async function createTestDocument(
  vaultPath: string,
  relativePath: string,
  frontmatter: Record<string, any> = {},
  content: string = ''
): Promise<void> {
  const fm = {
    fqc_id: uuidv4(),
    ...frontmatter,
    created: frontmatter.created || new Date().toISOString(),
  };

  const yamlBlock = yaml.dump(fm, { lineWidth: -1 }).trimEnd();
  const output = `---\n${yamlBlock}\n---\n${content}\n`;

  const absolutePath = join(vaultPath, relativePath);
  const dir = absolutePath.substring(0, absolutePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(absolutePath, output, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// createPluginManifest — Write plugin manifest YAML to disk
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a plugin manifest YAML file to the plugins directory.
 * Creates parent directories if needed.
 *
 * @param pluginsPath - Root plugins directory
 * @param pluginId - Plugin identifier (becomes subdirectory name)
 * @param manifest - Plugin manifest object
 */
export async function createPluginManifest(
  pluginsPath: string,
  pluginId: string,
  manifest: PluginManifest
): Promise<void> {
  const pluginDir = join(pluginsPath, pluginId);
  await mkdir(pluginDir, { recursive: true });

  // Convert to the YAML schema format expected by plugin registry
  const schemaObject = {
    id: manifest.plugin_id,
    version: manifest.version,
    plugin: { id: manifest.plugin_id },
    documents: {
      types: manifest.document_types.map((dt) => ({
        id: dt.id,
        folder: dt.folder,
        description: dt.description || `${dt.id} document`,
        access_level: dt.access_level || 'read-write',
      })),
    },
  };

  const yamlContent = yaml.dump(schemaObject, { lineWidth: -1 });
  await writeFile(join(pluginDir, 'document-types.yaml'), yamlContent, 'utf-8');
}

// ─────────────────────────────────────────────────────────────────────────────
// makeConfig — Create FlashQueryConfig for tests
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a FlashQueryConfig object suitable for integration tests.
 * Uses real Supabase credentials from environment, disables embedding and locking.
 *
 * @param vaultPath - Path to the test vault
 * @param pluginsPath - Path to the plugins directory (optional)
 * @param instanceId - Unique instance ID for test isolation
 */
export function makeConfig(
  vaultPath: string,
  pluginsPath: string,
  instanceId: string
): FlashQueryConfig {
  const supabaseUrl = process.env.SUPABASE_URL ?? '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
  const databaseUrl = process.env.DATABASE_URL ?? '';

  return {
    instance: {
      name: 'discovery-test',
      id: instanceId,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: supabaseUrl,
      serviceRoleKey: supabaseKey,
      databaseUrl: databaseUrl,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
    server: { host: 'localhost', port: 3000 },
  } as unknown as FlashQueryConfig;
}

// ─────────────────────────────────────────────────────────────────────────────
// cleanupTest — Remove test data and vault directory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean up all test artifacts: database records (respecting foreign keys) and vault files.
 *
 * Foreign key order: fqc_change_queue → fqc_documents → fqc_vault
 *
 * @param vaultPath - Vault directory to remove
 * @param client - Supabase client for database cleanup
 * @param instanceId - Instance ID to scope database deletions
 */
export async function cleanupTest(
  vaultPath: string,
  client: SupabaseClient,
  instanceId: string
): Promise<void> {
  // Delete in foreign key order
  try {
    await client.from('fqc_change_queue').delete().eq('instance_id', instanceId);
  } catch (_) {
    // Table may not exist in all test environments
  }

  try {
    await client.from('fqc_documents').delete().eq('instance_id', instanceId);
  } catch (_) {
    // Ignore cleanup errors
  }

  try {
    await client.from('fqc_plugin_registry').delete().eq('instance_id', instanceId);
  } catch (_) {
    // Ignore cleanup errors
  }

  try {
    await client.from('fqc_vault').delete().eq('id', instanceId);
  } catch (_) {
    // Ignore cleanup errors
  }

  // Remove vault directory
  try {
    await rm(vaultPath, { recursive: true, force: true });
  } catch (_) {
    // Ignore if already removed
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createTempVaultPath — Create a unique temp directory for a test
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a unique temporary directory for use as a test vault.
 * Returns the created path.
 *
 * @param prefix - Optional prefix for the temp directory name
 */
export async function createTempVaultPath(prefix: string = 'fqc-test-'): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

// ─────────────────────────────────────────────────────────────────────────────
// registerPluginInDatabase — Insert plugin record into fqc_plugin_registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register a plugin manifest in the Supabase plugin registry.
 * This is how manifests are loaded by manifest-loader.ts (reads from DB).
 *
 * @param client - Supabase client
 * @param instanceId - Instance ID for scoping
 * @param manifest - Plugin manifest to register
 */
export async function registerPluginInDatabase(
  client: SupabaseClient,
  instanceId: string,
  manifest: PluginManifest
): Promise<void> {
  // Build schema_yaml in the format expected by parsePluginSchema
  const schemaObject = {
    id: manifest.plugin_id,
    plugin: { id: manifest.plugin_id },
    version: manifest.version,
    documents: {
      types: manifest.document_types.map((dt) => ({
        id: dt.id,
        folder: dt.folder,
        description: dt.description || `${dt.id} document`,
        access_level: dt.access_level || 'read-write',
      })),
    },
  };

  const schemaYaml = yaml.dump(schemaObject, { lineWidth: -1 });

  const { error } = await client.from('fqc_plugin_registry').insert({
    plugin_id: manifest.plugin_id,
    instance_id: instanceId,
    plugin_instance: 'default',
    schema_yaml: schemaYaml,
    status: 'active',
  });

  if (error) {
    throw new Error(`Failed to register plugin ${manifest.plugin_id}: ${error.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createDatabaseDocument — Insert document record into fqc_documents
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a document record in fqc_documents for testing.
 * Returns the document ID.
 *
 * @param client - Supabase client
 * @param instanceId - Instance ID
 * @param vaultPath - Vault-relative path (e.g., 'CRM/Contacts/Sarah.md')
 * @param overrides - Optional field overrides
 */
export async function createDatabaseDocument(
  client: SupabaseClient,
  instanceId: string,
  vaultPath: string,
  overrides: Record<string, any> = {}
): Promise<string> {
  const docId = uuidv4();

  const { error: insertError, data: insertData } = await client.from('fqc_documents').insert({
    id: docId,
    instance_id: instanceId,
    path: vaultPath,
    title: vaultPath.split('/').pop() || 'Document',
    content_hash: 'test-hash-' + Date.now(),
    needs_discovery: true,
    discovery_status: 'pending',
    ...overrides,
  });

  // If duplicate key constraint error on (instance_id, path), fetch and return existing ID
  if (insertError) {
    if (insertError.message.includes('duplicate') || insertError.code === '23505') {
      const { data: existing, error: fetchError } = await client
        .from('fqc_documents')
        .select('id')
        .eq('instance_id', instanceId)
        .eq('path', vaultPath)
        .single();

      if (fetchError) {
        throw new Error(`Failed to fetch existing document: ${fetchError.message}`);
      }

      if (!existing?.id) {
        throw new Error(`Existing document found but no ID`);
      }

      return existing.id;
    } else {
      throw new Error(`Failed to create document in DB: ${insertError.message}`);
    }
  }

  return docId;
}

// ─────────────────────────────────────────────────────────────────────────────
// createVaultRecord — Insert vault record into fqc_vault
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a vault record in fqc_vault. Required before inserting fqc_documents.
 *
 * @param client - Supabase client
 * @param instanceId - Instance ID (used as both vault id and instance_id)
 * @param vaultPath - File system path to the vault
 * @param name - Human-readable vault name
 */
export async function createVaultRecord(
  client: SupabaseClient,
  instanceId: string,
  vaultPath: string,
  name: string = 'test-vault'
): Promise<void> {
  // Try insert first
  const { error: insertError } = await client.from('fqc_vault').insert({
    id: instanceId,
    name,
    path: vaultPath,
    instance_id: instanceId,
  });

  // If duplicate key constraint error, update existing record instead
  if (insertError) {
    if (insertError.message.includes('duplicate') || insertError.code === '23505') {
      const { error: updateError } = await client
        .from('fqc_vault')
        .update({ name, instance_id: instanceId })
        .eq('path', vaultPath);

      if (updateError) {
        throw new Error(`Failed to update vault record: ${updateError.message}`);
      }
    } else {
      throw new Error(`Failed to create vault record: ${insertError.message}`);
    }
  }
}
