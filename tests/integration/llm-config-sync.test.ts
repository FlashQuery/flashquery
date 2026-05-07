import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { logger } from '../../src/logging/logger.js';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { syncLlmConfigToDb } from '../../src/llm/config-sync.js';
import { bindPurposeTemplateRuntime } from '../../src/llm/purpose-template-bindings.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { HAS_SUPABASE } from '../helpers/test-env.js';

const instanceId = 'i-atl-i-02-config-sync';

function makeConfig(): FlashQueryConfig {
  return {
    instance: {
      name: 'ATL Config Sync',
      id: instanceId,
      vault: { path: '/tmp/fqc-atl-config-sync-vault', markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: process.env.SUPABASE_URL ?? 'http://localhost:54321',
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'test-key',
      databaseUrl: process.env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:54322/postgres',
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: true, ttlSeconds: 30 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'info', output: 'stdout' },
    llm: {
      providers: [{ name: 'openai', type: 'openai-compatible', endpoint: 'https://api.openai.com' }],
      models: [
        {
          name: 'gpt-4o',
          providerName: 'openai',
          model: 'gpt-4o',
          type: 'language',
          costPerMillion: { input: 2.5, output: 10 },
          tags: ['fast', 'cheap'],
          capabilities: {
            tool_calling: true,
            usage_on_tool_calls: true,
            strict_tools: true,
            parallel_tool_calls: true,
            structured_outputs_with_tools: true,
          },
        },
      ],
      purposes: [
        {
          name: 'researcher',
          description: 'Research',
          models: ['gpt-4o'],
          tools: ['read'],
          excludedTools: ['search_memory'],
          templates: ['Templates/research-skill.md', 'Templates/dangling-skill.md'],
        },
      ],
    },
  };
}

async function cleanup(): Promise<void> {
  const client = supabaseManager.getClient();
  await client.from('fqc_purpose_templates').delete().eq('instance_id', instanceId);
  await client.from('fqc_llm_purpose_models').delete().eq('instance_id', instanceId);
  await client.from('fqc_llm_purposes').delete().eq('instance_id', instanceId);
  await client.from('fqc_llm_models').delete().eq('instance_id', instanceId);
  await client.from('fqc_llm_providers').delete().eq('instance_id', instanceId);
}

describe('LLM config sync purpose-template bindings (Integration)', () => {
  let available = false;

  beforeAll(async () => {
    if (!HAS_SUPABASE) {
      console.log('⚠️  Skipping llm config sync integration tests: Supabase not available');
      return;
    }

    try {
      const config = makeConfig();
      initLogger(config);
      await initSupabase(config);
      available = true;
    } catch (err) {
      console.log('⚠️  Skipping llm config sync integration tests:', (err as Error).message);
      available = false;
    }
  }, 30000);

  beforeEach(async () => {
    if (!available) return;
    await cleanup();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    if (available) {
      await cleanup();
      await supabaseManager.close();
    }
  });

  it('[ATL-I-02] inserts YAML rows, preserves source api precedence, and YAML can reappear', async () => {
    if (!available) return;
    const config = makeConfig();
    const client = supabaseManager.getClient();
    const warnSpy = vi.spyOn(logger, 'warn');

    await syncLlmConfigToDb(config);

    const { data: yamlRows } = await client
      .from('fqc_purpose_templates')
      .select('purpose_name, template_path, source')
      .eq('instance_id', instanceId)
      .eq('template_path', 'Templates/research-skill.md');
    expect(yamlRows).toEqual([
      { purpose_name: 'researcher', template_path: 'Templates/research-skill.md', source: 'yaml' },
    ]);

    await client.from('fqc_purpose_templates').delete().eq('instance_id', instanceId);
    await client.from('fqc_purpose_templates').insert({
      instance_id: instanceId,
      purpose_name: 'researcher',
      template_path: 'Templates/research-skill.md',
      source: 'api',
    });

    await syncLlmConfigToDb(config);

    expect(warnSpy).toHaveBeenCalledWith(
      "Template binding 'researcher:Templates/research-skill.md' is managed via API — YAML binding skipped"
    );
    const { data: apiRows } = await client
      .from('fqc_purpose_templates')
      .select('purpose_name, template_path, source')
      .eq('instance_id', instanceId)
      .eq('template_path', 'Templates/research-skill.md');
    expect(apiRows).toEqual([
      { purpose_name: 'researcher', template_path: 'Templates/research-skill.md', source: 'api' },
    ]);

    await client
      .from('fqc_purpose_templates')
      .delete()
      .eq('instance_id', instanceId)
      .eq('source', 'api');
    await syncLlmConfigToDb(config);

    const { data: reappearedRows } = await client
      .from('fqc_purpose_templates')
      .select('purpose_name, template_path, source')
      .eq('instance_id', instanceId)
      .eq('template_path', 'Templates/research-skill.md');
    expect(reappearedRows).toEqual([
      { purpose_name: 'researcher', template_path: 'Templates/research-skill.md', source: 'yaml' },
    ]);
  });

  it('[ATL-I-02] preserves source webapp rows and rejects API writes into webapp-owned slots', async () => {
    if (!available) return;
    const config = makeConfig();
    const client = supabaseManager.getClient();
    const warnSpy = vi.spyOn(logger, 'warn');

    await client.from('fqc_purpose_templates').insert({
      instance_id: instanceId,
      purpose_name: 'researcher',
      template_path: 'Templates/research-skill.md',
      source: 'webapp',
    });

    await syncLlmConfigToDb(config);

    expect(warnSpy).toHaveBeenCalledWith(
      "Template binding 'researcher:Templates/research-skill.md' is managed via webapp — YAML binding skipped"
    );
    const { data: rows } = await client
      .from('fqc_purpose_templates')
      .select('purpose_name, template_path, source')
      .eq('instance_id', instanceId)
      .eq('template_path', 'Templates/research-skill.md');
    expect(rows).toEqual([
      { purpose_name: 'researcher', template_path: 'Templates/research-skill.md', source: 'webapp' },
    ]);

    await expect(bindPurposeTemplateRuntime(config, 'researcher', 'Templates/research-skill.md')).rejects.toThrow(
      /webapp-managed; API binding rejected/
    );
  });

  it('[ATL-I-02] persists dangling structurally valid paths with a warning', async () => {
    if (!available) return;
    const warnSpy = vi.spyOn(logger, 'warn');

    await syncLlmConfigToDb(makeConfig());

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dangling'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Templates/dangling-skill.md'));
    const { data } = await supabaseManager
      .getClient()
      .from('fqc_purpose_templates')
      .select('template_path, source')
      .eq('instance_id', instanceId)
      .eq('template_path', 'Templates/dangling-skill.md');
    expect(data).toEqual([{ template_path: 'Templates/dangling-skill.md', source: 'yaml' }]);
  });

  it('[ATL-I-06] runtime binding rejects Mode 2-ineligible purposes through shared admission', async () => {
    if (!available) return;
    const config = makeConfig();
    config.llm!.providers[0] = {
      name: 'openrouter',
      type: 'openai-compatible',
      endpoint: 'https://openrouter.ai/api/v1',
    };
    config.llm!.models[0] = {
      ...config.llm!.models[0],
      providerName: 'openrouter',
      capabilities: { tool_calling: false, usage_on_tool_calls: true },
    };

    await expect(bindPurposeTemplateRuntime(config, 'researcher', 'Templates/research-skill.md')).rejects.toThrow(
      /Capability admission failed for purpose 'researcher'.*tool_calling/
    );
    const { data } = await supabaseManager
      .getClient()
      .from('fqc_purpose_templates')
      .select('id')
      .eq('instance_id', instanceId);
    expect(data).toEqual([]);
  });
});
