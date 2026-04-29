import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import { getLlmApiKeyRefs } from '../config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// syncLlmConfigToDb — wipe-and-reinsert YAML rows; preserve webapp rows
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync the in-memory config.llm to Supabase config tables on startup.
 *
 * Sequence (per RESEARCH.md):
 *   1. Delete in dependency order: purpose_models -> purposes -> models -> providers,
 *      filtered by `source = 'yaml'` (purpose_models has no source column — see
 *      Phase 98 planner decision 2: delete ALL rows for the instance; webapp rows
 *      will be re-inserted from their stored state when the webapp write path
 *      lands in Phase 99+).
 *   2. For each provider/model/purpose, check whether a `source = 'webapp'` row
 *      with the same (instance_id, name) exists. If yes, skip + warn (DB-03).
 *      If no, insert with `source = 'yaml'`.
 *   3. Insert purpose_models rows with 1-indexed positions.
 *
 * api_key_ref always stores the raw ${ENV_VAR} reference string captured by
 * loadConfig() — never the resolved secret (T-98-01).
 */
export async function syncLlmConfigToDb(config: FlashQueryConfig): Promise<void> {
  if (!config.llm) {
    return;
  }
  const client = supabaseManager.getClient();
  const instanceId = config.instance.id;
  const apiKeyRefs = getLlmApiKeyRefs(config);

  // ── Step 1: Delete YAML-sourced rows in dependency order ───────────────────

  // purpose_models has no source column. Delete only rows whose purpose_name matches
  // a YAML-defined purpose, preserving any webapp-managed purpose-model mappings (DB-03).
  {
    const yamlPurposeNames = config.llm.purposes.map((p) => p.name);
    if (yamlPurposeNames.length > 0) {
      const { error } = await client
        .from('fqc_llm_purpose_models')
        .delete()
        .eq('instance_id', instanceId)
        .in('purpose_name', yamlPurposeNames);
      if (error) throw new Error(`LLM sync: delete fqc_llm_purpose_models failed: ${error.message}`);
    }
  }
  // Delete all source: 'yaml' rows for each config table (purposes/models/providers)
  for (const table of ['fqc_llm_purposes', 'fqc_llm_models', 'fqc_llm_providers'] as const) {
    const { error } = await client
      .from(table)
      .delete()
      .eq('instance_id', instanceId)
      .eq('source', 'yaml');
    if (error) throw new Error(`LLM sync: delete ${table} (source=yaml) failed: ${error.message}`);
  }

  // ── Step 2: Insert providers ───────────────────────────────────────────────

  for (const provider of config.llm.providers) {
    const { data: existing, error: lookupErr } = await client
      .from('fqc_llm_providers')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('name', provider.name)
      .eq('source', 'webapp')
      .maybeSingle();
    if (lookupErr) {
      throw new Error(`LLM sync: webapp lookup for provider '${provider.name}' failed: ${lookupErr.message}`);
    }
    if (existing) {
      logger.warn(`Provider '${provider.name}' is managed via webapp — YAML definition skipped (DB-03)`);
      continue;
    }
    const apiKeyRef = apiKeyRefs.get(provider.name) ?? null;
    const { error } = await client.from('fqc_llm_providers').insert({
      instance_id: instanceId,
      name: provider.name,
      type: provider.type,
      endpoint: provider.endpoint,
      api_key_ref: apiKeyRef,  // T-98-01: raw ${ENV_VAR} string OR null; never the resolved secret
      source: 'yaml',
    });
    if (error) throw new Error(`LLM sync: insert provider '${provider.name}' failed: ${error.message}`);
  }

  // ── Step 3: Insert models ──────────────────────────────────────────────────

  for (const model of config.llm.models) {
    const { data: existing, error: lookupErr } = await client
      .from('fqc_llm_models')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('name', model.name)
      .eq('source', 'webapp')
      .maybeSingle();
    if (lookupErr) {
      throw new Error(`LLM sync: webapp lookup for model '${model.name}' failed: ${lookupErr.message}`);
    }
    if (existing) {
      logger.warn(`Model '${model.name}' is managed via webapp — YAML definition skipped (DB-03)`);
      continue;
    }
    const { error } = await client.from('fqc_llm_models').insert({
      instance_id: instanceId,
      name: model.name,
      provider_name: model.providerName,
      model: model.model,
      type: model.type,
      cost_per_million_input: model.costPerMillion.input,
      cost_per_million_output: model.costPerMillion.output,
      source: 'yaml',
    });
    if (error) throw new Error(`LLM sync: insert model '${model.name}' failed: ${error.message}`);
  }

  // ── Step 4: Insert purposes ────────────────────────────────────────────────

  // Track which purpose names were actually inserted (vs. skipped due to webapp conflict)
  // so we only insert purpose_models for inserted purposes.
  const insertedPurposes = new Set<string>();

  for (const purpose of config.llm.purposes) {
    const { data: existing, error: lookupErr } = await client
      .from('fqc_llm_purposes')
      .select('id')
      .eq('instance_id', instanceId)
      .eq('name', purpose.name)
      .eq('source', 'webapp')
      .maybeSingle();
    if (lookupErr) {
      throw new Error(`LLM sync: webapp lookup for purpose '${purpose.name}' failed: ${lookupErr.message}`);
    }
    if (existing) {
      logger.warn(`Purpose '${purpose.name}' is managed via webapp — YAML definition skipped (DB-03)`);
      continue;
    }
    const { error } = await client.from('fqc_llm_purposes').insert({
      instance_id: instanceId,
      name: purpose.name,
      description: purpose.description,
      defaults: purpose.defaults ?? null,
      source: 'yaml',
    });
    if (error) throw new Error(`LLM sync: insert purpose '${purpose.name}' failed: ${error.message}`);
    insertedPurposes.add(purpose.name);
  }

  // ── Step 5: Insert purpose_models ──────────────────────────────────────────

  for (const purpose of config.llm.purposes) {
    if (!insertedPurposes.has(purpose.name)) continue;  // skipped above due to webapp conflict
    for (let position = 0; position < purpose.models.length; position++) {
      const modelName = purpose.models[position];
      const { error } = await client.from('fqc_llm_purpose_models').insert({
        instance_id: instanceId,
        purpose_name: purpose.name,
        model_name: modelName,
        position: position + 1,  // 1-indexed
      });
      if (error) {
        throw new Error(
          `LLM sync: insert purpose_models row (purpose='${purpose.name}', model='${modelName}', position=${position + 1}) failed: ${error.message}`
        );
      }
    }
  }

  logger.info(
    `LLM config synced: ${config.llm.providers.length} provider(s), ${config.llm.models.length} model(s), ${config.llm.purposes.length} purpose(s) (instance=${instanceId})`
  );
}
