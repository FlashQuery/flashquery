import { posix as pathPosix } from 'node:path';
import { supabaseManager } from '../storage/supabase.js';
import { logger } from '../logging/logger.js';
import type { FlashQueryConfig } from '../config/loader.js';
import type { ConfigSyncAdapter } from './config-sync.js';
import { validateAllPurposeMode2Admissions, validatePurposeMode2Admission } from './capabilities.js';

export interface PurposeTemplateBinding {
  instanceId: string;
  purposeName: string;
  templatePath: string;
}

function normalizeTemplatePath(templateIdentifier: string): string {
  const raw = templateIdentifier.trim().replaceAll('\\', '/').replace(/^\.\/+/, '');
  const normalized = pathPosix.normalize(raw);
  if (
    normalized === '.' ||
    normalized === '' ||
    normalized.startsWith('/') ||
    normalized.startsWith('../') ||
    normalized === '..' ||
    normalized.endsWith('/')
  ) {
    throw new Error(`Invalid template binding path '${templateIdentifier}': path must be vault-relative`);
  }
  return normalized;
}

function assertPurposeExists(config: FlashQueryConfig, purposeName: string): void {
  if (!config.llm?.purposes.some((purpose) => purpose.name === purposeName)) {
    throw new Error(`Purpose '${purposeName}' not found in LLM configuration`);
  }
}

function parsePurposeTemplateBindings(config: FlashQueryConfig): PurposeTemplateBinding[] {
  const bindings: PurposeTemplateBinding[] = [];
  const seen = new Set<string>();
  for (const purpose of config.llm?.purposes ?? []) {
    for (const template of purpose.templates ?? []) {
      const templatePath = normalizeTemplatePath(template);
      const key = `${purpose.name}:${templatePath}`;
      if (seen.has(key)) {
        throw new Error(`Duplicate purpose-template binding '${key}'`);
      }
      seen.add(key);
      logger.warn(`Template binding '${key}' is dangling or not yet discovered; YAML binding retained`);
      bindings.push({
        instanceId: config.instance.id,
        purposeName: purpose.name,
        templatePath,
      });
    }
  }
  return bindings;
}

export function createPurposeTemplateSyncAdapter(_config: FlashQueryConfig): ConfigSyncAdapter<PurposeTemplateBinding> {
  return {
    table: 'fqc_purpose_templates',
    runtimeSources: ['api', 'webapp'],
    parseYaml: parsePurposeTemplateBindings,
    identity: (binding) => ({
      purpose_name: binding.purposeName,
      template_path: binding.templatePath,
    }),
    toRow: (binding) => ({
      instance_id: binding.instanceId,
      purpose_name: binding.purposeName,
      template_path: binding.templatePath,
      source: 'yaml',
    }),
    describeIdentity: (binding) => `template binding '${binding.purposeName}:${binding.templatePath}'`,
    runtimeOwnershipWarning: (binding, source) =>
      `Template binding '${binding.purposeName}:${binding.templatePath}' is managed via ${source === 'api' ? 'API' : 'webapp'} — YAML binding skipped`,
  };
}

function configWithRuntimeBindingExposure(
  config: FlashQueryConfig,
  purposeName: string,
  templatePath: string
): FlashQueryConfig {
  return {
    ...config,
    llm: config.llm
      ? {
          ...config.llm,
          purposes: config.llm.purposes.map((purpose) =>
            purpose.name === purposeName
              ? { ...purpose, templates: Array.from(new Set([...(purpose.templates ?? []), templatePath])) }
              : purpose
          ),
        }
      : undefined,
  };
}

export async function bindPurposeTemplateRuntime(
  config: FlashQueryConfig,
  purposeName: string,
  templateIdentifier: string
): Promise<void> {
  assertPurposeExists(config, purposeName);
  const templatePath = normalizeTemplatePath(templateIdentifier);
  const admission = validatePurposeMode2Admission(configWithRuntimeBindingExposure(config, purposeName, templatePath), purposeName);
  if (!admission.ok) {
    throw new Error(admission.message);
  }

  const client = supabaseManager.getClient();
  for (const source of ['webapp', 'api'] as const) {
    const { data: existing, error: lookupErr } = await client
      .from('fqc_purpose_templates')
      .select('id')
      .eq('instance_id', config.instance.id)
      .eq('purpose_name', purposeName)
      .eq('template_path', templatePath)
      .eq('source', source)
      .maybeSingle();
    if (lookupErr) {
      throw new Error(
        `LLM sync: ${source} lookup for template binding '${purposeName}:${templatePath}' failed: ${lookupErr.message}`
      );
    }
    if (existing) {
      if (source === 'webapp') {
        throw new Error(`Template binding '${purposeName}:${templatePath}' is webapp-managed; API binding rejected`);
      }
      return;
    }
  }

  const { error: insertErr } = await client.from('fqc_purpose_templates').insert({
    instance_id: config.instance.id,
    purpose_name: purposeName,
    template_path: templatePath,
    source: 'api',
  });
  if (insertErr) {
    throw new Error(`LLM sync: insert template binding '${purposeName}:${templatePath}' failed: ${insertErr.message}`);
  }
}

export async function removePurposeTemplateRuntime(
  config: FlashQueryConfig,
  purposeName: string,
  templateIdentifier: string
): Promise<void> {
  assertPurposeExists(config, purposeName);
  const templatePath = normalizeTemplatePath(templateIdentifier);
  const { error } = await supabaseManager
    .getClient()
    .from('fqc_purpose_templates')
    .delete()
    .eq('instance_id', config.instance.id)
    .eq('purpose_name', purposeName)
    .eq('template_path', templatePath)
    .eq('source', 'api');
  if (error) {
    throw new Error(`LLM sync: remove template binding '${purposeName}:${templatePath}' failed: ${error.message}`);
  }
}

export async function validatePersistedPurposeTemplateAdmissions(config: FlashQueryConfig): Promise<void> {
  if (!config.llm) return;

  const { data, error } = await supabaseManager
    .getClient()
    .from('fqc_purpose_templates')
    .select('purpose_name, template_path, source')
    .eq('instance_id', config.instance.id)
    .in('source', ['api', 'webapp']);

  if (error) {
    throw new Error(`LLM sync: persisted purpose-template admission lookup failed: ${error.message}`);
  }

  const runtimeRows = (data ?? []) as Array<{ purpose_name: string; template_path: string }>;
  if (runtimeRows.length === 0) return;

  const templatesByPurpose = new Map<string, Set<string>>();
  for (const row of runtimeRows) {
    const templates = templatesByPurpose.get(row.purpose_name) ?? new Set<string>();
    templates.add(row.template_path);
    templatesByPurpose.set(row.purpose_name, templates);
  }

  const configWithRuntimeExposure: FlashQueryConfig = {
    ...config,
    llm: {
      ...config.llm,
      purposes: config.llm.purposes.map((purpose) => {
        const runtimeTemplates = templatesByPurpose.get(purpose.name);
        if (!runtimeTemplates) return purpose;
        return {
          ...purpose,
          templates: Array.from(new Set([...(purpose.templates ?? []), ...runtimeTemplates])),
        };
      }),
    },
  };

  const capabilityErrors = validateAllPurposeMode2Admissions(configWithRuntimeExposure);
  if (capabilityErrors.length > 0) {
    throw new Error(capabilityErrors.map((e) => `Config error: [capability] ${e.message}`).join('\n'));
  }
}
