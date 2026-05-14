import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initLogger } from '../../src/logging/logger.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { HAS_SUPABASE, TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

const TEST_INSTANCE_ID = 'phase-124-write-document-integration';
const SKIP = !HAS_SUPABASE;

function makeConfig(vaultPath: string, hostTools: string[] = ['tier:read-write']): FlashQueryConfig {
  return {
    instance: {
      name: 'phase-124-write-document-integration',
      id: TEST_INSTANCE_ID,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    embedding: { provider: 'none', model: '', apiKey: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false, ttlSeconds: 30 },
    hostMcpTools: { tools: hostTools, excludedTools: [] },
  } as unknown as FlashQueryConfig;
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

function computeHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

describe.skipIf(SKIP)('Phase 124 document write primitives (integration)', () => {
  let vaultPath: string;
  let config: FlashQueryConfig;

  beforeAll(async () => {
    vaultPath = await mkdtemp(join(tmpdir(), 'fqc-phase-124-'));
    config = makeConfig(vaultPath);
    initLogger(config);
    await initSupabase(config);
    initEmbedding(config);
    await initVault(config);
  }, 60_000);

  afterAll(async () => {
    await supabaseManager.getClient().from('fqc_documents').delete().eq('instance_id', TEST_INSTANCE_ID);
    await supabaseManager.getClient().from('fqc_memory').delete().eq('instance_id', TEST_INSTANCE_ID);
    await rm(vaultPath, { recursive: true, force: true });
    await supabaseManager.close();
  });

  it('write_document create/update persists JSON-identifiable document state', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const createResult = await getHandler('write_document')({
      mode: 'create',
      path: 'phase-124/write-create.md',
      title: 'Write Create',
      content: 'Initial body.',
      tags: ['initial'],
      frontmatter: { owner: 'integration' },
    }) as { isError?: boolean };
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(textOf(createResult)) as { path: string; fq_id: string; mode: string };
    expect(created).toMatchObject({ path: 'phase-124/write-create.md', mode: 'create' });

    const updateResult = await getHandler('write_document')({
      mode: 'update',
      identifier: created.fq_id,
      title: 'Write Updated',
      content: 'Updated body.',
      tags: ['updated'],
      frontmatter: { reviewer: 'ai-dev-agent' },
    }) as { isError?: boolean };
    expect(updateResult.isError).toBeFalsy();
    const updated = JSON.parse(textOf(updateResult)) as { path: string; mode: string };
    expect(updated).toMatchObject({ path: 'phase-124/write-create.md', mode: 'update' });

    const raw = await readFile(join(vaultPath, 'phase-124/write-create.md'), 'utf-8');
    expect(raw).toContain('Write Updated');
    expect(raw).toContain('Updated body.');
    expect(raw).toContain('reviewer: ai-dev-agent');

    const { data: row, error } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('content_hash')
      .eq('id', created.fq_id)
      .single();
    expect(error).toBeNull();
    expect((row as { content_hash: string }).content_hash).toBe(computeHash(raw));
  });

  it('write_document create rejects symlinked vault path segments', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);

    const outsideDir = await mkdtemp(join(tmpdir(), 'fqc-phase-124-outside-'));
    await symlink(outsideDir, join(vaultPath, 'phase-124-symlink'), 'dir');

    const result = await getHandler('write_document')({
      mode: 'create',
      path: 'phase-124-symlink/escaped.md',
      title: 'Escaped',
      content: 'Should not write outside the vault.',
    }) as { isError?: boolean };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as { error: string; details?: { field?: string } };
    expect(payload).toMatchObject({ error: 'invalid_input', details: { field: 'path' } });
    await expect(readFile(join(outsideDir, 'escaped.md'), 'utf-8')).rejects.toThrow();
    await rm(outsideDir, { recursive: true, force: true });
  });

  it('insert_in_doc and replace_doc_section honor exact/ambiguous matching envelopes', async () => {
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, config);
    registerCompoundTools(server, config);

    await getHandler('write_document')({
      mode: 'create',
      path: 'phase-124/section-edit.md',
      title: 'Section Edit',
      content: ['# Section Edit', '## Tasks', 'Old task.', '## Tasks Later', 'Other task.'].join('\n'),
    });

    const ambiguous = await getHandler('insert_in_doc')({
      identifier: 'phase-124/section-edit.md',
      position: 'after_heading',
      heading: 'Tasks',
      content: 'Ambiguous insert.',
    }) as { isError?: boolean };
    expect(ambiguous.isError).toBe(false);
    expect(JSON.parse(textOf(ambiguous))).toMatchObject({ error: 'ambiguous_identifier' });

    const inserted = await getHandler('insert_in_doc')({
      identifier: 'phase-124/section-edit.md',
      position: 'after_heading',
      heading: 'Tasks',
      heading_match: 'exact',
      content: 'Inserted task.',
    }) as { isError?: boolean };
    expect(inserted.isError).toBeFalsy();
    const insertRaw = await readFile(join(vaultPath, 'phase-124/section-edit.md'), 'utf-8');
    const { data: afterInsert } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('content_hash')
      .eq('path', 'phase-124/section-edit.md')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect((afterInsert as { content_hash: string }).content_hash).toBe(computeHash(insertRaw));

    const replaced = await getHandler('replace_doc_section')({
      identifier: 'phase-124/section-edit.md',
      heading: 'Tasks Later',
      heading_match: 'exact',
      content: 'Replacement task.',
    }) as { isError?: boolean };
    expect(replaced.isError).toBeFalsy();
    const payload = JSON.parse(textOf(replaced)) as { extracted_section: { heading: string } };
    expect(payload.extracted_section.heading).toBe('Tasks Later');
    const replaceRaw = await readFile(join(vaultPath, 'phase-124/section-edit.md'), 'utf-8');
    const { data: afterReplace } = await supabaseManager
      .getClient()
      .from('fqc_documents')
      .select('content_hash')
      .eq('path', 'phase-124/section-edit.md')
      .eq('instance_id', TEST_INSTANCE_ID)
      .single();
    expect((afterReplace as { content_hash: string }).content_hash).toBe(computeHash(replaceRaw));
  });

  it('apply_tags returns per-target unsupported when memory category is disabled', async () => {
    const docOnlyConfig = makeConfig(vaultPath, ['category:doc-write']);
    const { server, getHandler } = createMockServer();
    registerDocumentTools(server, docOnlyConfig);
    registerCompoundTools(server, docOnlyConfig);

    await getHandler('write_document')({
      mode: 'create',
      path: 'phase-124/tags.md',
      title: 'Tags',
      content: 'Taggable.',
    });

    const result = await getHandler('apply_tags')({
      targets: [
        { entity_type: 'document', identifier: 'phase-124/tags.md' },
        { entity_type: 'memory', identifier: '00000000-0000-0000-0000-000000000000' },
      ],
      add_tags: ['phase-124'],
    }) as { isError?: boolean };

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse(textOf(result)) as Array<Record<string, unknown>>;
    expect(payload[0]).toMatchObject({ entity_type: 'document', tags: ['phase-124'] });
    expect(payload[1]).toMatchObject({
      error: 'unsupported',
      identifier: '00000000-0000-0000-0000-000000000000',
      details: { disabled_category: 'memory' },
    });
  });
});
