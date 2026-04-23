import { supabaseManager } from '../storage/supabase.js';
import { parsePluginSchema } from '../plugins/manager.js';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface FolderMapping {
  pluginId: string;
  pluginInstance: string;
  typeId: string;
  description?: string;
}

interface ManifestLoaderState {
  folderMappings: Map<string, FolderMapping>;
  lastLoadedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton state
// ─────────────────────────────────────────────────────────────────────────────

const manifestLoaderState: ManifestLoaderState = {
  folderMappings: new Map(),
  lastLoadedAt: new Date(0),
};

// ─────────────────────────────────────────────────────────────────────────────
// loadPluginManifests(config) — Load manifests from database and build folder mappings
// ─────────────────────────────────────────────────────────────────────────────

export async function loadPluginManifests(config: FlashQueryConfig): Promise<Map<string, FolderMapping>> {
  const folderMappings = new Map<string, FolderMapping>();

  try {
    // Get Supabase client and query active plugins
    const supabase = supabaseManager.getClient();
    const { data: plugins, error } = await supabase
      .from('fqc_plugin_registry')
      .select('plugin_id, plugin_instance, schema_yaml')
      .eq('instance_id', config.instance.id)
      .eq('status', 'active');

    if (error) {
      logger.warn(`Failed to load plugin manifests from database: ${error.message}`);
      return folderMappings; // Return empty map on error (graceful degradation)
    }

    if (!plugins || plugins.length === 0) {
      logger.info('Plugin manifests loaded: 0 folder mapping(s) from 0 plugin(s)');
      manifestLoaderState.folderMappings = folderMappings;
      manifestLoaderState.lastLoadedAt = new Date();
      return folderMappings;
    }

    // Track plugin count and total mappings for logging
    let pluginCount = 0;
    let mappingCount = 0;

    // Process each plugin
    for (const plugin of plugins) {
      try {
        // Parse the plugin schema
        const schema = parsePluginSchema(plugin.schema_yaml as string);

        // Validate that documents section exists
        if (!schema.documents || schema.documents === null) {
          logger.warn(
            `[COMPAT] Manifest validation: plugin '${plugin.plugin_id}' instance '${plugin.plugin_instance || 'default'}' has no documents section (must be present, even if empty)`
          );
          continue;
        }

        pluginCount++;

        // Extract document types from schema
        const types = schema.documents.types ?? [];

        // Add each document type to the folder mappings
        for (const docType of types) {
          const existingMapping = folderMappings.get(docType.folder);
          if (existingMapping) {
            logger.warn(
              `Plugin '${schema.plugin.id}' claims folder '${docType.folder}' already claimed by '${existingMapping.pluginId}' (overwriting claim)`
            );
          }

          folderMappings.set(docType.folder, {
            pluginId: schema.plugin.id,
            pluginInstance: (plugin.plugin_instance as string | null | undefined) || 'default',
            typeId: docType.id,
            description: docType.description,
          });

          mappingCount++;
        }
      } catch (parseErr: unknown) {
        const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
        logger.error(
          `Failed to parse manifest for plugin '${plugin.plugin_id}' instance '${plugin.plugin_instance || 'default'}': ${message}`
        );
        continue; // Continue to next plugin on error
      }
    }

    // Log summary
    logger.info(`Plugin manifests loaded: ${mappingCount} folder mapping(s) from ${pluginCount} plugin(s)`);

    // Update state
    manifestLoaderState.folderMappings = folderMappings;
    manifestLoaderState.lastLoadedAt = new Date();

    return folderMappings;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`Failed to load plugin manifests: ${message}`);
    return folderMappings; // Return empty map on unexpected error
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// reloadManifests(config) — Reload manifests (used after plugin registration)
// ─────────────────────────────────────────────────────────────────────────────

export async function reloadManifests(config: FlashQueryConfig): Promise<Map<string, FolderMapping>> {
  return loadPluginManifests(config);
}

// ─────────────────────────────────────────────────────────────────────────────
// getFolderMappings() — Get current folder mappings
// ─────────────────────────────────────────────────────────────────────────────

export function getFolderMappings(): Map<string, FolderMapping> {
  return manifestLoaderState.folderMappings;
}

// ─────────────────────────────────────────────────────────────────────────────
// matchesFolderClaim(filePath, claimedFolder) — Case-insensitive recursive prefix matching
// ─────────────────────────────────────────────────────────────────────────────

export function matchesFolderClaim(filePath: string, claimedFolder: string): boolean {
  // Normalize to lowercase for case-insensitive comparison
  const normalizedPath = filePath.toLowerCase();
  const normalizedFolder = claimedFolder.toLowerCase();

  // Remove trailing slashes for consistent comparison
  const cleanPath = normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath;
  const cleanFolder = normalizedFolder.endsWith('/') ? normalizedFolder.slice(0, -1) : normalizedFolder;

  // Return true if:
  // 1. Path equals folder exactly, OR
  // 2. Path starts with folder + '/' (recursive prefix match)
  return cleanPath === cleanFolder || cleanPath.startsWith(cleanFolder + '/');
}
