/**
 * Mock plugin implementations for reconciliation-based integration tests.
 *
 * Provides MockPluginBuilder for configuring plugins with declarative policy fields
 * (on_added, on_moved, on_modified). Use buildPluginSchemaYaml() to emit schema YAML
 * compatible with parsePluginSchema() in src/plugins/manager.ts.
 */

import type { PluginManifest, PluginDocumentType } from './discovery-fixtures.js';

// ─────────────────────────────────────────────────────────────────────────────
// PluginSchemaPolicy — policy overrides for buildPluginSchemaYaml()
// ─────────────────────────────────────────────────────────────────────────────

export interface PluginSchemaPolicy {
  autoTrack?: { tableName: string; fieldMap?: Record<string, string>; template?: string };
  onMoved?: 'keep-tracking' | 'stop-tracking';
  onModified?: 'sync-fields' | 'ignore';
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
 *   .withAutoTrack('crm_contacts')
 *   .withOnMoved('keep-tracking')
 *   .withOnModified('sync-fields')
 *   .build();
 * ```
 */
export class MockPluginBuilder {
  private pluginId: string;
  private documentTypes: PluginDocumentType[] = [];
  private latencyMs: number = 0;
  private version: string = '1.0.0';
  private autoTrackConfig: { tableName: string; fieldMap?: Record<string, string>; template?: string } | null = null;
  private onMovedPolicy: 'keep-tracking' | 'stop-tracking' | null = null;
  private onModifiedPolicy: 'sync-fields' | 'ignore' | null = null;

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
   * Configure this plugin's document type to auto-track documents via reconciliation.
   * Sets on_added: auto-track and track_as: tableName in the emitted schema YAML.
   * Also registers a minimal tables: entry so parsePluginSchema() validation passes.
   *
   * NOTE: buildSchemaYaml() applies policy fields to ALL document types in the manifest.
   * Only use this builder when the plugin has a single document type. For multi-type
   * plugins, construct schema YAML directly.
   */
  withAutoTrack(tableName: string, fieldMap?: Record<string, string>, template?: string): this {
    this.autoTrackConfig = { tableName, fieldMap, template };
    return this;
  }

  /**
   * Set the on_moved policy for this plugin's document types.
   * Note: use 'stop-tracking' (not 'untrack') — matches DocumentTypePolicy.on_moved.
   */
  withOnMoved(policy: 'keep-tracking' | 'stop-tracking'): this {
    this.onMovedPolicy = policy;
    return this;
  }

  /**
   * Set the on_modified policy for this plugin's document types.
   */
  withOnModified(policy: 'sync-fields' | 'ignore'): this {
    this.onModifiedPolicy = policy;
    return this;
  }

  /**
   * Build the plugin manifest and return it with the plugin ID.
   * The returned manifest can be registered in the database for tests.
   */
  build(): {
    manifest: PluginManifest;
    pluginId: string;
  } {
    const manifest: PluginManifest = {
      plugin_id: this.pluginId,
      version: this.version,
      document_types: [...this.documentTypes],
    };

    return {
      manifest,
      pluginId: this.pluginId,
    };
  }

  /**
   * Build the plugin manifest and emit schema YAML with policy fields applied.
   * Use this in tests instead of calling buildPluginSchemaYaml(manifest) directly
   * when policy builder methods (withAutoTrack, withOnMoved, withOnModified) are used.
   */
  buildSchemaYaml(): string {
    const manifest: PluginManifest = {
      plugin_id: this.pluginId,
      version: this.version,
      document_types: [...this.documentTypes],
    };
    const policy: PluginSchemaPolicy = {};
    if (this.autoTrackConfig) policy.autoTrack = this.autoTrackConfig;
    if (this.onMovedPolicy) policy.onMoved = this.onMovedPolicy;
    if (this.onModifiedPolicy) policy.onModified = this.onModifiedPolicy;
    return buildPluginSchemaYaml(manifest, Object.keys(policy).length > 0 ? policy : undefined);
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
// buildPluginSchemaYaml — Convert PluginManifest to database schema_yaml format
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a PluginManifest to the schema_yaml string format expected by the database.
 * Used when registering mock plugins in fqc_plugin_registry.
 *
 * Accepts an optional PluginSchemaPolicy to emit reconciliation policy fields
 * (on_added, on_moved, on_modified, track_as, template, field_map) and the
 * required tables: section when on_added: auto-track is used.
 *
 * @param manifest - Plugin manifest to serialize
 * @param policy - Optional policy overrides for reconciliation behaviour
 */
export function buildPluginSchemaYaml(manifest: PluginManifest, policy?: PluginSchemaPolicy): string {
  const lines = [
    `id: ${manifest.plugin_id}`,
    `name: ${manifest.plugin_id} Test Plugin`,
    `version: ${manifest.version}`,
  ];

  // Emit tables: section when auto-tracking (required by parsePluginSchema validation)
  if (policy?.autoTrack) {
    lines.push(`tables:`);
    lines.push(`  - name: ${policy.autoTrack.tableName}`);
    lines.push(`    columns: []`);
  }

  lines.push(`documents:`);
  lines.push(`  types:`);

  for (const dt of manifest.document_types) {
    lines.push(`    - id: ${dt.id}`);
    lines.push(`      folder: ${dt.folder}`);
    if (dt.description) {
      lines.push(`      description: ${dt.description}`);
    }
    if (dt.access_level) {
      lines.push(`      access_level: ${dt.access_level}`);
    }

    // Emit policy fields when set
    if (policy?.autoTrack) {
      lines.push(`      on_added: auto-track`);
      lines.push(`      track_as: ${policy.autoTrack.tableName}`);
      if (policy.autoTrack.template) {
        lines.push(`      template: ${policy.autoTrack.template}`);
      }
      if (policy.autoTrack.fieldMap && Object.keys(policy.autoTrack.fieldMap).length > 0) {
        lines.push(`      field_map:`);
        for (const [fmKey, fmVal] of Object.entries(policy.autoTrack.fieldMap)) {
          lines.push(`        ${fmKey}: ${fmVal}`);
        }
      }
    }
    if (policy?.onMoved) {
      lines.push(`      on_moved: ${policy.onMoved}`);
    }
    if (policy?.onModified) {
      lines.push(`      on_modified: ${policy.onModified}`);
    }
  }

  return lines.join('\n');
}
