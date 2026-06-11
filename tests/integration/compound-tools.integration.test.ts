import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import matter from 'gray-matter';
import { initLogger } from '../../src/logging/logger.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initVault } from '../../src/storage/vault.js';
import { initPlugins } from '../../src/plugins/manager.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { FM } from '../../src/constants/frontmatter-fields.js';
import { TEST_SUPABASE_URL, TEST_SUPABASE_KEY, TEST_DATABASE_URL, HAS_SUPABASE } from '../helpers/test-env.js';

const SKIP = !HAS_SUPABASE;
const INSTANCE_ID = 'compound-integration-test';

function makeConfig(vaultPath: string): FlashQueryConfig {
  return {
    instance: { name: 'compound-integration-test', id: INSTANCE_ID, vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    supabase: { url: TEST_SUPABASE_URL, serviceRoleKey: TEST_SUPABASE_KEY, databaseUrl: TEST_DATABASE_URL, skipDdl: false },
    server: { host: 'localhost', port: 3100 },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false },
  } as unknown as FlashQueryConfig;
}

function createMockServer() {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (_name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;
  return { server, getHandler: (name: string) => handlers[name] };
}

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function getText(result: unknown): string {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  return r.content[0]?.text ?? '';
}

function isError(result: unknown): boolean {
  return (result as { isError?: boolean }).isError === true;
}

async function seedDocument(opts: {
  vaultPath: string;
  relPath: string;
  title: string;
  body: string;
  tags?: string[];
}): Promise<string> {
  const fqcId = randomUUID();
  const fm = {
    [FM.TITLE]: opts.title,
    [FM.ID]: fqcId,
    [FM.STATUS]: 'active',
    [FM.TAGS]: opts.tags ?? [],
  };
  const raw = matter.stringify(opts.body, fm);
  const absPath = join(opts.vaultPath, opts.relPath);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, raw, 'utf-8');

  const { error: cleanupError } = await supabaseManager.getClient()
    .from('fqc_documents')
    .delete()
    .eq('instance_id', INSTANCE_ID)
    .eq('path', opts.relPath);
  if (cleanupError) throw new Error(cleanupError.message);

  const { error } = await supabaseManager.getClient().from('fqc_documents').insert({
    id: fqcId,
    instance_id: INSTANCE_ID,
    title: opts.title,
    path: opts.relPath,
    content_hash: computeHash(raw),
    status: 'active',
    tags: opts.tags ?? [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);

  return fqcId;
}

async function seedMemory(opts: { content: string; tags?: string[] }): Promise<string> {
  const id = randomUUID();
  const { error } = await supabaseManager.getClient().from('fqc_memory').insert({
    id,
    instance_id: INSTANCE_ID,
    content: opts.content,
    status: 'active',
    tags: opts.tags ?? [],
    plugin_scope: 'global',
    is_latest: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
  return id;
}

describe.skipIf(SKIP)('Compound Tools Integration', () => {
  let vaultPath: string;
  let handlers: ReturnType<typeof createMockServer>['getHandler'];
  let sourcePath: string;
  let targetPath: string;
  let sourceId: string;
  let targetId: string;
  let briefingDocId: string;
  let briefingMemoryId: string;
  const briefingTag = `compound-briefing-${randomUUID()}`;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-compound-integration-'));
    const config = makeConfig(vaultPath);

    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
    await initPlugins(config);
    const { error: documentCleanupError } = await supabaseManager.getClient()
      .from('fqc_documents')
      .delete()
      .eq('instance_id', INSTANCE_ID);
    if (documentCleanupError) throw new Error(documentCleanupError.message);
    const { error: memoryCleanupError } = await supabaseManager.getClient()
      .from('fqc_memory')
      .delete()
      .eq('instance_id', INSTANCE_ID);
    if (memoryCleanupError) throw new Error(memoryCleanupError.message);

    const { server, getHandler } = createMockServer();
    registerCompoundTools(server, config);
    handlers = getHandler;

    sourcePath = '_global/link-source.md';
    targetPath = '_global/link-target.md';
    sourceId = await seedDocument({
      vaultPath,
      relPath: sourcePath,
      title: 'Link Source Document',
      body: 'Source document body.',
    });
    targetId = await seedDocument({
      vaultPath,
      relPath: targetPath,
      title: 'Compound Integration Link Target',
      body: 'Link target content.',
    });
    briefingDocId = await seedDocument({
      vaultPath,
      relPath: '_global/briefing-doc.md',
      title: 'Briefing Integration Document',
      body: 'Briefing body.',
      tags: [briefingTag],
    });
    briefingMemoryId = await seedMemory({
      content: 'Briefing memory content.',
      tags: [briefingTag],
    });

    const sourceRaw = await readFile(join(vaultPath, sourcePath), 'utf-8');
    expect(matter(sourceRaw).data[FM.ID]).toBe(sourceId);
    const { data: sourceRows, error: sourceRowsError } = await supabaseManager.getClient()
      .from('fqc_documents')
      .select('id')
      .eq('instance_id', INSTANCE_ID)
      .eq('path', sourcePath);
    if (sourceRowsError) throw new Error(sourceRowsError.message);
    expect(sourceRows).toEqual([{ id: sourceId }]);
  }, 180_000);

  afterAll(async () => {
    await supabaseManager?.getClient().from('fqc_documents').delete().eq('instance_id', INSTANCE_ID);
    await supabaseManager?.getClient().from('fqc_memory').delete().eq('instance_id', INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true }).catch(() => undefined);
  }, 60_000);

  it('insert_doc_link returns structured updated and unchanged statuses', async () => {
    const first = await handlers('insert_doc_link')({
      identifiers: sourcePath,
      target_identifier: targetId,
      property: 'links',
    });

    expect(isError(first)).toBe(false);
    const firstJson = JSON.parse(getText(first));
    expect(firstJson.results).toHaveLength(1);
    expect(firstJson.results[0]).toMatchObject({
      identifier: sourcePath,
      fq_id: sourceId,
      path: sourcePath,
      status: 'updated',
      size: { chars: expect.any(Number) },
      target: { fq_id: targetId, path: targetPath },
    });
    expect(firstJson.removal_gate).toContain('call_macro');

    const second = await handlers('insert_doc_link')({
      identifiers: [sourcePath, 'missing-source.md'],
      target_identifier: targetPath,
      property: 'links',
    });

    expect(isError(second)).toBe(false);
    const secondJson = JSON.parse(getText(second));
    const secondResults = Array.isArray(secondJson) ? secondJson : secondJson.results;
    expect(secondResults).toHaveLength(2);
    expect(secondResults[0]).toMatchObject({
      identifier: sourcePath,
      result_status: 'unchanged',
      status: 'succeeded',
    });
    expect(secondResults[1]).toMatchObject({
      identifier: 'missing-source.md',
      status: 'failed',
      error: { error: 'not_found' },
    });

    const missingTarget = await handlers('insert_doc_link')({
      identifiers: sourcePath,
      target_identifier: 'missing-target.md',
    });
    expect(isError(missingTarget)).toBe(false);
    expect(JSON.parse(getText(missingTarget))).toMatchObject({
      error: 'not_found',
      identifier: 'missing-target.md',
    });

    const raw = await readFile(join(vaultPath, sourcePath), 'utf-8');
    const parsed = matter(raw);
    expect(parsed.data.links).toEqual(['[[Compound Integration Link Target]]']);
  });

  it('get_briefing returns structured grouped JSON', async () => {
    const result = await handlers('get_briefing')({
      tags: [briefingTag],
      tag_match: 'any',
      limit: 10,
    });

    expect(isError(result)).toBe(false);
    const parsed = JSON.parse(getText(result));
    expect(parsed.generated_at).toEqual(expect.any(String));
    expect(parsed.entity_types).toEqual(['documents', 'memories']);
    expect(parsed.groups).toEqual([
      expect.objectContaining({
        type: 'tag',
        tag: briefingTag,
        items: expect.arrayContaining([
          expect.objectContaining({
            entity_type: 'document',
            fq_id: briefingDocId,
            modified: expect.any(String),
            size: { chars: expect.any(Number) },
          }),
          expect.objectContaining({
            entity_type: 'memory',
            memory_id: briefingMemoryId,
            plugin_scope: 'global',
            created_at: expect.any(String),
            updated_at: expect.any(String),
          }),
        ]),
      }),
    ]);
    expect(parsed.removal_gate).toContain('call_macro');
  });
});
