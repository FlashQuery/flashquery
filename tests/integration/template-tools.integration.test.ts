import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { setShuttingDown } from '../../src/server/shutdown-state.js';
import { resetMaintenanceStateForTests } from '../../src/services/maintenance.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

type TemplateToolsModule = {
  assembleTemplateToolRegistry: (options: Record<string, unknown>) => Promise<{
    providerTools?: Array<{ function: { name: string; description: string } }>;
    templateTools: Array<Record<string, unknown>>;
    templateReverseMap: Map<string, string>;
    diagnostics: {
      template_tools: Array<Record<string, unknown>>;
      template_tool_warnings: Array<Record<string, unknown>>;
      dangling_template_paths: Array<Record<string, unknown>>;
      template_tool_conflicts: Array<Record<string, unknown>>;
    };
  }>;
};

const TEST_INSTANCE_ID = 'phase-144-template-tools-integration';

async function loadTemplateTools(): Promise<TemplateToolsModule> {
  return import('../../src/llm/template-tools.js') as Promise<TemplateToolsModule>;
}

async function writeDoc(vaultPath: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const path = join(vaultPath, relPath);
  await mkdir(dirname(path), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path, `---\n${yaml}\n---\n\n${body}`);
}

function makeConfig(
  vaultPath: string,
  defaultAccess: 'permissive' | 'restrictive',
  templates?: string[],
  purposes?: NonNullable<FlashQueryConfig['llm']>['purposes']
): FlashQueryConfig {
  return {
    instance: {
      id: TEST_INSTANCE_ID,
      name: 'ATL-I-03 Template Tools',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    templates: { defaultAccess },
    llm: {
      providers: [{ name: 'mock', type: 'openai-compatible', endpoint: 'http://127.0.0.1:1' }],
      models: [{
        name: 'tool-model',
        providerName: 'mock',
        model: 'tool-model',
        type: 'language',
        costPerMillion: { input: 0, output: 0 },
        capabilities: { tool_calling: true, usage_on_tool_calls: true, strict_tools: true },
      }],
      purposes: purposes ?? [{
        name: 'researcher',
        description: 'Researcher',
        models: ['tool-model'],
        ...(templates === undefined ? {} : { templates }),
      }],
    },
  };
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function textOf(result: unknown): string {
  return (result as { content: Array<{ text: string }> }).content[0].text;
}

async function insertDocumentRow(input: {
  id?: string;
  path: string;
  status?: string;
  title?: string;
  tags?: string[];
  templateMeta?: Record<string, unknown> | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseManager.getClient().from('fqc_documents').insert({
    id: input.id ?? randomUUID(),
    instance_id: TEST_INSTANCE_ID,
    path: input.path,
    title: input.title ?? input.path,
    tags: input.tags ?? [],
    content_hash: `hash-${input.path}`,
    status: input.status ?? 'active',
    created_at: now,
    updated_at: now,
    template_meta: input.templateMeta ?? null,
  });
  expect(error).toBeNull();
}

async function rowForPath(path: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseManager.getClient()
    .from('fqc_documents')
    .select('path, status, template_meta')
    .eq('instance_id', TEST_INSTANCE_ID)
    .eq('path', path)
    .single();
  expect(error).toBeNull();
  return data as Record<string, unknown>;
}

describe.skipIf(!HAS_SUPABASE)('ATL-I-03 template discovery through fqc_documents index', () => {
  let vaultPath: string;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-integration-'));
    const config = makeConfig(vaultPath, 'permissive');
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  }, 60_000);

  afterAll(async () => {
    try {
      await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
      await supabaseManager.close();
    } catch {
      // Ignore cleanup failures in skipped or partially initialized environments.
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  beforeEach(async () => {
    setShuttingDown(false);
    resetMaintenanceStateForTests();
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await initVault(makeConfig(vaultPath, 'permissive'));
  });

  it('A/T-I-002 write_document create and update maintain template_meta without duplicating document columns', async () => {
    const config = makeConfig(vaultPath, 'permissive');
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const createResult = await getHandler('write_document')({
      mode: 'create',
      path: 'Templates/Write Created.md',
      title: 'Write Created',
      content: 'Template body',
      tags: ['phase-144'],
      frontmatter: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'write',
        fq_desc: 'Created template',
        fq_params: { topic: { type: 'string', required: true } },
        status: 'custom-status',
      },
    }) as { isError?: boolean };
    expect(createResult.isError).toBeFalsy();

    const createdRow = await rowForPath('Templates/Write Created.md');
    expect(createdRow.template_meta).toEqual({
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'write',
      fq_desc: 'Created template',
      fq_params: { topic: { type: 'string', required: true } },
    });
    expect(JSON.stringify(createdRow.template_meta)).not.toContain('status');
    expect(JSON.stringify(createdRow.template_meta)).not.toContain('title');
    expect(JSON.stringify(createdRow.template_meta)).not.toContain('tags');
    expect(JSON.stringify(createdRow.template_meta)).not.toContain('content_hash');

    const created = JSON.parse(textOf(createResult)) as { fq_id: string };
    const updateResult = await getHandler('write_document')({
      mode: 'update',
      identifier: created.fq_id,
      title: 'Retired Template',
      content: 'Now plain body',
      tags: ['phase-144', 'retired'],
      frontmatter: {
        fq_template: false,
        fq_expose_as_tool: true,
        fq_desc: 'Should no longer be indexed',
      },
    }) as { isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    expect((await rowForPath('Templates/Write Created.md')).template_meta).toBeNull();

    await getHandler('write_document')({
      mode: 'create',
      path: 'Docs/Plain.md',
      title: 'Plain',
      content: 'Plain body',
      tags: ['phase-144'],
      frontmatter: { owner: 'integration' },
    });
    expect((await rowForPath('Docs/Plain.md')).template_meta).toBeNull();
  });

  it('A/T-I-003 maintain_vault sync sets, refreshes, clears, and backfills template_meta', async () => {
    const config = makeConfig(vaultPath, 'permissive');
    const { server, getHandler } = createMockServer();
    registerScanTools(server, config);

    await writeDoc(vaultPath, 'Templates/External.md', {
      fq_id: '11111111-1111-4111-8111-111111111111',
      fq_status: 'active',
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'sync',
      fq_desc: 'External v1',
    }, 'External template');
    await getHandler('maintain_vault')({ action: 'sync' });
    expect((await rowForPath('Templates/External.md')).template_meta).toMatchObject({ fq_desc: 'External v1' });

    await writeDoc(vaultPath, 'Templates/External.md', {
      fq_id: '11111111-1111-4111-8111-111111111111',
      fq_status: 'active',
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'sync',
      fq_desc: 'External v2',
    }, 'External template updated');
    await getHandler('maintain_vault')({ action: 'sync' });
    expect((await rowForPath('Templates/External.md')).template_meta).toMatchObject({ fq_desc: 'External v2' });

    await writeDoc(vaultPath, 'Templates/External.md', {
      fq_id: '11111111-1111-4111-8111-111111111111',
      fq_status: 'active',
      fq_expose_as_tool: true,
      fq_desc: 'Retired external',
    }, 'External template retired');
    await getHandler('maintain_vault')({ action: 'sync' });
    expect((await rowForPath('Templates/External.md')).template_meta).toBeNull();

    await writeDoc(vaultPath, 'Templates/Backfill.md', {
      fq_id: '22222222-2222-4222-8222-222222222222',
      fq_status: 'active',
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'sync',
      fq_desc: 'Backfilled template',
    }, 'Backfill template');
    await insertDocumentRow({
      id: '22222222-2222-4222-8222-222222222222',
      path: 'Templates/Backfill.md',
      templateMeta: null,
    });
    await getHandler('maintain_vault')({ action: 'sync' });
    expect((await rowForPath('Templates/Backfill.md')).template_meta).toMatchObject({ fq_desc: 'Backfilled template' });
  }, 60_000);

  it('A/T-I-004 permissive discovery reads active template candidates from fqc_documents only', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    await insertDocumentRow({
      path: 'Templates/Indexed.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'indexed',
        fq_desc: 'Indexed template',
        fq_params: {},
      },
    });
    await insertDocumentRow({
      path: 'Templates/Archived.md',
      status: 'archived',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'indexed',
        fq_desc: 'Archived template',
      },
    });
    await insertDocumentRow({ path: 'Docs/Plain.md', templateMeta: null });

    const registry = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'permissive'),
      purposeName: 'researcher',
    });

    expect(registry.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_indexed_indexed']);
    expect(registry.providerTools?.[0].function.description).toBe('Indexed template');
    expect(JSON.stringify(registry.diagnostics)).not.toContain('Archived.md');
    expect(JSON.stringify(registry.diagnostics)).not.toContain('Plain.md');
    expect(JSON.stringify(registry.diagnostics)).not.toContain('not_template');
  });

  it('A/T-I-005 restrictive discovery resolves bound paths through fqc_documents and reports dangling rows', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    await insertDocumentRow({
      path: 'Templates/Bound.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'bound',
        fq_desc: 'Bound template',
      },
    });
    await insertDocumentRow({
      path: 'Templates/Inactive.md',
      status: 'archived',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'bound',
        fq_desc: 'Inactive template',
      },
    });

    const registry = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive', [
        'Templates/Bound.md',
        'Templates/Inactive.md',
        'Templates/Missing.md',
      ]),
      purposeName: 'researcher',
    });

    expect(registry.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_bound_bound']);
    expect(registry.diagnostics.dangling_template_paths).toEqual(expect.arrayContaining([
      { template_path: 'Templates/Inactive.md', source: 'yaml' },
      { template_path: 'Templates/Missing.md', source: 'yaml' },
    ]));
  });

  it('reads fresh frontmatter without forcing a vault scan and updates provider descriptions on the next assembly', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    await insertDocumentRow({
      path: 'Templates/Research-Skill.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'skill',
        fq_desc: 'Fresh v1',
        fq_params: { topic: { type: 'string', required: true } },
      },
    });
    const config = makeConfig(vaultPath, 'permissive');
    const first = await assembleTemplateToolRegistry({
      config,
      purposeName: 'researcher',
    });
    const { error } = await supabaseManager.getClient()
      .from('fqc_documents')
      .update({
        template_meta: {
          fq_template: true,
          fq_expose_as_tool: true,
          fq_namespace: 'skill',
          fq_desc: 'Fresh v2',
          fq_params: { topic: { type: 'string', required: true } },
        },
      })
      .eq('instance_id', TEST_INSTANCE_ID)
      .eq('path', 'Templates/Research-Skill.md');
    expect(error).toBeNull();
    const second = await assembleTemplateToolRegistry({
      config,
      purposeName: 'researcher',
    });

    expect(first.providerTools?.[0].function).toMatchObject({
      name: 'flashquery_skill_research_skill',
      description: 'Fresh v1',
    });
    expect(second.providerTools?.[0].function).toMatchObject({
      name: 'flashquery_skill_research_skill',
      description: 'Fresh v2',
    });
  });

  it('honors templates.default_access permissive and restrictive behavior with explicit purpose bindings', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    await insertDocumentRow({
      path: 'Templates/Weekly Checklist.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_desc: 'Weekly checklist',
      },
    });

    const permissive = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'permissive'),
      purposeName: 'researcher',
    });
    const restrictiveWithoutBinding = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive'),
      purposeName: 'researcher',
    });
    const restrictiveWithBinding = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive', ['Templates/Weekly Checklist.md']),
      purposeName: 'researcher',
    });

    expect(permissive.providerTools?.map((tool) => tool.function.name)).toContain('flashquery_template_weekly_checklist');
    expect(restrictiveWithoutBinding.providerTools ?? []).toEqual([]);
    expect(restrictiveWithBinding.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_template_weekly_checklist']);
  });

  it('combines YAML/runtime/API binding rows and reports dangling path diagnostics', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    await insertDocumentRow({
      path: 'Templates/Document Review.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'review',
        fq_desc: 'Document review',
      },
    });

    const registry = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive', ['Templates/Document Review.md', 'Templates/Dangling.md']),
      purposeName: 'researcher',
      runtimeBindings: [
        { purpose_name: 'researcher', template_path: 'Templates/Runtime Skill.md', source: 'api' },
      ],
    });

    expect(registry.providerTools?.map((tool) => tool.function.name)).toContain('flashquery_review_document_review');
    expect(JSON.stringify(registry.diagnostics)).toContain('Templates/Dangling.md');
    expect(JSON.stringify(registry.diagnostics)).toContain('dangling');
    expect(JSON.stringify(registry.diagnostics)).toContain('api');
  });

  it('A/T-I-008 purpose registry diagnostics omit not_template while preserving genuine warnings', async () => {
    const { assembleNativeToolRegistry, mergeModelVisibleToolRegistries } = await import('../../src/llm/tool-registry.js');
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const { toPublicToolDiagnosticsForTests } = await import('../../src/mcp/tools/llm.js');
    await insertDocumentRow({
      path: 'Templates/Visible.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'visible',
        fq_desc: 'Visible template',
      },
    });
    await insertDocumentRow({
      path: 'Templates/Misconfigured.md',
      templateMeta: {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'visible',
      },
    });
    await insertDocumentRow({ path: 'Docs/Plain.md', templateMeta: null });

    const config = makeConfig(vaultPath, 'permissive');
    const native = assembleNativeToolRegistry(config, 'researcher', [], { strictTools: true });
    const template = await assembleTemplateToolRegistry({
      config,
      purposeName: 'researcher',
      nativeToolNames: native.nativeToolNames,
      strictTools: true,
    });
    const registry = mergeModelVisibleToolRegistries({ native, template });
    const publicDiagnostics = toPublicToolDiagnosticsForTests(registry.diagnostics);

    expect(registry.providerTools?.map((tool) => tool.function.name)).toContain('flashquery_visible_visible');
    expect(JSON.stringify(publicDiagnostics)).toContain('missing_description');
    expect(JSON.stringify(publicDiagnostics)).not.toContain('not_template');
    expect(JSON.stringify(publicDiagnostics)).not.toContain('Docs/Plain.md');
  });
});
