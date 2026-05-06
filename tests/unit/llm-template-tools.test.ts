import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

type TemplateToolsModule = {
  buildTemplateToolName: (input: { templatePath: string; frontmatter: Record<string, unknown> }) => string | null;
  assembleTemplateToolRegistry: (options: Record<string, unknown>) => Promise<{
    providerTools?: Array<{ function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    templateTools: Array<Record<string, unknown>>;
    templateReverseMap: Map<string, string>;
    diagnostics: Record<string, unknown>;
  }>;
  dispatchTemplateToolCall: (options: Record<string, unknown>) => Promise<{
    message: { role: 'tool'; tool_call_id: string; content: string };
    logEntry: Record<string, unknown>;
  }>;
};

async function loadTemplateTools(): Promise<TemplateToolsModule> {
  return import('../../src/llm/template-tools.js') as Promise<TemplateToolsModule>;
}

async function writeTemplate(root: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const path = join(root, relPath);
  await mkdir(dirname(path), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path, `---\n${yaml}\n---\n\n${body}`);
}

const testLogger = {
  info: () => undefined,
  debug: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

describe('ATL-U-15 template masquerade name generation and discovery contracts', () => {
  it('generates flashquery.<namespace>.<slug> names with template namespace defaulting', async () => {
    const { buildTemplateToolName } = await loadTemplateTools();

    expect(buildTemplateToolName({
      templatePath: 'Templates/Research-Skill.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'skill', fq_desc: 'Research skill' },
    })).toBe('flashquery.skill.research_skill');
    expect(buildTemplateToolName({
      templatePath: 'Templates/Document Review.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'review', fq_desc: 'Review document' },
    })).toBe('flashquery.review.document_review');
    expect(buildTemplateToolName({
      templatePath: 'Templates/Weekly Checklist.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_desc: 'Weekly checklist' },
    })).toBe('flashquery.template.weekly_checklist');
  });

  it('warns and suppresses invalid or incomplete masquerade templates while preserving diagnostics', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-unit-'));
    await writeTemplate(vaultPath, 'Templates/Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'Skill',
      fq_desc: 'Uppercase namespace',
    }, 'Uppercase namespace');
    await writeTemplate(vaultPath, 'Templates/Review.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill.review',
      fq_desc: 'Dotted namespace',
    }, 'Dotted namespace');
    await writeTemplate(vaultPath, 'Templates/1Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: '1skill',
      fq_desc: 'Leading digit namespace',
    }, 'Leading digit namespace');
    await writeTemplate(vaultPath, 'Templates/Missing Desc.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
    }, 'Missing description');
    await writeTemplate(vaultPath, 'Templates/Not Exposed.md', {
      fq_template: true,
      fq_expose_as_tool: false,
      fq_namespace: 'skill',
      fq_desc: 'Not exposed',
    }, 'Not exposed');
    await writeTemplate(vaultPath, 'Templates/Unsupported Params.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Unsupported params',
      fq_params: { topic: { type: 'number', required: true } },
    }, 'Unsupported params');

    const registry = await assembleTemplateToolRegistry({
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
        templates: { defaultAccess: 'permissive' },
        llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
      },
      purposeName: 'researcher',
    });

    expect(registry.providerTools ?? []).toEqual([]);
    expect(JSON.stringify(registry.diagnostics)).toContain('Skill');
    expect(JSON.stringify(registry.diagnostics)).toContain('1skill');
    expect(JSON.stringify(registry.diagnostics)).toContain('skill.review');
    expect(JSON.stringify(registry.diagnostics)).toContain('missing fq_desc');
    expect(JSON.stringify(registry.diagnostics)).toContain('fq_expose_as_tool');
    expect(JSON.stringify(registry.diagnostics)).toContain('unsupported_template_param_schema');
  });

  it('builds provider schemas, fresh descriptions, and explicit reverse maps from current frontmatter', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-fresh-'));
    const templatePath = 'Templates/Research-Skill.md';
    await writeTemplate(vaultPath, templatePath, {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Fresh description v1',
      fq_params: {
        topic: { type: 'string', required: true },
        source: { type: 'document', required: true },
      },
    }, 'Research {{topic}} with {{source}}');

    const registry = await assembleTemplateToolRegistry({
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
        templates: { defaultAccess: 'permissive' },
        llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
      },
      purposeName: 'researcher',
    });

    expect(registry.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery.skill.research_skill']);
    expect(registry.providerTools?.[0].function.description).toBe('Fresh description v1');
    expect(registry.providerTools?.[0].function.parameters).toMatchObject({
      type: 'object',
      properties: {
        topic: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['topic', 'source'],
      additionalProperties: false,
    });
    expect(registry.templateReverseMap.get('flashquery.skill.research_skill')).toBe(templatePath);
    expect([...registry.templateReverseMap.keys()]).not.toContain('research_skill');
  });

  it('fails hard on template/template and native/template final-name collisions with all template_path sources', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-conflict-'));
    await writeTemplate(vaultPath, 'Templates/Research Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'First',
    }, 'First');
    await writeTemplate(vaultPath, 'Other/Research-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Second',
    }, 'Second');

    const registry = await assembleTemplateToolRegistry({
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
        templates: { defaultAccess: 'permissive' },
        llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
      },
      purposeName: 'researcher',
      nativeToolNames: ['flashquery.skill.research_skill'],
    });

    expect(registry.diagnostics).toMatchObject({
      template_tool_conflicts: [
        {
          name: 'flashquery.skill.research_skill',
          template_paths: expect.arrayContaining(['Templates/Research Skill.md', 'Other/Research-Skill.md']),
        },
      ],
    });
    expect(JSON.stringify(registry.diagnostics)).toContain('native');
  });
});

describe('ATL-U-15 template tool dispatch contracts', () => {
  it('hydrates templates through the reverse map and returns JSON-stringified successful tool payloads', async () => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-dispatch-unit-'));
    await writeTemplate(vaultPath, 'Templates/Research-Skill.md', {
      fq_template: true,
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Research {{topic}}');

    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: 'call_research_skill',
        type: 'function',
        function: {
          name: 'flashquery.skill.research_skill',
          arguments: { topic: 'Phase 118' },
        },
      },
      templateReverseMap: new Map([['flashquery.skill.research_skill', 'Templates/Research-Skill.md']]),
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
      },
    });

    expect(result.message).toMatchObject({ role: 'tool', tool_call_id: 'call_research_skill' });
    expect(JSON.parse(result.message.content)).toMatchObject({
      ok: true,
      result: { template_path: 'Templates/Research-Skill.md', content: expect.stringContaining('Phase 118') },
    });
    expect(result.logEntry).toMatchObject({
      kind: 'template',
      tool_call_id: 'call_research_skill',
      tool_name: 'flashquery.skill.research_skill',
      status: 'success',
    });
  });

  it.each([
    ['template_missing_required_param', {}, { topic: { type: 'string', required: true } }],
    ['template_param_invalid_type', { topic: 123 }, { topic: { type: 'string', required: true } }],
    ['template_param_doc_not_found', { topic: 'Phase 118', source: 'Missing.md' }, {
      topic: { type: 'string', required: true },
      source: { type: 'document', required: true },
    }],
    ['unsupported_template_param_schema', { topic: 'Phase 118' }, { topic: { type: 'number', required: true } }],
    ['template_not_found', { topic: 'Phase 118' }, null],
    ['tool_not_in_registry', { topic: 'Phase 118' }, { topic: { type: 'string', required: true } }],
    ['invalid_tool_arguments', 'not-an-object', { topic: { type: 'string', required: true } }],
  ])('returns recoverable %s tool errors instead of throwing', async (expectedCode, args, fqParams) => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const templateDocuments = fqParams === null
      ? undefined
      : new Map([[
          'Templates/Research-Skill.md',
          {
            body: 'Research {{topic}} {{source}}',
            frontmatter: { fq_template: true, fq_params: fqParams },
          },
        ]]);
    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: `call_${expectedCode}`,
        type: 'function',
        function: {
          name: expectedCode === 'tool_not_in_registry'
            ? 'flashquery.skill.not_in_current_map'
            : 'flashquery.skill.research_skill',
          arguments: args,
        },
      },
      templateReverseMap: new Map([['flashquery.skill.research_skill', 'Templates/Research-Skill.md']]),
      templateDocuments,
      logger: testLogger,
    });

    expect(JSON.parse(result.message.content)).toMatchObject({
      ok: false,
      error: { code: expectedCode, recoverable: true },
    });
    expect(result.logEntry).toMatchObject({
      kind: 'template',
      error_code: expectedCode,
      status: 'error',
    });
  });
});
