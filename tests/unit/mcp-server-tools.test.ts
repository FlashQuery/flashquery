import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { createMcpServer } from '../../src/mcp/server.js';
import { registerMemoryTools } from '../../src/mcp/tools/memory.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { registerPluginTools } from '../../src/mcp/tools/plugins.js';
import { registerRecordTools } from '../../src/mcp/tools/records.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerScanTools } from '../../src/mcp/tools/scan.js';
import { registerPendingReviewTools } from '../../src/mcp/tools/pending-review.js';
import { registerFileTools } from '../../src/mcp/tools/files.js';
import { registerLlmTools } from '../../src/mcp/tools/llm.js';
import { registerLlmUsageTools } from '../../src/mcp/tools/llm-usage.js';
import { registerMacroTools } from '../../src/mcp/tools/macro.js';
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import {
  assertRegisteredToolsHaveMetadata,
  requireToolMetadata,
} from '../../src/mcp/tool-metadata.js';
import { resolveHostToolExposure } from '../../src/mcp/tool-exposure.js';

const mockConfig: FlashQueryConfig = {
  instance: { id: 'test', vault: { path: '/tmp/vault' } },
  supabase: { url: 'http://localhost:54321', serviceRoleKey: 'test-key', databaseUrl: 'postgresql://localhost' },
  mcp: { port: 3100 },
  embedding: { provider: 'openai', dimensions: 1536, openaiApiKey: 'test-key' },
  logging: { level: 'info', output: 'stderr' },
  locking: { enabled: false },
};

function makeCatalogServer(): McpServer {
  return wrapServerWithToolCatalog(new McpServer({ name: 'test', version: '0.1.0' }));
}

function registerAllCurrentTools(server: McpServer): void {
  registerMemoryTools(server, mockConfig);
  registerDocumentTools(server, mockConfig);
  registerPluginTools(server, mockConfig);
  registerRecordTools(server, mockConfig);
  registerCompoundTools(server, mockConfig);
  registerScanTools(server, mockConfig);
  registerPendingReviewTools(server, mockConfig);
  registerFileTools(server, mockConfig);
  registerLlmTools(server, mockConfig);
  registerLlmUsageTools(server, mockConfig);
  registerMacroTools(server, mockConfig);
}

describe('MCP tool registration metadata', () => {
  it('keeps host-disabled tools in the native catalog while skipping SDK registration', () => {
    const originalRegisterTool = vi.fn();
    const server = wrapServerWithToolCatalog({
      registerTool: originalRegisterTool,
    } as unknown as McpServer, { hostEnabledToolNames: new Set(['get_document']) });

    server.registerTool('get_document', { description: 'Get document', inputSchema: {} }, vi.fn() as never);
    server.registerTool('write_memory', { description: 'Write memory', inputSchema: {} }, vi.fn() as never);

    expect(getNativeToolCatalog(server).map((tool) => tool.name)).toEqual(['get_document', 'write_memory']);
    expect(originalRegisterTool).toHaveBeenCalledTimes(1);
    expect(originalRegisterTool).toHaveBeenCalledWith('get_document', expect.any(Object), expect.any(Function));
  });

  it('registers all modules against a full native catalog while SDK registration stays host-filtered', () => {
    const server = wrapServerWithToolCatalog(
      new McpServer({ name: 'test', version: '0.1.0' }),
      { hostEnabledToolNames: new Set(resolveHostToolExposure({ tools: ['category:doc-read'] }).hostEnabledToolNames) }
    );

    registerAllCurrentTools(server);

    const names = getNativeToolCatalog(server).map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(['get_document', 'list_vault']));
    expect(names).toEqual(expect.arrayContaining(['write_memory', 'write_document', 'call_model']));
  });

  it('registers current tool modules into the native catalog', () => {
    const server = makeCatalogServer();

    expect(() => registerAllCurrentTools(server)).not.toThrow();

    const catalog = getNativeToolCatalog(server);
    const registeredNames = catalog.map((tool) => tool.name);

    expect(registeredNames).toContain('get_document');
    expect(registeredNames).toContain('call_model');
    expect(registeredNames).toContain('call_macro');
    expect(registeredNames).toContain('list_vault');
    expect(registeredNames).not.toContain('get_doc_outline');
    expect(registeredNames).not.toContain('list_projects');
    expect(registeredNames).not.toContain('get_project_info');
  });

  it('T-U-230 invokes registerMacroTools from createMcpServer before schema validation', () => {
    const server = createMcpServer(mockConfig, '0.1.0');
    const names = getNativeToolCatalog(server).map((tool) => tool.name);

    expect(names).toContain('get_llm_usage');
    expect(names).toContain('call_macro');
    expect(names.indexOf('call_macro')).toBeGreaterThan(names.indexOf('get_llm_usage'));
  });

  it('has central metadata for every currently registered native tool', () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);
    const catalog = getNativeToolCatalog(server);

    expect(() => assertRegisteredToolsHaveMetadata(catalog)).not.toThrow();
  });

  it('registers call_macro with inline production evaluator execution', async () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    expect(callMacro).toBeDefined();

    const result = await callMacro?.handler({ source: 'exit "hello"' }, {} as never);
    expect(result?.isError).toBeUndefined();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      result: 'hello',
    });
  });

  it('rejects call_macro requests that provide both source and source_ref as invalid input', async () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    expect(callMacro).toBeDefined();

    const result = await callMacro?.handler({
      source: 'exit "hello"',
      source_ref: '@doc#macro',
    }, {} as never);
    expect(result?.isError).toBeFalsy();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'exactly_one_required' },
    });
  });

  it('T-U-166 wires production template metadata into call_macro hard-exclusion prescan', async () => {
    const vaultRoot = await mkdtemp(join(tmpdir(), 'fq-macro-template-'));
    await mkdir(join(vaultRoot, 'Templates'), { recursive: true });
    await writeFile(
      join(vaultRoot, 'Templates', 'Research Skill.md'),
      [
        '---',
        'fq_template: true',
        'fq_expose_as_tool: true',
        'fq_namespace: skill',
        'fq_desc: Research skill',
        'fq_params:',
        '  topic:',
        '    type: string',
        '    required: true',
        '---',
        '',
        'Research {{topic}}',
      ].join('\n'),
      'utf8'
    );
    const server = makeCatalogServer();
    const config = {
      ...mockConfig,
      instance: {
        id: 'macro-template-hard-exclusion-test',
        name: 'Macro Template Hard Exclusion Test',
        vault: { path: vaultRoot, markdownExtensions: ['.md'] },
      },
      templates: { defaultAccess: 'permissive' },
      hostMcpTools: { tools: ['call_macro'] },
    } as FlashQueryConfig;
    registerMacroTools(server, config);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    const result = await callMacro?.handler({
      source: 'exit fq.flashquery_skill_research_skill({ topic: "dispatch" })',
    }, { signal: new AbortController().signal, instanceId: config.instance.id } as never);

    expect(result?.isError).toBeFalsy();
    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({
      error: 'template_masquerade_tools_not_callable_from_macro',
      details: {
        server: 'fq',
        tool: 'flashquery_skill_research_skill',
      },
    });
  });

  it('threads the MCP request signal into native macro tool dispatch context', async () => {
    const server = makeCatalogServer();
    const requestController = new AbortController();
    let capturedSignal: AbortSignal | undefined;

    server.registerTool('search', { description: 'Search', inputSchema: {} }, vi.fn(async (_args, context) => {
      capturedSignal = context.signal;
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true }) }] };
    }) as never);
    registerMacroTools(server, {
      ...mockConfig,
      hostMcpTools: { tools: ['search', 'call_macro'] },
    } as FlashQueryConfig);

    const callMacro = getNativeToolCatalog(server).find((tool) => tool.name === 'call_macro');
    const result = await callMacro?.handler(
      { source: 'exit fq.search({})' },
      { signal: requestController.signal, instanceId: 'macro-signal-test' } as never
    );

    expect(JSON.parse(result?.content[0]?.text ?? '')).toMatchObject({ result: { ok: true } });
    expect(capturedSignal).toBe(requestController.signal);
    requestController.abort();
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('uses metadata descriptions for the registered native catalog', () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);
    const catalog = getNativeToolCatalog(server);

    for (const tool of catalog) {
      const metadata = requireToolMetadata(tool.name);

      expect(tool.description.trim(), `${tool.name} registered description`).not.toBe('');
      expect(tool.description, `${tool.name} registered description`).toBe(metadata.description);
      expect(metadata.hostEligible, `${tool.name} should be host eligible while registered`).toBe(true);
      expect(tool.description, `${tool.name} registered description`).toContain('Summary:');
      expect(tool.description, `${tool.name} registered description`).toContain('Use when:');
      expect(tool.description, `${tool.name} registered description`).toContain('Do not use when:');
      expect(tool.description, `${tool.name} registered description`).toContain('Example:');
    }
  });
});
