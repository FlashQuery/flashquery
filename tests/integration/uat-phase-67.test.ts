/**
 * Phase 67 UAT: File Ops P2 — copy_document, remove_directory
 *
 * Tests the copy_document and remove_directory MCP tools via the
 * streamable-http transport on an isolated port (4300).
 *
 * Requires: Supabase running (HAS_SUPABASE env vars set).
 * Run: npm run test:integration -- uat-phase-67
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import matter from 'gray-matter';
import { FM } from '../../src/constants/frontmatter-fields.js';
import {
  HAS_SUPABASE,
  TEST_SUPABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_DATABASE_URL,
} from '../helpers/test-env.js';

const MCP_PORT = 4300;
const AUTH_SECRET = 'uat-67-test-secret';
const INSTANCE_ID = 'uat-67-test';

function writeTestConfig(vaultPath: string): string {
  const configPath = join(tmpdir(), `fqc-uat-67-${Date.now()}.yml`);
  writeFileSync(
    configPath,
    `instance:
  name: "UAT-67 Test"
  id: "${INSTANCE_ID}"
  vault:
    path: "${vaultPath}"
    markdown_extensions: [".md"]
supabase:
  url: "${TEST_SUPABASE_URL}"
  service_role_key: "${TEST_SUPABASE_KEY}"
  database_url: "${TEST_DATABASE_URL}"
  skip_ddl: false
git:
  auto_commit: false
  auto_push: false
mcp:
  transport: "streamable-http"
  host: "127.0.0.1"
  port: ${MCP_PORT}
  auth_secret: "${AUTH_SECRET}"
embedding:
  provider: "none"
  model: ""
  dimensions: 1536
locking:
  enabled: false
  ttl_seconds: 30
logging:
  level: "error"
  output: "stdout"
`
  );
  return configPath;
}

interface McpCallResult {
  status: number;
  content: Array<{ text: string }>;
  isError?: boolean;
}

async function mcpCall(toolName: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${AUTH_SECRET}`,
  };

  const initRes = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialize',
      params: {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'uat-67-test', version: '1.0.0' },
      },
      id: 1,
    }),
  });

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) {
    return { status: initRes.status, content: [], isError: true };
  }

  const callRes = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
    method: 'POST',
    headers: { ...headers, 'mcp-session-id': sessionId },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: toolName, arguments: args },
      id: 2,
    }),
  });

  const rawBody = await callRes.text();
  let result: { content?: Array<{ text: string }>; isError?: boolean } = {};
  try {
    const dataMatch = rawBody.match(/^data:\s*(.+)$/m);
    const envelope = JSON.parse(dataMatch ? dataMatch[1] : rawBody) as {
      result?: { content?: Array<{ text: string }>; isError?: boolean };
    };
    result = envelope.result ?? {};
  } catch {
    // non-parseable
  }

  return {
    status: callRes.status,
    content: result.content ?? [],
    isError: result.isError,
  };
}

describe.skipIf(!HAS_SUPABASE)('Phase 67 UAT: File Ops P2 (copy_document, remove_directory)', () => {
  let serverProcess: ChildProcess | null = null;
  let vaultPath: string;
  let configPath: string;

  const SOURCE_REL = 'Documents/source.md';
  const COPY_REL = 'Documents/copy.md';

  beforeAll(async () => {
    vaultPath = join(tmpdir(), `fqc-uat-67-vault-${Date.now()}`);
    await mkdir(join(vaultPath, 'Documents'), { recursive: true });

    // Write source document with correct FM field names
    const sourceFrontmatter = matter.stringify(
      'This is the source document for testing copy_document.',
      {
        [FM.TITLE]: 'Original Document',
        [FM.STATUS]: 'active',
        [FM.TAGS]: ['important', 'archive'],
      }
    );
    await writeFile(join(vaultPath, SOURCE_REL), sourceFrontmatter, 'utf-8');

    configPath = writeTestConfig(vaultPath);
    const distIndex = new URL('../../dist/index.js', import.meta.url).pathname;

    serverProcess = spawn('node', [distIndex, 'start', '--config', configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    // Poll for readiness (up to 20s)
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${MCP_PORT}/mcp`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            Authorization: `Bearer ${AUTH_SECRET}`,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'initialize',
            params: {
              protocolVersion: '2025-03-26',
              capabilities: {},
              clientInfo: { name: 'health', version: '1' },
            },
            id: 1,
          }),
        });
        if (res.status < 500) break;
      } catch {
        // not ready yet
      }
      await new Promise((r) => setTimeout(r, 300));
    }
  }, 30000);

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 1000));
    }
    try {
      unlinkSync(configPath);
    } catch {
      // ignore
    }
    await rm(vaultPath, { recursive: true, force: true });
  });

  it('Test 1: copy_document accepts destination parameter', async () => {
    const result = await mcpCall('copy_document', {
      identifier: SOURCE_REL,
      destination: COPY_REL,
    });

    expect(result.status).toBe(200);
    expect(result.isError).toBeFalsy();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Original Document');
    expect(text).toContain(COPY_REL);
  });

  it('Test 2: copy_document preserves source metadata immutably', async () => {
    // Read the copy file directly to verify frontmatter
    const copyRaw = await readFile(join(vaultPath, COPY_REL), 'utf-8');
    const parsed = matter(copyRaw);

    expect(parsed.data[FM.TITLE]).toBe('Original Document');
    expect(Array.isArray(parsed.data[FM.TAGS])).toBe(true);
    expect(parsed.data[FM.TAGS]).toContain('important');
    expect(parsed.data[FM.TAGS]).toContain('archive');
  });

  it('Test 3: copy_document generates new fqc_id', async () => {
    const sourceRaw = await readFile(join(vaultPath, SOURCE_REL), 'utf-8');
    const copyRaw = await readFile(join(vaultPath, COPY_REL), 'utf-8');

    const sourceParsed = matter(sourceRaw);
    const copyParsed = matter(copyRaw);

    const copyFqcId = copyParsed.data[FM.ID];
    expect(typeof copyFqcId).toBe('string');
    expect(copyFqcId).toBeTruthy();

    // Source was written manually without an fqc_id — copy must have a fresh UUID
    const sourceFqcId = sourceParsed.data[FM.ID];
    if (sourceFqcId) {
      expect(copyFqcId).not.toBe(sourceFqcId);
    }
  });

  it('Test 4: copy_document does not accept title or tags parameters', async () => {
    // The tool schema only defines `identifier` and `destination`.
    // Extra fields are stripped by the MCP SDK/Zod; the call should succeed.
    const result = await mcpCall('copy_document', {
      identifier: SOURCE_REL,
      destination: 'Documents/copy2.md',
      title: 'Different Title', // not in schema — stripped
      tags: ['different'],      // not in schema — stripped
    });

    expect(result.status).toBe(200);
    expect(result.isError).toBeFalsy();
  });

  it('Test 6: remove_directory safely removes empty directories', async () => {
    const emptyRelPath = 'Documents/empty-to-remove';
    await mkdir(join(vaultPath, emptyRelPath), { recursive: true });

    const result = await mcpCall('remove_directory', { path: emptyRelPath });

    expect(result.status).toBe(200);
    expect(result.isError).toBeFalsy();
    expect(existsSync(join(vaultPath, emptyRelPath))).toBe(false);
  });

  it('Test 7: remove_directory blocks removal of vault root', async () => {
    const result = await mcpCall('remove_directory', { path: '.' });

    expect(result.status).toBe(200);
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('Cannot remove the vault root directory');
  });

  it('Test 8: remove_directory formats non-empty error listing', async () => {
    const nonEmptyRelPath = 'Documents/non-empty';
    await mkdir(join(vaultPath, nonEmptyRelPath), { recursive: true });
    await writeFile(join(vaultPath, nonEmptyRelPath, 'file1.md'), '# File 1');
    await writeFile(join(vaultPath, nonEmptyRelPath, 'file2.md'), '# File 2');
    await mkdir(join(vaultPath, nonEmptyRelPath, 'subdir'), { recursive: true });

    const result = await mcpCall('remove_directory', { path: nonEmptyRelPath });

    expect(result.status).toBe(200);
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('is not empty');
    expect(text).toContain('[file]');
    expect(text).toContain('[dir]');
    expect(text).toContain('Contents (');
  });
});
