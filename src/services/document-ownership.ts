import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';

// ─────────────────────────────────────────────────────────────────────────────
// UpdateOwnershipInput — parameters for updateDocumentOwnership
// ─────────────────────────────────────────────────────────────────────────────

export interface UpdateOwnershipInput {
  plugin_id?: string;        // Plugin that owns this document (null = not owned)
  type?: string;             // Document type within plugin (e.g., 'contact')
  needs_discovery: boolean;  // Mark as discovered (false) or still pending (true)
}

// ─────────────────────────────────────────────────────────────────────────────
// updateDocumentOwnership — atomic update of document ownership metadata
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a document's ownership metadata in the fqc_documents table.
 * Called after plugin discovery skill returns a result.
 *
 * - On success: Sets ownership_plugin_id, ownership_type, and needs_discovery=false
 * - On skill error: Logs error, caller keeps needs_discovery=true for retry
 *
 * @param fqcId - Document UUID
 * @param input - Ownership update parameters
 * @throws Error if database update fails
 */
export async function updateDocumentOwnership(
  fqcId: string,
  input: UpdateOwnershipInput
): Promise<void> {
  const client = supabaseManager.getClient();

  logger.debug(`Updating ownership for ${fqcId}`, {
    plugin_id: input.plugin_id,
    type: input.type,
    needs_discovery: input.needs_discovery,
  });

  // Update fqc_documents table: set ownership columns and discovery flag
  const { error } = await client
    .from('fqc_documents')
    .update({
      ownership_plugin_id: input.plugin_id || null,
      ownership_type: input.type || null,
      needs_discovery: input.needs_discovery,
    })
    .eq('id', fqcId);

  if (error) {
    logger.error(`Failed to update ownership for ${fqcId}`, error);
    throw error;
  }

  logger.debug(`Ownership updated for ${fqcId}`);
}
