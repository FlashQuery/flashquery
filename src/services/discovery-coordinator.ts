import { logger } from '../logging/logger.js';
import { invokePluginDiscoverySkill, type DiscoveryResult } from './plugin-skill-invoker.js';
import { updateDocumentOwnership } from './document-ownership.js';
import type { FlashQueryConfig } from '../config/loader.js';
import type { DiscoveryQueueItem } from '../services/scanner.js';

// ─────────────────────────────────────────────────────────────────────────────
// processDiscoveryQueueAsync — fire-and-forget async discovery processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Process a discovery queue asynchronously (fire-and-forget).
 * Called post-scan from startup sequence (src/index.ts).
 *
 * Flow:
 * 1. For each queue item (sequentially):
 *    - Invoke plugin's on_document_discovered skill
 *    - Update document ownership in database (plugin_id, type, needs_discovery=false)
 * 2. On skill error:
 *    - Log error with context
 *    - Keep needs_discovery=true for retry (Phase 56)
 *    - Continue to next item (don't abort)
 * 3. Return normally after all items processed
 *
 * @param queue - Items returned by scanner (from ScanResult.discoveryQueue)
 * @param config - FlashQuery configuration
 *
 * Precondition: Scanner must have released mutex before this is called
 * Postcondition: All queue items processed or logged as failed
 */
export async function processDiscoveryQueueAsync(
  queue: DiscoveryQueueItem[],
  config: FlashQueryConfig
): Promise<void> {
  if (queue.length === 0) {
    logger.debug('Discovery queue is empty, skipping processing');
    return;
  }

  logger.info(`Starting async discovery processing for ${queue.length} item(s)`);

  for (const item of queue) {
    try {
      logger.debug(`Processing discovery queue item: ${item.path}`, {
        fqcId: item.fqcId,
        pluginId: item.pluginId,
      });

      // Invoke plugin skill to determine ownership
      const result: DiscoveryResult = await invokePluginDiscoverySkill(item, config);

      // Update document ownership in database
      await updateDocumentOwnership(item.fqcId, {
        plugin_id: result.plugin_id,
        type: result.type,
        needs_discovery: false,  // Mark as discovered
      });

      logger.debug(`Successfully discovered ${item.path}`, {
        pluginId: result.plugin_id,
        type: result.type,
      });
    } catch (error) {
      // Log error but continue processing remaining items
      // Keep needs_discovery=true so scanner can retry in next cycle
      logger.error(
        `Discovery failed for ${item.path} (will retry next scan)`,
        error
      );
      // NO re-throw: allow other queue items to be processed
    }
  }

  logger.info(`Async discovery processing complete (${queue.length} item(s) processed)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ─────────────────────────────────────────────────────────────────────────────

export type { DiscoveryResult } from './plugin-skill-invoker.js';
export type { DiscoveryQueueItem } from '../services/scanner.js';
