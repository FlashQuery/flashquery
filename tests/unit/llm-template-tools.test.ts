import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
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
  it('returns stable empty template diagnostic arrays when no template tools are available', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-empty-diagnostics-'));

    const registry = await assembleTemplateToolRegistry({
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
        templates: { defaultAccess: 'restrictive' },
        llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
      },
      purposeName: 'researcher',
    });

    expect(registry.diagnostics).toEqual({
      template_tools: [],
      template_tool_warnings: [],
      dangling_template_paths: [],
      template_tool_conflicts: [],
    });
  });

  it('generates provider-safe flashquery_<namespace>_<slug> names with template namespace defaulting', async () => {
    const { buildTemplateToolName } = await loadTemplateTools();

    expect(buildTemplateToolName({
      templatePath: 'Templates/Research-Skill.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'skill', fq_desc: 'Research skill' },
    })).toBe('flashquery_skill_research_skill');
    expect(buildTemplateToolName({
      templatePath: 'Templates/Document Review.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'review', fq_desc: 'Review document' },
    })).toBe('flashquery_review_document_review');
    expect(buildTemplateToolName({
      templatePath: 'Templates/Weekly Checklist.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_desc: 'Weekly checklist' },
    })).toBe('flashquery_template_weekly_checklist');
  });

  it('suppresses generated names that violate provider function-name constraints', async () => {
    const { buildTemplateToolName } = await loadTemplateTools();
    const validName = buildTemplateToolName({
      templatePath: 'Templates/Research-Skill.md',
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'skill', fq_desc: 'Research skill' },
    });
    expect(validName).toMatch(/^[A-Za-z0-9_-]{1,64}$/);

    expect(buildTemplateToolName({
      templatePath: `Templates/${'Very Long '.repeat(10)}Template.md`,
      frontmatter: { fq_template: true, fq_expose_as_tool: true, fq_namespace: 'skill', fq_desc: 'Too long' },
    })).toBeNull();
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

  it('silently skips ordinary non-template documents without not_template diagnostics', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const assembleWithPlainDocs = async (plainDocCount: number) => {
      const vaultPath = await mkdtemp(join(tmpdir(), `fqc-template-tools-silent-skip-${plainDocCount}-`));
      for (let index = 0; index < plainDocCount; index += 1) {
        await writeTemplate(vaultPath, `Notes/Plain-${index}.md`, {
          title: `Plain note ${index}`,
          status: 'active',
        }, 'Plain document body');
      }
      await writeTemplate(vaultPath, 'Templates/Missing Desc.md', {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'skill',
      }, 'Misconfigured template body');
      await writeTemplate(vaultPath, 'Templates/Valid.md', {
        fq_template: true,
        fq_expose_as_tool: true,
        fq_namespace: 'skill',
        fq_desc: 'Valid template',
      }, 'Template body');

      return await assembleTemplateToolRegistry({
        config: {
          instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
          templates: { defaultAccess: 'permissive' },
          llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
        },
        purposeName: 'researcher',
      });
    };

    const onePlainDoc = await assembleWithPlainDocs(1);
    const fiftyPlainDocs = await assembleWithPlainDocs(50);

    expect(onePlainDoc.diagnostics.template_tool_warnings).toHaveLength(1);
    expect(fiftyPlainDocs.diagnostics.template_tool_warnings).toHaveLength(1);
    expect(fiftyPlainDocs.diagnostics.template_tool_warnings.length).toBe(
      onePlainDoc.diagnostics.template_tool_warnings.length
    );
    expect(JSON.stringify(fiftyPlainDocs.diagnostics)).toContain('missing_description');
    expect(JSON.stringify(fiftyPlainDocs.diagnostics)).not.toContain('not_template');
    expect(JSON.stringify(fiftyPlainDocs.diagnostics)).not.toContain('Notes/Plain-');
    expect(fiftyPlainDocs.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_skill_valid']);
    expect(fiftyPlainDocs.templateReverseMap.get('flashquery_skill_valid')).toBe('Templates/Valid.md');
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

    expect(registry.providerTools?.map((tool) => tool.function.name)).toEqual(['flashquery_skill_research_skill']);
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
    expect(registry.templateReverseMap.get('flashquery_skill_research_skill')).toBe(templatePath);
    expect([...registry.templateReverseMap.keys()]).not.toContain('research_skill');
  });

  it('keeps optional template params nullable under strict provider schemas', async () => {
    const { assembleTemplateToolRegistry } = await loadTemplateTools();
    const vaultPath = await mkdtemp(join(tmpdir(), 'fqc-template-tools-strict-'));
    await writeTemplate(vaultPath, 'Templates/Optional-Skill.md', {
      fq_template: true,
      fq_expose_as_tool: true,
      fq_namespace: 'skill',
      fq_desc: 'Optional skill',
      fq_params: {
        topic: { type: 'string', required: true },
        note: { type: 'string', required: false },
      },
    }, 'Research {{topic}} {{note}}');

    const registry = await assembleTemplateToolRegistry({
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
        templates: { defaultAccess: 'permissive' },
        llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
      },
      purposeName: 'researcher',
      strictTools: true,
    });

    expect(registry.providerTools?.[0].function).toMatchObject({
      name: 'flashquery_skill_optional_skill',
      strict: true,
      parameters: {
        type: 'object',
        required: ['topic', 'note'],
        properties: {
          topic: { type: 'string' },
          note: { anyOf: [{ type: 'string' }, { type: 'null' }] },
        },
        additionalProperties: false,
      },
    });
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
      nativeToolNames: ['flashquery_skill_research_skill'],
    });

    expect(registry.diagnostics).toMatchObject({
      template_tool_conflicts: [
        {
          name: 'flashquery_skill_research_skill',
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
          name: 'flashquery_skill_research_skill',
          arguments: { topic: 'Phase 118' },
        },
      },
      templateReverseMap: new Map([['flashquery_skill_research_skill', 'Templates/Research-Skill.md']]),
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
      tool_name: 'flashquery_skill_research_skill',
      status: 'success',
    });
  });

  it('treats null optional template params as omitted during dispatch', async () => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: 'call_optional_skill',
        type: 'function',
        function: {
          name: 'flashquery_skill_optional_skill',
          arguments: { topic: 'Phase 118', note: null },
        },
      },
      templateReverseMap: new Map([['flashquery_skill_optional_skill', 'Templates/Optional-Skill.md']]),
      templateDocuments: new Map([[
        'Templates/Optional-Skill.md',
        {
          body: 'Research {{topic}} {{note}}',
          frontmatter: {
            fq_template: true,
            fq_params: {
              topic: { type: 'string', required: true },
              note: { type: 'string', required: false },
            },
          },
        },
      ]]),
      logger: testLogger,
    });

    expect(JSON.parse(result.message.content)).toMatchObject({
      ok: true,
      result: {
        content: 'Research Phase 118 ',
        template_warnings: expect.arrayContaining([
          expect.objectContaining({ type: 'optional_param_missing_no_default', param: 'note' }),
        ]),
      },
    });
  });

  it('uses declared defaults when strict providers send null for optional template params', async () => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: 'call_optional_default_skill',
        type: 'function',
        function: {
          name: 'flashquery_skill_optional_default_skill',
          arguments: { topic: 'Phase 118', tone: null },
        },
      },
      templateReverseMap: new Map([['flashquery_skill_optional_default_skill', 'Templates/Optional-Default-Skill.md']]),
      templateDocuments: new Map([[
        'Templates/Optional-Default-Skill.md',
        {
          body: 'Research {{topic}} in a {{tone}} tone',
          frontmatter: {
            fq_template: true,
            fq_params: {
              topic: { type: 'string', required: true },
              tone: { type: 'string', required: false, default: 'precise' },
            },
          },
        },
      ]]),
      logger: testLogger,
    });

    const payload = JSON.parse(result.message.content);
    expect(payload).toMatchObject({
      ok: true,
      result: {
        content: 'Research Phase 118 in a precise tone',
      },
    });
    expect(payload.result.template_warnings ?? []).toEqual([]);
  });

  it('does not read reverse-map template paths that normalize outside the vault', async () => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const rootPath = await mkdtemp(join(tmpdir(), 'fqc-template-path-containment-'));
    const vaultPath = join(rootPath, 'vault');
    await mkdir(vaultPath, { recursive: true });
    await writeTemplate(rootPath, 'outside.md', {
      fq_template: true,
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Outside {{topic}}');

    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: 'call_outside',
        type: 'function',
        function: {
          name: 'flashquery_skill_outside',
          arguments: { topic: 'Phase 118' },
        },
      },
      templateReverseMap: new Map([['flashquery_skill_outside', 'safe/../../outside.md']]),
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
      },
    });

    expect(JSON.parse(result.message.content)).toMatchObject({
      ok: false,
      error: { code: 'template_not_found', recoverable: true },
    });
  });

  it('does not read reverse-map template paths through vault symlinks', async () => {
    const { dispatchTemplateToolCall } = await loadTemplateTools();
    const rootPath = await mkdtemp(join(tmpdir(), 'fqc-template-symlink-containment-'));
    const vaultPath = join(rootPath, 'vault');
    await mkdir(vaultPath, { recursive: true });
    await writeTemplate(rootPath, 'outside.md', {
      fq_template: true,
      fq_params: { topic: { type: 'string', required: true } },
    }, 'Outside {{topic}}');
    await symlink(join(rootPath, 'outside.md'), join(vaultPath, 'link.md'));

    const result = await dispatchTemplateToolCall({
      toolCall: {
        id: 'call_symlink',
        type: 'function',
        function: {
          name: 'flashquery_skill_symlink',
          arguments: { topic: 'Phase 118' },
        },
      },
      templateReverseMap: new Map([['flashquery_skill_symlink', 'link.md']]),
      config: {
        instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
      },
    });

    expect(JSON.parse(result.message.content)).toMatchObject({
      ok: false,
      error: { code: 'template_not_found', recoverable: true },
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
            ? 'flashquery_skill_not_in_current_map'
            : 'flashquery_skill_research_skill',
          arguments: args,
        },
      },
      templateReverseMap: new Map([['flashquery_skill_research_skill', 'Templates/Research-Skill.md']]),
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
