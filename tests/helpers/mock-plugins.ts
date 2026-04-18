/**
 * Mock plugin implementations for Phase 59 integration tests.
 *
 * Provides configurable mock plugins with controllable callbacks for:
 * - on_document_discovered: configurable claim returns and error injection
 * - on_document_changed / on_document_deleted: configurable delivery results
 * - Latency simulation for realistic multi-plugin timing tests
 */

import type { PluginManifest, PluginDocumentType } from './discovery-fixtures.js';
import type { PluginClaim } from '../../src/services/plugin-skill-invoker.js';

// ─────────────────────────────────────────────────────────────────────────────
// Callback type definitions
// ─────────────────────────────────────────────────────────────────────────────

/** Callback invoked when plugin discovers a document */
export type DiscoveryCallback = (
  path: string,
  fqcId: string,
  ownership?: { plugin_id: string; type?: string }
) => Promise<PluginClaim>;

/** Callback invoked when a watched document changes */
export type ChangeCallback = (
  path: string,
  fqcId: string,
  changes?: any
) => Promise<{ acknowledged: boolean; error?: string }>;

/** Recorded invocation for assertion verification */
export interface SkillInvocation {
  path: string;
  fqcId: string;
  timestamp: number;
  args?: any[];
}

// ─────────────────────────────────────────────────────────────────────────────
// MockPluginBuilder — chainable builder for test plugin configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chainable builder for configuring mock plugins in tests.
 *
 * Usage:
 * ```typescript
 * const mock = new MockPluginBuilder('crm')
 *   .withDocumentType({ id: 'contact', folder: 'CRM/Contacts/', access_level: 'read-write' })
 *   .onDiscovered(async (path, fqcId) => ({ claim: 'owner', type: 'contact' }))
 *   .withLatency(50)
 *   .build();
 * ```
 */
export class MockPluginBuilder {
  private pluginId: string;
  private documentTypes: PluginDocumentType[] = [];
  private discoveryCallback: DiscoveryCallback | null = null;
  private changeCallback: ChangeCallback | null = null;
  private latencyMs: number = 0;
  private version: string = '1.0.0';

  /** Recorded discovery invocations for test assertions */
  public discoveryInvocations: SkillInvocation[] = [];
  /** Recorded change invocations for test assertions */
  public changeInvocations: SkillInvocation[] = [];

  constructor(pluginId: string) {
    this.pluginId = pluginId;
  }

  /** Add a document type to this plugin's manifest */
  withDocumentType(type: PluginDocumentType): this {
    this.documentTypes.push(type);
    return this;
  }

  /** Convenience: add a folder claim with a specific document type ID */
  withFolder(folderPath: string, documentTypeId: string, accessLevel: 'read-write' | 'read-only' = 'read-write'): this {
    this.documentTypes.push({
      id: documentTypeId,
      folder: folderPath,
      access_level: accessLevel,
    });
    return this;
  }

  /** Set the on_document_discovered callback */
  onDiscovered(callback: DiscoveryCallback): this {
    this.discoveryCallback = callback;
    return this;
  }

  /** Set the on_document_changed / on_document_deleted callback */
  onChanged(callback: ChangeCallback): this {
    this.changeCallback = callback;
    return this;
  }

  /** Add artificial delay for timing tests (milliseconds) */
  withLatency(ms: number): this {
    this.latencyMs = ms;
    return this;
  }

  /** Set plugin version string */
  withVersion(version: string): this {
    this.version = version;
    return this;
  }

  /**
   * Build the plugin manifest and return the configured plugin.
   * The returned manifest can be registered in the database for tests.
   */
  build(): {
    manifest: PluginManifest;
    pluginId: string;
    invokeDiscovery: DiscoveryCallback;
    invokeChange: ChangeCallback;
    discoveryInvocations: SkillInvocation[];
    changeInvocations: SkillInvocation[];
  } {
    const self = this;
    const manifest: PluginManifest = {
      plugin_id: this.pluginId,
      version: this.version,
      document_types: [...this.documentTypes],
    };

    const invokeDiscovery: DiscoveryCallback = async (path, fqcId, ownership) => {
      if (self.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, self.latencyMs));
      }

      self.discoveryInvocations.push({
        path,
        fqcId,
        timestamp: Date.now(),
        args: [path, fqcId, ownership],
      });

      if (self.discoveryCallback) {
        return self.discoveryCallback(path, fqcId, ownership);
      }

      // Default: return 'none' claim (non-participating)
      return { claim: 'none' };
    };

    const invokeChange: ChangeCallback = async (path, fqcId, changes) => {
      if (self.latencyMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, self.latencyMs));
      }

      self.changeInvocations.push({
        path,
        fqcId,
        timestamp: Date.now(),
        args: [path, fqcId, changes],
      });

      if (self.changeCallback) {
        return self.changeCallback(path, fqcId, changes);
      }

      // Default: acknowledge
      return { acknowledged: true };
    };

    return {
      manifest,
      pluginId: this.pluginId,
      invokeDiscovery,
      invokeChange,
      discoveryInvocations: this.discoveryInvocations,
      changeInvocations: this.changeInvocations,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// simpleMockPlugin — Quick helper for non-complex test scenarios
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a simple mock plugin with folder claims and no-op callbacks.
 * Useful for tests that only need manifests without complex callback behavior.
 *
 * @param pluginId - Plugin identifier
 * @param folders - Folder claim definitions (folderPath → documentTypeId)
 */
export function simpleMockPlugin(
  pluginId: string,
  folders: Array<{ folderPath: string; documentTypeId: string; accessLevel?: 'read-write' | 'read-only' }>
): PluginManifest {
  return {
    plugin_id: pluginId,
    version: '1.0.0',
    document_types: folders.map((f) => ({
      id: f.documentTypeId,
      folder: f.folderPath,
      access_level: f.accessLevel || 'read-write',
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// errorThrowingPlugin — Plugin that throws on discovery callback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock plugin whose on_document_discovered callback throws an error.
 * Used for error path testing (ERR-01 validation).
 *
 * @param pluginId - Plugin identifier
 * @param errorMessage - Error message to throw
 * @param folders - Folder claims for the plugin
 */
export function errorThrowingPlugin(
  pluginId: string,
  errorMessage: string,
  folders: Array<{ folderPath: string; documentTypeId: string }> = []
): MockPluginBuilder {
  const builder = new MockPluginBuilder(pluginId);

  for (const f of folders) {
    builder.withFolder(f.folderPath, f.documentTypeId);
  }

  builder.onDiscovered(async () => {
    throw new Error(errorMessage);
  });

  return builder;
}

// ─────────────────────────────────────────────────────────────────────────────
// slowPlugin — Plugin with configurable callback latency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock plugin with artificial latency on callbacks.
 * Used in multi-plugin tests to verify ordering and timing.
 *
 * @param pluginId - Plugin identifier
 * @param delayMs - Artificial delay in milliseconds per callback
 * @param claim - Claim type to return (defaults to 'read-only')
 * @param folders - Folder claims for the plugin
 */
export function slowPlugin(
  pluginId: string,
  delayMs: number,
  claim: 'owner' | 'read-write' | 'read-only' | 'none' = 'read-only',
  folders: Array<{ folderPath: string; documentTypeId: string }> = []
): MockPluginBuilder {
  const builder = new MockPluginBuilder(pluginId).withLatency(delayMs);

  for (const f of folders) {
    builder.withFolder(f.folderPath, f.documentTypeId);
  }

  builder.onDiscovered(async () => ({
    claim,
    type: folders[0]?.documentTypeId,
  }));

  return builder;
}

// ─────────────────────────────────────────────────────────────────────────────
// errorChangePlugin — Plugin whose change callback throws
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Create a mock plugin whose on_document_changed callback throws an error.
 * Used for change notification error path testing.
 *
 * @param pluginId - Plugin identifier
 * @param errorMessage - Error message to throw
 * @param folders - Folder claims for the plugin
 */
export function errorChangePlugin(
  pluginId: string,
  errorMessage: string,
  folders: Array<{ folderPath: string; documentTypeId: string }> = []
): MockPluginBuilder {
  const builder = new MockPluginBuilder(pluginId);

  for (const f of folders) {
    builder.withFolder(f.folderPath, f.documentTypeId);
  }

  builder.onChanged(async () => {
    throw new Error(errorMessage);
  });

  return builder;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildPluginSchemaYaml — Convert PluginManifest to database schema_yaml format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a PluginManifest to the schema_yaml string format expected by the database.
 * Used when registering mock plugins in fqc_plugin_registry.
 *
 * @param manifest - Plugin manifest to serialize
 */
export function buildPluginSchemaYaml(manifest: PluginManifest): string {
  const lines = [
    `id: ${manifest.plugin_id}`,
    `name: ${manifest.plugin_id} Test Plugin`,
    `version: ${manifest.version}`,
    `documents:`,
    `  types:`,
  ];

  for (const dt of manifest.document_types) {
    lines.push(`    - id: ${dt.id}`);
    lines.push(`      folder: ${dt.folder}`);
    if (dt.description) {
      lines.push(`      description: ${dt.description}`);
    }
    if (dt.access_level) {
      lines.push(`      access_level: ${dt.access_level}`);
    }
  }

  return lines.join('\n');
}
