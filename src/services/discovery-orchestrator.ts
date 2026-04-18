import { logger } from '../logging/logger.js';
import { getFolderClaimsMap } from '../plugins/manager.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { supabaseManager } from '../storage/supabase.js';
import type { VaultManager } from '../storage/vault.js';
import { atomicWriteFrontmatter } from '../storage/vault.js';
import { invokePluginSkills, type ChangePayload, type PluginError } from './plugin-skill-invoker.js';
import { updateDocumentOwnership } from './document-ownership.js';
import type { DiscoveryQueueItem } from './scanner.js';
import { join } from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions (Ownership & Discovery)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a single option for user selection when ownership is ambiguous.
 * Contains plugin ID, folder path, and optional type information.
 */
export interface PluginOption {
  plugin_id: string;
  folder: string;
  type?: string;
}

/**
 * Represents a folder→plugin claim from the plugin manifest system.
 */
export interface FolderClaim {
  pluginId: string;
  typeId: string;
}

/**
 * Result of ownership determination for a document.
 * Contains the determined owner, document type, source of determination,
 * and optional information about ambiguities and user selections.
 */
export interface OwnershipResult {
  /** Plugin ID that owns this document */
  plugin_id: string;
  /** Document type (e.g., "contact", "company") if determined */
  type?: string;
  /** Source of the determination: frontmatter, folder structure, or user prompt */
  source: 'frontmatter' | 'folder' | 'prompt';
  /** If ownership was ambiguous, lists competing plugins (source='prompt') */
  ambiguous_plugins?: Array<{
    plugin_id: string;
    folder: string;
    type?: string;
  }>;
  /** If determined via user prompt, contains the user's selection */
  user_selection?: {
    plugin_id: string;
    type?: string;
  };
}

/**
 * Callback function that prompts user for ownership selection.
 * Called when ownership is ambiguous (multiple plugins claim folder, or no folder match).
 *
 * @param path - Vault-relative file path (e.g., "CRM/Contacts/Sarah.md")
 * @param options - Array of plugin options user can select from
 * @returns Promise resolving to the selected plugin_id
 */
export type GetUserPrompt = (
  path: string,
  options: PluginOption[]
) => Promise<string>;

// ─────────────────────────────────────────────────────────────────────────────
// determineOwnership() — Three-Level Hierarchy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine ownership of a document using three-level hierarchy:
 * 1. Frontmatter check — if ownership field exists, return immediately
 * 2. Folder-based routing — find plugin(s) claiming this folder path
 * 3. User prompt — ask user if ambiguous (no match or multiple matches)
 *
 * **Folder Specificity:** Plugins claiming deeper folder paths (more path components)
 * take precedence. E.g., `CRM/Contacts/` beats `CRM/`.
 *
 * **Case-Insensitive Matching:** File paths and folder claims are matched
 * case-insensitively (both normalized to lowercase).
 *
 * @param path - Vault-relative file path (e.g., "CRM/Contacts/Sarah.md")
 * @param fqcId - Document UUID assigned by scanner
 * @param originalFrontmatter - Existing frontmatter from document (optional)
 * @param getUserPrompt - Function to call when user selection needed (optional)
 * @returns Promise resolving to OwnershipResult with plugin_id, type, and source
 *
 * @example
 * // Frontmatter precedence
 * const result = await determineOwnership('file.md', 'uuid-123', { ownership: 'crm/contact' });
 * // → { plugin_id: 'crm', type: 'contact', source: 'frontmatter' }
 *
 * // Folder-based routing
 * const result = await determineOwnership('CRM/Contacts/Sarah.md', 'uuid-456');
 * // → { plugin_id: 'crm', type: 'contact', source: 'folder' }
 *
 * // User prompt on ambiguity
 * const result = await determineOwnership(
 *   'CRM/Ambiguous.md',
 *   'uuid-789',
 *   undefined,
 *   async (path, options) => {
 *     // User selects from options
 *     return 'crm';
 *   }
 * );
 * // → { plugin_id: 'crm', type: 'contact', source: 'prompt', user_selection: { plugin_id: 'crm' } }
 */
export async function determineOwnership(
  path: string,
  fqcId: string,
  originalFrontmatter?: Record<string, any>,
  getUserPrompt?: GetUserPrompt
): Promise<OwnershipResult> {
  // ── Level 1: Check frontmatter ────────────────────────────────────────────
  // If ownership field exists, return immediately (skip folder and prompt)
  if (originalFrontmatter?.ownership !== undefined) {
    const ownershipField = originalFrontmatter.ownership;

    // Validate: must be string
    if (typeof ownershipField !== 'string') {
      logger.warn(
        `[OWN-03] frontmatter ownership is not a string, skipping: path=${path}, fqcId=${fqcId}`
      );
      // Fall through to folder inference
    } else {
      // Parse "plugin_id" or "plugin_id/type"
      const [pluginId, ...typeParts] = ownershipField.split('/');
      const type = typeParts.length > 0 ? typeParts.join('/') : undefined;

      if (!pluginId) {
        logger.warn(
          `[OWN-03] frontmatter ownership is empty string, skipping: path=${path}, fqcId=${fqcId}`
        );
      } else {
        logger.debug(`[OWN-03] ownership determined from frontmatter: plugin=${pluginId}, type=${type}, path=${path}`);
        return {
          plugin_id: pluginId,
          type,
          source: 'frontmatter',
        };
      }
    }
  }

  // ── Level 2: Check folder-based routing ──────────────────────────────────
  // Get folder→plugin claims from manifest system
  const folderClaimsMap = getFolderClaimsMap({} as FlashQueryConfig);

  // Normalize file path to lowercase for case-insensitive matching
  const normalizedPath = path.toLowerCase();

  // Find all plugins whose folder claim matches this file path
  // Match: file path starts with folder path
  // Track by (folder + plugin_id) to handle duplicate folders with different plugins
  const matchingClaimsMap = new Map<
    string,
    {
      folder: string;
      pluginId: string;
      typeId: string;
      specificity: number; // Number of path components (depth)
    }
  >();

  for (const [folder, claim] of folderClaimsMap) {
    // Both normalized to lowercase for matching
    if (normalizedPath.startsWith(folder)) {
      // Calculate specificity (folder depth: number of "/" + 1)
      const specificity = folder.split('/').filter((s) => s.length > 0).length;
      // Use unique key per plugin per folder
      const key = `${folder}:${claim.pluginId}`;
      matchingClaimsMap.set(key, {
        folder,
        pluginId: claim.pluginId,
        typeId: claim.typeId,
        specificity,
      });
    }
  }

  const matchingClaims = Array.from(matchingClaimsMap.values());

  if (matchingClaims.length === 0) {
    // No folder match → prompt user
    logger.debug(`[OWN-02] no folder match for path=${path}, will prompt user`);
  } else {
    // Sort by specificity (highest first)
    matchingClaims.sort((a, b) => b.specificity - a.specificity);

    const highestSpecificity = matchingClaims[0].specificity;
    const topClaims = matchingClaims.filter((c) => c.specificity === highestSpecificity);

    if (topClaims.length === 1) {
      // Exactly one plugin at highest specificity → auto-determine
      const claim = topClaims[0];
      logger.debug(
        `[OWN-02] ownership determined from folder: plugin=${claim.pluginId}, type=${claim.typeId}, folder=${claim.folder}, path=${path}`
      );
      return {
        plugin_id: claim.pluginId,
        type: claim.typeId,
        source: 'folder',
      };
    } else {
      // Multiple plugins at same specificity → ambiguous
      logger.debug(
        `[OWN-04] multiple plugins at same specificity (${topClaims.length}), will prompt user: path=${path}`
      );
    }
  }

  // ── Level 3: Ask user (ambiguous case) ────────────────────────────────────
  // Format options for user prompt
  // Build from all matching claims to show user what matched
  const allOptions: PluginOption[] = Array.from(folderClaimsMap)
    .map(([folder, claim]) => ({
      plugin_id: claim.pluginId,
      folder,
      type: claim.typeId,
    }))
    .sort((a, b) => a.plugin_id.localeCompare(b.plugin_id));

  if (!getUserPrompt) {
    // No user prompt callback provided — can't determine ownership
    logger.warn(
      `[OWN-04] ownership ambiguous but no getUserPrompt callback provided: path=${path}`
    );
    // If we have any matching claims, use the first one (from topClaims if available)
    if (matchingClaims.length > 0) {
      const firstClaim = matchingClaims[0];
      return {
        plugin_id: firstClaim.pluginId,
        type: firstClaim.typeId,
        source: 'prompt',
        ambiguous_plugins: matchingClaims.map((c) => ({
          plugin_id: c.pluginId,
          folder: c.folder,
          type: c.typeId,
        })),
      };
    }
    // No matching claims — return first available plugin (or error if none)
    if (allOptions.length > 0) {
      return {
        plugin_id: allOptions[0].plugin_id,
        type: allOptions[0].type,
        source: 'prompt',
        ambiguous_plugins: allOptions,
      };
    }
    // No plugins at all — this shouldn't happen in normal operation
    throw new Error(
      `[OWN-04] cannot determine ownership for ${path}: no plugins configured and no getUserPrompt provided`
    );
  }

  const selectedPluginId = await getUserPrompt(path, allOptions);
  const selectedOption = allOptions.find((opt) => opt.plugin_id === selectedPluginId);

  logger.info(
    `[OWN-04] ownership determined from user prompt: selected=${selectedPluginId}, path=${path}`
  );

  return {
    plugin_id: selectedPluginId,
    type: selectedOption?.type,
    source: 'prompt',
    ambiguous_plugins: allOptions,
    user_selection: {
      plugin_id: selectedPluginId,
      type: selectedOption?.type,
    },
  };
}

/**
 * Stub for user prompt implementation.
 * Will be expanded in Phase 56-03 with actual user interaction.
 * For testing, this can be mocked.
 *
 * @param path - File path to prompt about
 * @param options - Plugin options to choose from
 * @returns Promise resolving to selected plugin_id
 */
export async function getUserPromptStub(
  path: string,
  options: PluginOption[]
): Promise<string> {
  // Phase 56-03: Implement actual user prompt
  // For now, return first option
  if (options.length === 0) {
    throw new Error(`No options available for ${path}`);
  }
  return options[0].plugin_id;
}

// ─────────────────────────────────────────────────────────────────────────────
// Type Definitions (Discovery Execution)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lock object representing an acquired write lock.
 * Contains the lock ID and document path for release.
 */
export interface Lock {
  instanceId: string;
  resourceType: string;
  path: string;
}

/**
 * Result of executeDiscovery() orchestration.
 * Contains execution status, determined ownership, and performance metrics.
 */
export interface DiscoveryExecutionResult {
  /** Execution status: complete/failed/pending */
  status: 'complete' | 'failed' | 'pending';
  /** Plugin ID that owns this document (if determined) */
  plugin_id?: string;
  /** Document type (if determined) */
  type?: string;
  /** Plugin IDs claiming read-write or read-only access (watchers) */
  watchers?: string[];
  /** Errors encountered during discovery */
  errors?: Array<{ plugin_id?: string; error: string }>;
  /** Execution time in milliseconds */
  elapsed_ms: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// acquireLock() — Acquire exclusive write lock for document
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Acquire an exclusive write lock for a document path.
 * Lock timeout is 30 seconds by default; if not released within that time,
 * other processes can forcibly release it.
 *
 * @param path - Document path (vault-relative)
 * @param options - Lock options (timeout_ms)
 * @returns Lock object if successful, null if lock already held
 */
export async function acquireLock(
  path: string,
  options?: { timeout_ms?: number }
): Promise<Lock | null> {
  const timeout_ms = options?.timeout_ms ?? 30000;
  const client = supabaseManager.getClient();
  const instanceId = 'local'; // Phase 56: use 'local' for single-instance discovery

  const resourceType = `document:${path}`;

  // Attempt to insert lock into fqc_write_locks table.
  // PK is (instance_id, resource_type) — no id column; select the PK columns back.
  const { data, error } = await client
    .from('fqc_write_locks')
    .insert({
      instance_id: instanceId,
      resource_type: resourceType,
      locked_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + timeout_ms).toISOString(),
    })
    .select('instance_id, resource_type');

  if (error) {
    logger.warn(`[WRT-02] could not acquire lock for ${path}: ${error.message}`);
    return null;
  }

  if (!data || !data[0]) {
    logger.warn(`[WRT-02] lock insert succeeded but no row returned for ${path}`);
    return null;
  }

  logger.debug(`[WRT-02] acquired lock for ${path}`);
  return {
    instanceId: data[0].instance_id,
    resourceType: data[0].resource_type,
    path,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// releaseLock() — Release exclusive write lock
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Release a previously acquired write lock.
 * Safe to call even if lock has already expired or been released.
 *
 * @param lock - Lock object from acquireLock()
 */
export async function releaseLock(lock: Lock): Promise<void> {
  if (!lock) {
    return;
  }

  const client = supabaseManager.getClient();
  const { error } = await client
    .from('fqc_write_locks')
    .delete()
    .eq('instance_id', lock.instanceId)
    .eq('resource_type', lock.resourceType);

  if (error) {
    logger.warn(`[WRT-02] could not release lock for ${lock.path}: ${error.message}`);
    return;
  }

  logger.debug(`[WRT-02] released lock for ${lock.path}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// isCriticalError() — Distinguish critical vs. non-critical errors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Categorize an error as critical (database write) or non-critical (plugin/transient).
 * Critical errors should abort discovery; non-critical errors should be logged but allow retry.
 *
 * @param error - Error object to categorize
 * @returns true if error is critical (requires abort), false if non-critical
 */
function isCriticalError(error: any): boolean {
  // Check if this is a Supabase database error (table='fqc_documents')
  if (error && typeof error === 'object') {
    // Supabase errors have a 'message' property and may have table context
    if (error.message && error.message.includes('fqc_documents')) {
      return true;
    }
    // Also check for database-level errors
    if (error.code && (error.code === '42P01' || error.code === '42703')) {
      return true; // PostgreSQL: undefined table or column
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// executeDiscovery() — Full orchestration with lock, DB-first writes, atomicity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute complete discovery workflow for a single document:
 * 1. Acquire exclusive lock (30s timeout)
 * 2. Determine ownership (frontmatter → folder → user prompt)
 * 3. Invoke plugin skills (on_document_discovered)
 * 4. Write DB record (discovery_status='complete')
 * 5. Write frontmatter atomically (.fqc-tmp pattern)
 * 6. Release lock (guaranteed in finally)
 *
 * **Database-First Strategy (WRT-01):**
 * - DB write happens BEFORE frontmatter write
 * - If DB succeeds but frontmatter fails, next scan detects via content-hash
 * - If DB fails, abort and set discovery_status='failed' for manual review
 *
 * **Error Handling:**
 * - Plugin errors (ERR-01): logged WARNING, discovery_status='pending', don't update DB
 * - DB write errors: logged ERROR, discovery_status='failed', abort
 * - Frontmatter write errors (ERR-02): logged DEBUG, discovery_status='complete', don't throw
 *
 * @param item - Discovery queue item (fqcId, path, pluginId)
 * @param config - FlashQuery config (vault path, instance ID)
 * @param vault - Vault manager for frontmatter I/O
 * @returns DiscoveryExecutionResult with status, ownership, elapsed_ms
 */
export async function executeDiscovery(
  item: DiscoveryQueueItem,
  config: FlashQueryConfig,
  vault: VaultManager
): Promise<DiscoveryExecutionResult> {
  const startTime = performance.now();
  let lock: Lock | null = null;

  try {
    // Step 1: Acquire lock (timeout 30s)
    lock = await acquireLock(item.path, { timeout_ms: 30000 });
    if (!lock) {
      logger.warn(`[WRT-02] could not acquire lock for ${item.path}, discovery pending`);
      return {
        status: 'pending',
        elapsed_ms: performance.now() - startTime,
      };
    }

    // Step 2: Load document's existing frontmatter
    let originalFrontmatter: Record<string, any> = {};
    try {
      const doc = await vault.readMarkdown(item.path);
      originalFrontmatter = doc.data;
    } catch (err) {
      logger.warn(`[WRT-02] could not read document frontmatter ${item.path}`, err);
      // Continue with empty frontmatter
    }

    // Step 3: Determine ownership (Level 1: frontmatter, Level 2: folder, Level 3: user prompt)
    let ownership: OwnershipResult;
    try {
      ownership = await determineOwnership(
        item.path,
        item.fqcId,
        originalFrontmatter,
        undefined // Phase 56-03 will provide getUserPrompt
      );
    } catch (ownershipErr) {
      // When no plugins are configured, fall back to the queue item's pluginId hint
      if (item.pluginId) {
        logger.warn(
          `[OWN-04] ownership determination failed, using queue item pluginId: ${item.pluginId}, path=${item.path}`
        );
        ownership = { plugin_id: item.pluginId, source: 'folder' };
      } else {
        throw ownershipErr;
      }
    }

    // Step 4: Invoke plugin skills (sequentially, in-process)
    const invocationResult = await invokePluginSkills(
      item.path,
      item.fqcId,
      { plugin_id: ownership.plugin_id, type: ownership.type },
      originalFrontmatter,
      config
    );

    // Step 5: Write database record (database-first per WRT-01)
    try {
      // Transform watcher results into proper watcher_claims structure
      const watcherClaims = invocationResult.watcher_plugin_ids?.map((plugin_id) => ({
        plugin_id,
        intent: 'read-write', // TODO: Phase 56-03 will differentiate read-write vs read-only
      })) || [];

      await updateDocumentOwnership(item.fqcId, {
        plugin_id: ownership.plugin_id,
        type: ownership.type,
        needs_discovery: false, // Mark as discovered
      });

      // Also write watcher_claims to database if needed
      // TODO: Phase 56-02 Task 2 will add watcher_claims column update
      logger.debug(`[WRT-01] database record written for ${item.path}`);
    } catch (dbError) {
      logger.error(`[ERR-01] database write failed for ${item.path}`, dbError);
      // Set discovery_status='failed' for manual review
      try {
        const client = supabaseManager.getClient();
        await client
          .from('fqc_documents')
          .update({ needs_discovery: true }) // Reset needs_discovery for retry
          .eq('id', item.fqcId);
      } catch (updateErr) {
        logger.warn(`[ERR-01] could not mark discovery_status failed: ${updateErr}`);
      }
      throw dbError;
    }

    // Step 6: Write frontmatter atomically (per WRT-03)
    try {
      // Get vault root path from config to construct absolute path
      const vaultPath = config.instance.vault.path;
      const absolutePath = join(vaultPath, item.path);

      // Update ownership field in frontmatter
      const updates = {
        ownership: `${ownership.plugin_id}${ownership.type ? `/${ownership.type}` : ''}`,
      };

      await atomicWriteFrontmatter(absolutePath, updates);
      logger.debug(`[WRT-03] frontmatter written atomically for ${item.path}`);
    } catch (frontmatterError) {
      // Non-critical: DB already committed, next scan will retry
      logger.debug(`[ERR-02] frontmatter write failed (will retry next scan): ${item.path}`);
      // Don't throw: let discovery complete status remain
    }

    // Step 7: Return success result
    return {
      status: 'complete',
      plugin_id: ownership.plugin_id,
      type: ownership.type,
      watchers: invocationResult.watcher_plugin_ids,
      errors: invocationResult.errors.length > 0 ? invocationResult.errors : undefined,
      elapsed_ms: performance.now() - startTime,
    };
  } catch (error) {
    logger.error(`[ERR-01] discovery failed for ${item.path}`, error);
    return {
      status: 'failed',
      errors: [{ error: String(error) }],
      elapsed_ms: performance.now() - startTime,
    };
  } finally {
    // Step 8: Always release lock
    if (lock) {
      await releaseLock(lock);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getWatcherMap() — Phase 58: Retrieve watcher information from database
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retrieve watcher plugin claims from database for a document.
 *
 * Queries the fqc_documents table for watcher_claims JSONB column.
 * Format: { "plugin_id_1": "read_write_watcher", "plugin_id_2": "read_only_watcher", ... }
 *
 * Transforms format from {plugin_id: claim_type} to Map<claim_type, plugin_ids[]>
 * for use in invokeChangeNotifications().
 *
 * @param fqcId - Document UUID
 * @returns Promise resolving to Map<claim_type, plugin_id[]> (empty Map if no watchers)
 */
export async function getWatcherMap(fqcId: string): Promise<Map<string, string[]>> {
  const supabase = supabaseManager.getClient();

  try {
    const { data, error } = await supabase
      .from('fqc_documents')
      .select('watcher_claims')
      .eq('id', fqcId)
      .single();

    if (error || !data) {
      logger.warn(`[NOTIF-01] Failed to fetch watcher_claims for document ${fqcId}`);
      return new Map();
    }

    // Transform watcher_claims JSONB into Map<claim_type, plugin_ids[]>
    // Input: { "plugin_1": "read_write_watcher", "plugin_2": "read_only_watcher" }
    // Output: Map { "read_write_watcher" => ["plugin_1"], "read_only_watcher" => ["plugin_2"] }
    const watcherMap = new Map<string, string[]>();

    // Distinguish between "field is null/empty" vs "field is missing from schema"
    if (data.watcher_claims === undefined) {
      logger.warn(`[NOTIF-02] watcher_claims field missing for document ${fqcId} — possible schema mismatch`);
    }

    const claims = (data.watcher_claims as Record<string, string>) || {};

    for (const [pluginId, claimType] of Object.entries(claims)) {
      if (!watcherMap.has(claimType)) {
        watcherMap.set(claimType, []);
      }
      watcherMap.get(claimType)!.push(pluginId);
    }

    return watcherMap;
  } catch (err) {
    logger.error(`[NOTIF-01] Error fetching watcher_claims: ${err instanceof Error ? err.message : String(err)}`);
    return new Map();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// invokeChangeNotifications() — Phase 58: Invoke change callbacks synchronously
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
 * @returns Promise resolving to result with plugin results and errors
 */
export async function invokeChangeNotifications(
  docPath: string,
  fqcId: string,
  changePayload: ChangePayload | null,
  ownerPluginId: string | null,
  watcherMap: Map<string, string[]>,
  skill: 'on_document_changed' | 'on_document_deleted'
): Promise<{
  pluginResults: Map<string, { acknowledged: boolean; error?: string }>;
  errors: PluginError[];
}> {
  const pluginResults = new Map<string, { acknowledged: boolean; error?: string }>();
  const errors: PluginError[] = [];

  // Helper function to invoke a single plugin skill dynamically
  const invokePluginSkill = async (
    pluginId: string,
    skillName: string,
    args: any[]
  ): Promise<{ acknowledged: boolean; error?: string }> => {
    // Placeholder implementation — actual plugin skill loading deferred to v2.5+
    logger.debug(`[NOTIF-01] Invoking ${skillName} on plugin ${pluginId}`);
    return { acknowledged: true };
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
      logger.error(`[ERR] Failed to invoke ${skill} on owner ${ownerPluginId}: ${errMsg}`);
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
        logger.warn(`[WRN] Failed to invoke ${skill} on watcher ${watcherId}: ${errMsg}`);
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
        logger.warn(`[WRN] Failed to invoke ${skill} on watcher ${watcherId}: ${errMsg}`);
        errors.push({ plugin_id: watcherId, error: errMsg });
        pluginResults.set(watcherId, { acknowledged: false, error: errMsg });
      }
    }
  }

  return { pluginResults, errors };
}
