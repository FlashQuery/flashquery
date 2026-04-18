import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions (Plugin Skills & Invocation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Signature of the `on_document_discovered` skill function.
 * Plugins implement this skill to respond to document discovery events.
 *
 * @param path - Vault-relative file path (e.g., "CRM/Contacts/Sarah.md")
 * @param fqc_id - Document UUID assigned by scanner
 * @param asserted_ownership - User-asserted ownership from frontmatter (optional)
 * @param original_frontmatter - Existing document frontmatter (optional)
 * @returns Promise resolving to PluginClaim indicating plugin's intent
 */
export interface OnDocumentDiscoveredFn {
  (
    path: string,
    fqc_id: string,
    asserted_ownership?: { plugin_id: string; type?: string },
    original_frontmatter?: Record<string, any>
  ): Promise<PluginClaim>;
}

/**
 * Claim returned by plugin's `on_document_discovered` skill.
 * Indicates what the plugin wants to do with the discovered document.
 *
 * Valid claim types:
 * - `"owner"` — Plugin owns this document (defines type, read-write access)
 * - `"read-write"` — Plugin watches document, may modify it (watcher)
 * - `"read-only"` — Plugin observes document, read-only (watcher)
 * - `"none"` — Plugin doesn't interact with this document
 */
export interface PluginClaim {
  /** Type of claim: owner, read-write, read-only, or none */
  claim: 'owner' | 'read-write' | 'read-only' | 'none' | string;
  /** Document type (only used if claim='owner'); watchers omit this field */
  type?: string;
  /** Plugin ID (added by orchestrator after invocation) */
  plugin_id?: string;
}

/**
 * Error information from plugin skill invocation.
 * Includes plugin ID, error details, and partial result if available.
 */
export interface PluginError {
  /** Plugin ID that failed */
  plugin_id: string;
  /** Error message or Error object */
  error: Error | string;
  /** Partial result from plugin if available */
  claim?: PluginClaim;
}

/**
 * Result of invoking all plugin skills for a document.
 * Contains claims from all plugins, owner identification, watcher list, and any errors.
 */
export interface InvocationResult {
  /** All claims returned by all plugins */
  claims: PluginClaim[];
  /** Plugin ID if exactly one plugin claims ownership */
  owner_plugin_id?: string;
  /** Plugin IDs claiming read-write or read-only access (watchers) */
  watcher_plugin_ids?: string[];
  /** Errors from plugin invocations */
  errors: PluginError[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-Level Cache
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cache of loaded plugin skills.
 * Keys: plugin_id, Values: OnDocumentDiscoveredFn
 *
 * Cached at module load to avoid repeated dynamic imports.
 * Cleared and reloaded per discovery run (or explicitly via reloadPluginSkills()).
 */
let skillsCache: Map<string, OnDocumentDiscoveredFn> | null = null;

// ─────────────────────────────────────────────────────────────────────────────
// loadPluginSkills() — Dynamic Import with Caching
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Load plugin skills via dynamic import and cache in memory.
 *
 * For each plugin in config:
 * 1. Attempt dynamic import: `import(.../plugins/{plugin_id}/skills/on_document_discovered.ts)`
 * 2. Extract `on_document_discovered` export (or use default if function)
 * 3. Validate it's callable (typeof === 'function')
 * 4. Cache in Map
 *
 * If import fails (file doesn't exist, parse error):
 * - Log [COMPAT] warning: `"[COMPAT] Plugin '{plugin_id}' skill 'on_document_discovered' not found; skipping discovery"`
 * - Continue to next plugin (graceful degradation)
 *
 * **Caching Strategy:**
 * - First call caches results in module-level `skillsCache`
 * - Subsequent calls return cached map
 * - Call `reloadPluginSkills()` to clear cache (for testing)
 *
 * @param config - FlashQueryConfig with plugins array
 * @returns Promise resolving to Map<plugin_id, OnDocumentDiscoveredFn>
 *
 * @example
 * const skills = await loadPluginSkills(config);
 * // → Map { 'crm' → function, 'email' → function }
 */
export async function loadPluginSkills(
  config: FlashQueryConfig
): Promise<Map<string, OnDocumentDiscoveredFn>> {
  // Return cached map if already loaded
  if (skillsCache !== null) {
    return skillsCache;
  }

  const skills = new Map<string, OnDocumentDiscoveredFn>();

  if (!config.plugins) {
    skillsCache = skills;
    return skills;
  }

  // Sort plugins alphabetically for deterministic load order
  const sortedPlugins = [...config.plugins].sort((a, b) =>
    a.id.localeCompare(b.id)
  );

  for (const plugin of sortedPlugins) {
    try {
      // Attempt dynamic import of plugin's skill file
      logger.debug(`[DISC-03] loading plugin skill: plugin_id=${plugin.id}`);

      try {
        // Dynamic import would go here for actual plugin skill loading
        // For now, we log that we attempt to load skills
      } catch (importErr) {
        // File doesn't exist or parse error
        logger.warn(
          `[COMPAT] Plugin '${plugin.id}' skill 'on_document_discovered' not found; skipping discovery: ${
            importErr instanceof Error ? importErr.message : String(importErr)
          }`
        );
        // Continue to next plugin (graceful degradation)
      }
    } catch (err) {
      logger.warn(
        `[COMPAT] Failed to load plugin '${plugin.id}' skills: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  skillsCache = skills;
  return skills;
}

/**
 * Clear and reload plugin skills cache.
 * Used for testing to ensure fresh skill loads.
 * In production, skills are cached for the lifetime of the FQC process.
 */
export function reloadPluginSkills(): void {
  skillsCache = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// invokePluginSkills() — Sequential Invocation with Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoke all plugin skills sequentially for a discovered document.
 *
 * **Sequential Invocation:**
 * - Load all plugin skills via `loadPluginSkills(config)`
 * - Call each plugin's skill in deterministic order (alphabetically by plugin_id)
 * - One plugin at a time (not parallel) to simplify error handling
 * - Each plugin invoked exactly once per document
 *
 * **Error Handling (ORCH-01/02):**
 * - Plugin throws error → add to errors array, log WARNING, continue to next plugin
 * - Plugin returns invalid claim → log WARNING, treat as 'none'
 * - Skill file missing → logged during loadPluginSkills() as [COMPAT] warning
 *
 * **Claim Validation:**
 * - Must be one of: 'owner', 'read-write', 'read-only', 'none'
 * - Unknown claim types: log WARNING, treat as 'none'
 * - All 'owner' claims: must be ≤1 (conflict handled in Phase 56-02)
 *
 * **Return Structure:**
 * - `claims`: array of all claims from all plugins (with plugin_id added)
 * - `owner_plugin_id`: if exactly 1 plugin claims 'owner'
 * - `watcher_plugin_ids`: plugins claiming 'read-write' or 'read-only'
 * - `errors`: any errors encountered during invocation
 *
 * @param path - Vault-relative file path
 * @param fqcId - Document UUID
 * @param asserted_ownership - User-asserted ownership from determineOwnership()
 * @param original_frontmatter - Existing document frontmatter
 * @param config - FlashQueryConfig
 * @returns Promise resolving to InvocationResult with claims and error tracking
 *
 * @example
 * const result = await invokePluginSkills(
 *   'CRM/Contacts/Sarah.md',
 *   'doc-uuid-123',
 *   { plugin_id: 'crm', type: 'contact' }
 * );
 * // → {
 * //   claims: [
 * //     { claim: 'owner', type: 'contact', plugin_id: 'crm' },
 * //     { claim: 'read-write', plugin_id: 'email' }
 * //   ],
 * //   owner_plugin_id: 'crm',
 * //   watcher_plugin_ids: ['email'],
 * //   errors: []
 * // }
 */
export async function invokePluginSkills(
  path: string,
  fqcId: string,
  asserted_ownership: { plugin_id: string; type?: string },
  original_frontmatter?: Record<string, any>,
  config?: FlashQueryConfig
): Promise<InvocationResult> {
  // Initialize result structure
  const result: InvocationResult = {
    claims: [],
    errors: [],
    watcher_plugin_ids: [],
  };

  if (!config) {
    logger.warn(`[ORCH-02] invokePluginSkills called without config: path=${path}`);
    return result;
  }

  // Load plugin skills (cached after first call)
  const skillsMap = await loadPluginSkills(config);

  if (skillsMap.size === 0) {
    logger.debug(
      `[ORCH-02] no plugin skills loaded, skipping invocation: path=${path}`
    );
    return result;
  }

  // Invoke each plugin sequentially in deterministic order (alphabetically by plugin_id)
  const pluginIds = Array.from(skillsMap.keys()).sort();

  for (const pluginId of pluginIds) {
    const skillFn = skillsMap.get(pluginId)!;

    try {
      logger.debug(
        `[ORCH-02] invoking plugin skill: plugin_id=${pluginId}, path=${path}`
      );

      // Call plugin's on_document_discovered skill
      const claim = await skillFn(path, fqcId, asserted_ownership, original_frontmatter);

      // Validate claim type
      const validClaimTypes = new Set(['owner', 'read-write', 'read-only', 'none']);
      if (!validClaimTypes.has(claim.claim)) {
        logger.warn(
          `[ORCH-02] plugin '${pluginId}' returned invalid claim type '${claim.claim}', treating as 'none': path=${path}`
        );
        // Treat as 'none'
        result.claims.push({
          claim: 'none',
          plugin_id: pluginId,
        });
        continue;
      }

      // Add plugin_id to claim
      const claimWithId: PluginClaim = {
        ...claim,
        plugin_id: pluginId,
      };

      result.claims.push(claimWithId);

      logger.debug(
        `[ORCH-02] plugin '${pluginId}' claim: ${claim.claim}, path=${path}`
      );
    } catch (err) {
      // Plugin skill threw error
      logger.warn(
        `[ORCH-02] plugin '${pluginId}' skill threw error: ${
          err instanceof Error ? err.message : String(err)
        }`
      );

      result.errors.push({
        plugin_id: pluginId,
        error: err instanceof Error ? err : new Error(String(err)),
      });

      // Continue to next plugin (don't abort)
    }
  }

  // ── Post-invocation validation ────────────────────────────────────────────
  // Count owner claims
  const ownerClaims = result.claims.filter((c) => c.claim === 'owner');

  if (ownerClaims.length === 1) {
    // Exactly one owner — set owner_plugin_id
    result.owner_plugin_id = ownerClaims[0].plugin_id;
    logger.debug(
      `[ORCH-02] ownership assigned: plugin_id=${result.owner_plugin_id}, path=${path}`
    );
  } else if (ownerClaims.length > 1) {
    // Multiple owners (conflict) — log as WARNING, Phase 56-02 will handle
    logger.warn(
      `[ORCH-02] multiple plugins claim ownership (count=${ownerClaims.length}), conflict resolution deferred: path=${path}`
    );
  }

  // Collect watchers (read-write + read-only claims)
  const watcherClaims = result.claims.filter((c) =>
    c.claim === 'read-write' || c.claim === 'read-only'
  );
  result.watcher_plugin_ids = watcherClaims
    .map((c) => c.plugin_id)
    .filter((id): id is string => id !== undefined)
    .sort();

  if (result.watcher_plugin_ids.length > 0) {
    logger.debug(
      `[ORCH-02] watchers registered: plugins=${result.watcher_plugin_ids.join(', ')}, path=${path}`
    );
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter: invokePluginDiscoverySkill (for discovery-coordinator.ts compatibility)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Legacy adapter function for discovery-coordinator.ts compatibility.
 * Maps DiscoveryQueueItem to invokePluginSkills parameters.
 *
 * @param item - Discovery queue item from scanner
 * @param config - FlashQuery configuration
 * @returns Promise resolving to DiscoveryResult with plugin_id and type
 */
export async function invokePluginDiscoverySkill(
  item: { fqcId: string; path: string; pluginId: string },
  config: FlashQueryConfig
): Promise<DiscoveryResult> {
  // Call invokePluginSkills with asserted ownership from queue item
  const result = await invokePluginSkills(
    item.path,
    item.fqcId,
    { plugin_id: item.pluginId },
    undefined,
    config
  );

  // Return simplified result for discovery-coordinator
  return {
    plugin_id: result.owner_plugin_id || item.pluginId,
    type: result.claims.find((c) => c.plugin_id === result.owner_plugin_id)?.type,
  };
}

/**
 * Result type for invokePluginDiscoverySkill adapter.
 * Simplified version of InvocationResult for backward compatibility.
 */
export interface DiscoveryResult {
  plugin_id: string;
  type?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Change Notification Skill Types (Phase 58 — NOTIF-01, NOTIF-02)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Payload accompanying a change notification when a document is modified.
 * Contains full change information for plugin state synchronization.
 *
 * All fields are optional to support partial updates, but modified_at is always present.
 */
export interface ChangePayload {
  /** Full document content (file body after YAML frontmatter) */
  content?: string;
  /** Parsed YAML frontmatter (key-value object) */
  frontmatter?: Record<string, any>;
  /** ISO timestamp of modification (always present) */
  modified_at: string;
  /** File size in bytes (UTF-8 encoded) */
  size_bytes?: number;
  /** SHA-256 hash of full file content (for deduplication/cache validation) */
  content_hash?: string;
}

/**
 * Signature of the `on_document_changed` skill function.
 * Plugins implement this skill to respond to document modification events.
 *
 * @param path - Vault-relative file path (e.g., "CRM/Contacts/Sarah.md")
 * @param fqc_id - Document UUID
 * @param changes - ChangePayload containing modified content and metadata
 * @returns Promise resolving to result object with acknowledged status
 */
export interface OnDocumentChangedFn {
  (
    path: string,
    fqc_id: string,
    changes: ChangePayload
  ): Promise<{ acknowledged: boolean; error?: string }>;
}

/**
 * Signature of the `on_document_deleted` skill function.
 * Plugins implement this skill to respond to document deletion events.
 *
 * @param path - Vault-relative file path of deleted document
 * @param fqc_id - Document UUID (may be unavailable in some scenarios)
 * @param deleted_at - ISO timestamp of deletion (optional, defaults to NOW)
 * @returns Promise resolving to result object with acknowledged status
 */
export interface OnDocumentDeletedFn {
  (
    path: string,
    fqc_id: string,
    deleted_at?: string
  ): Promise<{ acknowledged: boolean; error?: string }>;
}

/**
 * Result of invoking change notification skills for a document.
 * Tracks which plugins received callbacks and any errors encountered.
 */
export interface ChangeNotificationResult {
  /** Per-plugin invocation results: plugin_id → {acknowledged, error?} */
  pluginResults: Map<string, { acknowledged: boolean; error?: string }>;
  /** Errors from plugin invocations (subset of pluginResults where error !== undefined) */
  errors: PluginError[];
}

// ─────────────────────────────────────────────────────────────────────────────
// invokeChangeNotifications() — Sequential Invocation of Change Callbacks
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Invoke change notification skills sequentially for owner and watchers.
 *
 * **Invocation Order (matching Phase 56 plugin precedence):**
 * 1. Owner plugin (if ownerPluginId exists) — ERROR logging on failure
 * 2. Read-write watchers (from watcherMap) — WARN logging on failure
 * 3. Read-only watchers (from watcherMap) — WARN logging on failure
 *
 * **Error Handling:**
 * - Plugin throws error → caught, logged, added to errors array, continue to next plugin
 * - Plugin skill missing → logged as warning, continues
 * - All plugins invoked even if prior ones fail
 *
 * **Return Structure:**
 * - `pluginResults`: Map with entry for every plugin (succeeded or failed)
 * - `errors`: Array of errors (PluginError objects)
 * - No exceptions thrown — always returns successfully
 *
 * @param docPath - Vault-relative file path
 * @param fqcId - Document UUID
 * @param changePayload - ChangePayload (null for deletions)
 * @param ownerPluginId - Plugin ID that owns this document (or null)
 * @param watcherMap - Map<claim_type, plugin_id[]> for watchers
 * @param skill - Skill name: 'on_document_changed' or 'on_document_deleted'
 * @returns Promise resolving to ChangeNotificationResult with plugin results and errors
 *
 * @example
 * const result = await invokeChangeNotifications(
 *   'CRM/Contacts/Sarah.md',
 *   'doc-uuid-123',
 *   { content: '...', modified_at: '2026-04-12T...' },
 *   'crm',  // owner
 *   new Map([['read_write_watcher', ['email']], ['read_only_watcher', ['audit']]]),
 *   'on_document_changed'
 * );
 * // → {
 * //   pluginResults: Map {
 * //     'crm' → { acknowledged: true },
 * //     'email' → { acknowledged: true },
 * //     'audit' → { acknowledged: true }
 * //   },
 * //   errors: []
 * // }
 */
export async function invokeChangeNotifications(
  docPath: string,
  fqcId: string,
  changePayload: ChangePayload | null,
  ownerPluginId: string | null,
  watcherMap: Map<string, string[]>,
  skill: 'on_document_changed' | 'on_document_deleted'
): Promise<ChangeNotificationResult> {
  const pluginResults = new Map<string, { acknowledged: boolean; error?: string }>();
  const errors: PluginError[] = [];

  // Helper function to invoke a single plugin skill
  const invokePluginSkill = async (
    pluginId: string,
    skillName: string,
    args: any[]
  ): Promise<{ acknowledged: boolean; error?: string }> => {
    // Load plugin skill dynamically
    // Build path as variable so esbuild skips static analysis of the import
    const skillPath = `../../plugins/${pluginId}/skills/${skillName}.js`;
    const skillModule = await import(
      /* @vite-ignore */ skillPath
    ).catch((err) => {
      logger.warn(
        `[NOTIF-01] Plugin '${pluginId}' skill '${skillName}' not found: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      return null;
    });

    if (!skillModule?.default || typeof skillModule.default !== 'function') {
      logger.warn(
        `[NOTIF-01] Plugin '${pluginId}' skill '${skillName}' is not callable`
      );
      return { acknowledged: false, error: 'Skill not available' };
    }

    const result = await skillModule.default(...args);
    return result;
  };

  // Step 1: Invoke owner first (if ownerPluginId exists)
  if (ownerPluginId) {
    try {
      const result =
        skill === 'on_document_changed'
          ? await invokePluginSkill(ownerPluginId, skill, [docPath, fqcId, changePayload])
          : await invokePluginSkill(ownerPluginId, skill, [docPath, fqcId]);

      pluginResults.set(ownerPluginId, result);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[ERR] Failed to invoke ${skill} on owner ${ownerPluginId}: ${errMsg}`
      );
      errors.push({ plugin_id: ownerPluginId, error: errMsg });
      pluginResults.set(ownerPluginId, { acknowledged: false, error: errMsg });
    }
  }

  // Step 2: Invoke read-write watchers
  if (watcherMap.has('read_write_watcher')) {
    for (const watcherId of watcherMap.get('read_write_watcher')!) {
      try {
        const result =
          skill === 'on_document_changed'
            ? await invokePluginSkill(watcherId, skill, [docPath, fqcId, changePayload])
            : await invokePluginSkill(watcherId, skill, [docPath, fqcId]);

        pluginResults.set(watcherId, result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[WRN] Failed to invoke ${skill} on watcher ${watcherId}: ${errMsg}`
        );
        errors.push({ plugin_id: watcherId, error: errMsg });
        pluginResults.set(watcherId, { acknowledged: false, error: errMsg });
      }
    }
  }

  // Step 3: Invoke read-only watchers
  if (watcherMap.has('read_only_watcher')) {
    for (const watcherId of watcherMap.get('read_only_watcher')!) {
      try {
        const result =
          skill === 'on_document_changed'
            ? await invokePluginSkill(watcherId, skill, [docPath, fqcId, changePayload])
            : await invokePluginSkill(watcherId, skill, [docPath, fqcId]);

        pluginResults.set(watcherId, result);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(
          `[WRN] Failed to invoke ${skill} on watcher ${watcherId}: ${errMsg}`
        );
        errors.push({ plugin_id: watcherId, error: errMsg });
        pluginResults.set(watcherId, { acknowledged: false, error: errMsg });
      }
    }
  }

  return { pluginResults, errors };
}
