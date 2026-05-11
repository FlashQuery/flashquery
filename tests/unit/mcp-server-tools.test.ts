import { describe, it, expect } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
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
import { getNativeToolCatalog, wrapServerWithToolCatalog } from '../../src/mcp/tool-catalog.js';
import {
  assertRegisteredToolsHaveMetadata,
  requireToolMetadata,
} from '../../src/mcp/tool-metadata.js';

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
}

describe('MCP tool registration metadata', () => {
  it('registers current tool modules into the native catalog', () => {
    const server = makeCatalogServer();

    expect(() => registerAllCurrentTools(server)).not.toThrow();

    const catalog = getNativeToolCatalog(server);
    const registeredNames = catalog.map((tool) => tool.name);

    expect(registeredNames).toContain('get_document');
    expect(registeredNames).toContain('call_model');
    expect(registeredNames).toContain('list_vault');
    expect(registeredNames).not.toContain('get_doc_outline');
    expect(registeredNames).not.toContain('list_projects');
    expect(registeredNames).not.toContain('get_project_info');
  });

  it('has central metadata for every currently registered native tool', () => {
    const server = makeCatalogServer();
    registerAllCurrentTools(server);
    const catalog = getNativeToolCatalog(server);

    expect(() => assertRegisteredToolsHaveMetadata(catalog)).not.toThrow();
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
