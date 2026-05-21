import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import matter from 'gray-matter';
import type { FlashQueryConfig } from '../../src/config/loader.js';

type TemplateToolsModule = {
  assembleTemplateToolRegistry: (options: Record<string, unknown>) => Promise<{
    providerTools?: Array<{ function: { name: string; description: string } }>;
    templateTools: Array<Record<string, unknown>>;
    templateReverseMap: Map<string, string>;
    diagnostics: Record<string, unknown>;
  }>;
};

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

async function candidateFromFile(vaultPath: string, relPath: string, source?: string): Promise<Record<string, unknown>> {
  const parsed = matter(await readFile(join(vaultPath, relPath), 'utf8'));
  return {
    templatePath: relPath,
    body: parsed.content,
    frontmatter: parsed.data,
    ...(source === undefined ? {} : { source }),
  };
}

function makeConfig(vaultPath: string, defaultAccess: 'permissive' | 'restrictive', templates?: string[]): FlashQueryConfig {
  return {
    instance: {
      id: 'atl-i-03-template-tools',
      name: 'ATL-I-03 Template Tools',
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test-key', databaseUrl: 'postgres://postgres:postgres@localhost:54322/postgres', skipDdl: true },
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
      purposes: [{
        name: 'researcher',
        description: 'Researcher',
        models: ['tool-model'],
        ...(templates === undefined ? {} : { templates }),
      }],
    },
  };
}

describe('ATL-I-03 template discovery through real vault files', () => {
  it('reads fresh frontmatter without forcing a vault scan and updates provider descriptions on the next assembly', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-integration-'));
    await writeDoc(vaultPath, 'Templates/Research-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Fresh v1',
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Research {{topic}}');

    const config = makeConfig(vaultPath, 'permissive');
    const first = await assembleTemplateToolRegistry({
      config,
      purposeName: 'researcher',
      templateCandidates: [await candidateFromFile(vaultPath, 'Templates/Research-Skill.md')],
    });
    await writeDoc(vaultPath, 'Templates/Research-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Fresh v2',
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Research {{topic}}');
    const second = await assembleTemplateToolRegistry({
      config,
      purposeName: 'researcher',
      templateCandidates: [await candidateFromFile(vaultPath, 'Templates/Research-Skill.md')],
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
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-access-integration-'));
    await writeDoc(vaultPath, 'Templates/Weekly Checklist.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_desc: 'Weekly checklist',
    }, 'Checklist');

    const permissive = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'permissive'),
      purposeName: 'researcher',
      templateCandidates: [await candidateFromFile(vaultPath, 'Templates/Weekly Checklist.md')],
    });
    const restrictiveWithoutBinding = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive'),
      purposeName: 'researcher',
      templateCandidates: [],
    });
    const restrictiveWithBinding = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive', ['Templates/Weekly Checklist.md']),
      purposeName: 'researcher',
      templateCandidates: [await candidateFromFile(vaultPath, 'Templates/Weekly Checklist.md', 'yaml')],
    });

    expect(permissive.providerTools?.map((tool) => tool.function.name)).toContain('flashquery_template_weekly_checklist');
    expect(restrictiveWithoutBinding.providerTools ?? []).toEqual([]);
    expect(restrictiveWithBinding.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_template_weekly_checklist']);
  });

  it('combines YAML/runtime/API binding rows and reports dangling path diagnostics', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-bindings-integration-'));
    await writeDoc(vaultPath, 'Templates/Document Review.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'review',
      fq_desc: 'Document review',
    }, 'Review');

    const registry = await assembleTemplateToolRegistry({
      config: makeConfig(vaultPath, 'restrictive', ['Templates/Document Review.md', 'Templates/Dangling.md']),
      purposeName: 'researcher',
      runtimeBindings: [
        { purpose_name: 'researcher', template_path: 'Templates/Runtime Skill.md', source: 'api' },
      ],
      templateCandidates: [await candidateFromFile(vaultPath, 'Templates/Document Review.md', 'yaml')],
    });

    expect(registry.providerTools?.map((tool) => tool.function.name)).toContain('flashquery_review_document_review');
    expect(JSON.stringify(registry.diagnostics)).toContain('Templates/Dangling.md');
    expect(JSON.stringify(registry.diagnostics)).toContain('dangling');
    expect(JSON.stringify(registry.diagnostics)).toContain('api');
  });
});
