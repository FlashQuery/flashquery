import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/types.js';
import { createCoreEmbeddingColumnSet, supabaseManager } from '../storage/supabase.js';

export interface EmbeddingCatalogSyncResult {
  inserted: number;
  updated: number;
  deactivated: number;
  reactivated: number;
}

interface CatalogEndpointRow {
  provider_name: string;
  model: string;
  rate_limit?: { min_delay_ms?: number };
  max_input_chars?: number;
}

interface CatalogRow {
  name: string;
  dimensions: number;
  endpoints: CatalogEndpointRow[];
  source: string;
  status: 'active' | 'deactivated';
}

function endpointToRow(endpoint: NonNullable<FlashQueryConfig['embeddings']>[number]['endpoints'][number]): CatalogEndpointRow {
  return {
    provider_name: endpoint.providerName,
    model: endpoint.model,
    ...(endpoint.rateLimit ? { rate_limit: { min_delay_ms: endpoint.rateLimit.minDelayMs } } : {}),
    ...(endpoint.maxInputChars !== undefined ? { max_input_chars: endpoint.maxInputChars } : {}),
  };
}

function modelSet(endpoints: Array<{ model: string }>): string[] {
  return [...new Set(endpoints.map((endpoint) => endpoint.model))].sort();
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function endpointsEqual(left: CatalogEndpointRow[], right: CatalogEndpointRow[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function affectedTablesForEntry(_name: string): string[] {
  // Phase 165-01 owns core catalog sync. Plugin table ownership arrives with plugin
  // embedding registration in Phase 166, where this list can be extended.
  return ['fqc_documents', 'fqc_memory'];
}

function buildIdentityRefusalError(
  existing: CatalogRow,
  incoming: NonNullable<FlashQueryConfig['embeddings']>[number]
): Error {
  const oldModels = modelSet(existing.endpoints);
  const newModels = modelSet(incoming.endpoints);
  const changes: string[] = [];

  if (existing.dimensions !== incoming.dimensions) {
    changes.push(`  - dimensions changed from ${existing.dimensions} to ${incoming.dimensions}`);
  }
  if (!arraysEqual(oldModels, newModels)) {
    changes.push(`  - model set changed from [${oldModels.join(', ')}] to [${newModels.join(', ')}]`);
  }

  const affectedTables = affectedTablesForEntry(existing.name).join(', ');
  return new Error(
    `Embedding catalog change refused.\n\n` +
      `Entry '${existing.name}' has changes that would corrupt the embedding column:\n` +
      `${changes.join('\n')}\n\n` +
      `Existing rows in ${affectedTables} were embedded against the previous catalog state. ` +
      `Silently applying these changes would mix vectors from different models in the same column, ` +
      `producing unreliable nearest-neighbour search results.\n\n` +
      `To proceed, choose one of two paths:\n\n` +
      `  Option A - Add the new shape under a different name (preserves data):\n` +
      `    1. Revert your edit to entry '${existing.name}'.\n` +
      `    2. Add a new entry with the desired dimensions/models.\n` +
      `    3. Restart, then backfill the new entry.\n` +
      `    4. Once verified, retire_embedding({ embedding_name: '${existing.name}', confirm: '${existing.name}' }).\n\n` +
      `  Option B - Retire the existing entry first (destroys existing '${existing.name}' vectors):\n` +
      `    1. Revert your edit to entry '${existing.name}'.\n` +
      `    2. Restart.\n` +
      `    3. retire_embedding({ embedding_name: '${existing.name}', confirm: '${existing.name}' }).\n` +
      `    4. Re-apply your YAML edit and restart.\n\n` +
      `Option A is recommended unless you know the existing '${existing.name}' data is invalid or unimportant.`
  );
}

function logDeactivatedEntry(name: string): void {
  logger.error(
    `Embedding catalog: entry '${name}' is deactivated (present in fqc_embeddings but missing from flashquery.yml).`
  );
  logger.error(`No operations against '${name}' will succeed except retire_embedding.`);
  logger.error(
    `To resolve: Option A - Re-add the '${name}' block to flashquery.yml and restart ` +
      `(reactivates with existing data intact, provided dimensions and model set are unchanged).`
  );
  logger.error(
    `Option B - Run retire_embedding({ embedding_name: '${name}', confirm: '${name}' }) ` +
      `to drop the columns, indexes, and catalog row.`
  );
}

export async function syncEmbeddingCatalog(config: FlashQueryConfig): Promise<EmbeddingCatalogSyncResult> {
  const embeddings = config.embeddings ?? [];
  const instanceId = config.instance.id;
  const client = supabaseManager.getClient();
  const incomingByName = new Map(embeddings.map((entry) => [entry.name, entry]));

  const { data, error: selectError } = await client
    .from('fqc_embeddings')
    .select('name, dimensions, endpoints, source, status')
    .eq('instance_id', instanceId);
  if (selectError) {
    throw new Error(`Embedding catalog sync: select fqc_embeddings failed: ${selectError.message}`);
  }

  const existingRows = (data ?? []) as CatalogRow[];
  const existingByName = new Map(existingRows.map((row) => [row.name, row]));

  // Preflight identity checks before any mutation. This preserves catalog state on refusal.
  for (const incoming of embeddings) {
    const existing = existingByName.get(incoming.name);
    if (!existing) continue;
    if (
      existing.dimensions !== incoming.dimensions ||
      !arraysEqual(modelSet(existing.endpoints), modelSet(incoming.endpoints))
    ) {
      throw buildIdentityRefusalError(existing, incoming);
    }
  }

  const result: EmbeddingCatalogSyncResult = {
    inserted: 0,
    updated: 0,
    deactivated: 0,
    reactivated: 0,
  };

  for (const incoming of embeddings) {
    const endpoints = incoming.endpoints.map(endpointToRow);
    const existing = existingByName.get(incoming.name);
    if (!existing) {
      await createCoreEmbeddingColumnSet(config, incoming);
      const { error: insertError } = await client.from('fqc_embeddings').insert({
        instance_id: instanceId,
        name: incoming.name,
        dimensions: incoming.dimensions,
        endpoints,
        source: 'yaml',
        status: 'active',
      });
      if (insertError) {
        throw new Error(`Embedding catalog sync: insert '${incoming.name}' failed: ${insertError.message}`);
      }
      result.inserted++;
      logger.info(
        `Embedding catalog: added entry '${incoming.name}' (affected tables: ${affectedTablesForEntry(incoming.name).join(', ')})`
      );
      continue;
    }

    const shouldReactivate = existing.status === 'deactivated';
    const shouldUpdateEndpoints = !endpointsEqual(existing.endpoints, endpoints);
    if (shouldReactivate || shouldUpdateEndpoints) {
      const { error: updateError } = await client
        .from('fqc_embeddings')
        .update({
          dimensions: incoming.dimensions,
          endpoints,
          status: 'active',
          updated_at: new Date().toISOString(),
        })
        .eq('instance_id', instanceId)
        .eq('name', incoming.name);
      if (updateError) {
        throw new Error(`Embedding catalog sync: update '${incoming.name}' failed: ${updateError.message}`);
      }
      if (shouldReactivate) {
        result.reactivated++;
        logger.info(`Embedding catalog: reactivated entry '${incoming.name}'`);
      } else {
        result.updated++;
      }
      if (shouldUpdateEndpoints) {
        logger.info(`Embedding catalog: applied changes to embedding entry '${incoming.name}'`);
      }
    }
    await createCoreEmbeddingColumnSet(config, incoming);
  }

  for (const existing of existingRows) {
    if (incomingByName.has(existing.name) || existing.source !== 'yaml') continue;
    if (existing.status !== 'deactivated') {
      const { error: deactivateError } = await client
        .from('fqc_embeddings')
        .update({ status: 'deactivated', updated_at: new Date().toISOString() })
        .eq('instance_id', instanceId)
        .eq('name', existing.name)
        .eq('source', 'yaml');
      if (deactivateError) {
        throw new Error(`Embedding catalog sync: deactivate '${existing.name}' failed: ${deactivateError.message}`);
      }
      result.deactivated++;
    }
    logDeactivatedEntry(existing.name);
  }

  return result;
}
