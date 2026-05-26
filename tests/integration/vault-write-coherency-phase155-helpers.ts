import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { initLogger } from '../../src/logging/logger.js';
import { registerCompoundTools } from '../../src/mcp/tools/compound.js';
import { registerDocumentTools } from '../../src/mcp/tools/documents.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault, vaultManager } from '../../src/storage/vault.js';
import { TEST_DATABASE_URL, TEST_SUPABASE_KEY, TEST_SUPABASE_URL } from '../helpers/test-env.js';

export type ToolHandler = (params: Record<string, unknown>) => Promise<unknown>;

export interface Phase155Harness {
  config: FlashQueryConfig;
  handlers: Record<string, ToolHandler>;
  instanceId: string;
  vaultPath: string;
  cleanup: () => Promise<void>;
}

export function makePhase155Config(vaultPath: string, instanceId = `wco-155-${randomUUID().slice(0, 8)}`): FlashQueryConfig {
  return {
    instance: {
      name: 'Vault Write Coherency Phase 155 Integration',
      id: instanceId,
      vault: { path: vaultPath, markdownExtensions: ['.md'] },
    },
    server: { host: 'localhost', port: 3100 },
    supabase: {
      url: TEST_SUPABASE_URL,
      serviceRoleKey: TEST_SUPABASE_KEY,
      databaseUrl: TEST_DATABASE_URL,
      skipDdl: false,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio', tokenLifetime: 24 },
    locking: { enabled: false },
    trashFolder: { enabled: false, path: '.flashquery/removed', collisionStrategy: 'suffix' },
    hostMcpTools: { tools: ['tier:read-write', 'call_macro'], excludedTools: [] },
    llm: { providers: [], models: [], purposes: [] },
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stderr' },
  } as FlashQueryConfig;
}

export function createPhase155Handlers(config: FlashQueryConfig): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: ToolHandler) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerDocumentTools(server, config);
  registerCompoundTools(server, config);
  return handlers;
}

export async function createPhase155Harness(prefix: string): Promise<Phase155Harness> {
  const vaultPath = await mkdtemp(join(tmpdir(), prefix));
  const instanceId = `wco-155-${randomUUID().slice(0, 8)}`;
  const config = makePhase155Config(vaultPath, instanceId);
  initLogger(config);
  await initSupabase(config);
  initEmbedding(config);
  await initVault(config);

  return {
    config,
    handlers: createPhase155Handlers(config),
    instanceId,
    vaultPath,
    cleanup: async () => {
      try {
        const supabase = supabaseManager.getClient();
        await supabase.from('fqc_documents').delete().eq('instance_id', instanceId);
        await supabase.from('fqc_vault').delete().eq('instance_id', instanceId);
        await supabaseManager.close();
      } catch {
        // Best effort: setup may fail before singleton initialization.
      }
      await rm(vaultPath, { recursive: true, force: true });
    },
  };
}

export function parseToolJson<T = Record<string, unknown>>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]?.text ?? '{}') as T;
}

export async function writeDocument(
  handlers: Record<string, ToolHandler>,
  path: string,
  title: string,
  content: string,
  tags: string[] = ['wco-phase-155']
): Promise<Record<string, unknown>> {
  const result = await handlers.write_document({
    mode: 'create',
    path,
    title,
    content,
    tags,
  });
  if ((result as { isError?: boolean }).isError) {
    throw new Error(`write_document create failed: ${(result as { content: Array<{ text: string }> }).content[0]?.text}`);
  }
  return parseToolJson(result);
}

export function createGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for condition');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

export function patchVaultWriteMarkdown(
  patched: typeof vaultManager.writeMarkdown
): () => void {
  const original = vaultManager.writeMarkdown;
  vaultManager.writeMarkdown = patched;
  return () => {
    vaultManager.writeMarkdown = original;
  };
}
