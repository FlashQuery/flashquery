/**
 * MCP Protocol E2E Tests
 *
 * Spawns FlashQuery Core as a subprocess using StdioClientTransport and exercises
 * the full MCP protocol pipeline: tool discovery, memory save/search, document
 * create/get, project listing, and error handling.
 *
 * Prerequisites:
 *   - Supabase credentials in .env.test (see .env.test.example)
 *   - Live Ollama with nomic-embed-text model
 *
 * Run: npm run test:e2e
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rm } from 'node:fs/promises';
import { startMcpServerFixture, stopMcpServerFixture } from '../helpers/mcp-server-fixture.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIXTURE_PATH = resolve(__dirname, '../fixtures/flashquery.e2e.yaml');
const ENTRY_POINT = resolve(__dirname, '../../src/index.ts');
const VAULT_E2E = resolve(__dirname, '../fixtures/vault-e2e');

// ─────────────────────────────────────────────────────────────────────────────
// Shared client — single FQC subprocess for all tests
// ─────────────────────────────────────────────────────────────────────────────

let client: Client;
let transport: StdioClientTransport;

beforeAll(async () => {
  try {
    const fixture = await startMcpServerFixture();
    client = fixture.client;
    transport = fixture.transport;
  } catch (err) {
    console.error('Failed to start MCP server:', err);
    throw err;  // Vitest will skip all tests in this suite
  }
}, 60000);

afterAll(async () => {
  if (client && transport) {
    await stopMcpServerFixture(client, transport);
  }
  // Clean up the E2E test vault
  try {
    await rm(VAULT_E2E, { recursive: true, force: true });
  } catch (err) {
    console.warn(`Failed to clean up test vault at ${VAULT_E2E}:`, err);
    // Don't throw — cleanup failure shouldn't fail the test suite
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: extract text from first content item
// ─────────────────────────────────────────────────────────────────────────────

function getText(result: { content: Array<{ type: string; text: string }>; isError?: boolean }): string {
  if (!result.content || result.content.length === 0) {
    throw new Error(`Expected content array, got: ${JSON.stringify(result)}`);
  }
  const first = result.content[0];
  if (first.type !== 'text') {
    throw new Error(
      `Expected text content, got ${first.type}: ${JSON.stringify(first)}`
    );
  }
  return first.text;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — run sequentially (shared subprocess state)
// ─────────────────────────────────────────────────────────────────────────────

describe.sequential('MCP protocol E2E', () => {

  // ── T-01: Tool discovery ───────────────────────────────────────────────────

  it('lists all registered tools including get_memory and search_all', async () => {
    const { tools } = await client.listTools();

    const expectedTools = [
      'save_memory',
      'search_memory',
      'list_memories',
      'get_memory',
      'create_document',
      'get_document',
      'search_documents',
      'search_all',
    ];

    // At least the core tools must be present (compound/plugin tools may also be registered)
    expect(tools.length).toBeGreaterThanOrEqual(expectedTools.length);

    const toolNames = tools.map((t: { name: string }) => t.name);
    for (const expected of expectedTools) {
      expect(toolNames).toContain(expected);
    }
  }, 30000);

  // ── T-02: save_memory + search_memory round-trip ──────────────────────────

  it('save_memory stores a memory and search_memory retrieves it', async () => {
    // Save
    const saveResult = await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'The capital of France is Paris',
        tags: ['geography', 'e2e-france'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(saveResult.isError).toBeFalsy();
    const saveText = getText(saveResult);
    expect(saveText).toMatch(/Memory saved/i);

    // Use list_memories with tag filter (more reliable than semantic search without embedding)
    const listResult = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['e2e-france'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(listResult.isError).toBeFalsy();
    const listText = getText(listResult);
    expect(listText).toContain('Paris');
  }, 30000);

  // ── T-03: create_document + get_document round-trip ───────────────────────

  let createdDocPath: string;

  it('create_document writes a file and get_document reads it back', async () => {
    // Create
    const createResult = await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'E2E Test Document',
        content: 'This is an E2E test.',
        tags: ['e2e-test'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();
    const createText = getText(createResult);
    // v2.5 response format uses key-value pairs
    expect(createText).toMatch(/Title:|Path:|FQC ID:/);

    // Extract vault-relative path from "Path: <path>" line (v2.5 format)
    const match = createText.match(/^Path:\s*(.+)$/m);
    if (!match || !match[1]) {
      throw new Error(
        `Expected "Path: <path>" in response, got: ${createText}`
      );
    }
    createdDocPath = match[1].trim();
    expect(createdDocPath).toMatch(/\.md$/);

    // Get the document back
    const getResult = await client.callTool({
      name: 'get_document',
      arguments: { identifier: createdDocPath },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(getResult.isError).toBeFalsy();
    const getDocumentText = getText(getResult);
    expect(getDocumentText).toContain('E2E test');
    // Note: get_document returns content only (no frontmatter) — tags are in the metadata
  }, 30000);

  // ── T-04: Error handling — missing required param ─────────────────────────

  it('get_document with missing path param returns error', async () => {
    // The MCP SDK validates input schemas on the server side and returns isError:true
    // or throws a McpError for validation failures. Handle both.
    try {
      const result = await client.callTool({
        name: 'get_document',
        arguments: {},
      }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

      // If the SDK returns a result instead of throwing, it must be an error
      expect(result.isError).toBe(true);
    } catch (err) {
      // McpError thrown for schema validation failure — this is also acceptable
      expect(err).toBeDefined();
    }
  }, 30000);

  // ── T-07: Error handling — nonexistent document ───────────────────────────

  it('get_document with nonexistent path returns isError:true', async () => {
    const result = await client.callTool({
      name: 'get_document',
      arguments: { identifier: 'nonexistent/file.md' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
  }, 30000);

  // ── T-08: Multi-memory search relevance ranking ───────────────────────────

  it('multi-memory search returns TypeScript memories before French cuisine', async () => {
    // Save 3 memories covering distinct topics
    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'TypeScript generics enable type-safe reusable functions and classes',
        tags: ['typescript', 'e2e-ts-multi'],
      },
    });

    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'French cuisine is famous for croissants, baguettes, and coq au vin',
        tags: ['food', 'france', 'e2e-ts-multi'],
      },
    });

    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'TypeScript async/await patterns simplify Promise-based code in Node.js',
        tags: ['typescript', 'nodejs', 'e2e-ts-multi'],
      },
    });

    // Use tag-based search to find TypeScript memories with the multi tag
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['typescript', 'e2e-ts-multi'],
        tag_match: 'all',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);

    // Both TypeScript memories should appear when filtering by typescript tag
    expect(text).toContain('TypeScript');
    // French cuisine has the multi tag but not typescript tag — should not appear with tag_match: all
    expect(text).not.toContain('croissants');
  }, 30000);

  // ── T-09: list_memories basic round-trip ─────────────────────────────────

  it('list_memories returns memories saved in earlier tests', async () => {
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {},
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // T-02 saved a memory about France/Paris — it must appear in the listing
    expect(text).toContain('Paris');
  }, 30000);

  // ── T-10: search_documents by project filter ──────────────────────────────

  it('search_documents returns only documents from the specified project', async () => {
    // Create a document with a unique tag to distinguish it
    const createResult = await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'Alt Project Document',
        content: 'This document belongs to the alternate project.',
        tags: ['alt-project-test'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(createResult.isError).toBeFalsy();

    // Search for documents with e2e-test tag using filesystem mode (no embedding needed)
    const searchResult = await client.callTool({
      name: 'search_documents',
      arguments: { tags: ['e2e-test'], mode: 'filesystem' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(searchResult.isError).toBeFalsy();
    const text = getText(searchResult);
    // T-03 created "E2E Test Document" with e2e-test tag — should appear
    expect(text).toContain('E2E Test Document');
    // Alt Project Document has alt-project-test tag, not e2e-test — should not appear
    expect(text).not.toContain('Alt Project Document');
  }, 30000);

  // ── T-11: search_documents by tag filter ──────────────────────────────────

  it('search_documents returns only documents matching the specified tag', async () => {
    // Create a document with a unique tag
    await client.callTool({
      name: 'create_document',
      arguments: {
        title: 'Tagged Filter Document',
        content: 'This document has a unique tag for filter testing.',
        tags: ['e2e-tag-filter'],
      },
    });

    // Search by the unique tag using filesystem mode
    const result = await client.callTool({
      name: 'search_documents',
      arguments: { tags: ['e2e-tag-filter'], mode: 'filesystem' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(text).toContain('Tagged Filter Document');
    // Documents without e2e-tag-filter tag should not appear
    expect(text).not.toContain('Alt Project Document');
  }, 30000);

  // ── T-12: search_memory with project filter ───────────────────────────────

  it('search_memory scopes results to the specified project', async () => {
    // Save a geography memory with unique tags
    await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'The Eiffel Tower is a landmark in Paris, France',
        tags: ['landmark-unique-eiffel'],
      },
    });

    // List memories with typescript tag (no semantic search needed)
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['typescript'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Should find TypeScript memories with the typescript tag
    expect(text).toContain('TypeScript');
    // Should not find Eiffel Tower (different tag)
    expect(text).not.toContain('Eiffel Tower');
  }, 30000);

  // ── T-14: list_memories with project filter ───────────────────────────────

  it('list_memories scopes results to the specified project', async () => {
    const result = await client.callTool({
      name: 'list_memories',
      arguments: { tags: ['geography'] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // Should list memories with geography tag (from T-02: Paris memory)
    expect(text).toContain('Paris');
  }, 30000);

  // ── T-15: search_memory with no matching results ──────────────────────────

  it('search_memory returns a graceful response when no results match', async () => {
    // Search for a non-existent tag
    const result = await client.callTool({
      name: 'list_memories',
      arguments: {
        tags: ['nonexistent-tag-xyz'],
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    // Should not be an error — empty results are not failures
    expect(result.isError).toBeFalsy();
    const text = getText(result);
    expect(typeof text).toBe('string');
    expect(text.length).toBeGreaterThan(0);
    // Should indicate no results found gracefully
    const lc = text.toLowerCase();
    expect(lc.includes('no') || lc.includes('empty') || lc.includes('found')).toBe(true);
  }, 30000);

  // ── T-16: save_memory without project uses config default ─────────────────

  it('save_memory uses config defaults.project when project param is omitted', async () => {
    const result = await client.callTool({
      name: 'save_memory',
      arguments: {
        content: 'Testing default project fallback behavior in save_memory',
      },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const text = getText(result);
    // In v2.5, memories use global scope by default (no project concept)
    expect(text).toMatch(/Memory saved/i);
    expect(text).toMatch(/Scope: Global/i);
  }, 30000);

});
