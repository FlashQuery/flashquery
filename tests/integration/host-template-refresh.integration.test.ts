import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { initEmbedding } from '../../src/embedding/provider.js';
import { assembleTemplateToolRegistry } from '../../src/llm/template-tools.js';
import { initLogger } from '../../src/logging/logger.js';
import { logger } from '../../src/logging/logger.js';
import { refreshHostTemplateToolsForAllSessions, releaseHostTemplateToolsForServer } from '../../src/mcp/host-template-tools.js';
import { createMcpRequestLifecycle } from '../../src/mcp/request-lifecycle.js';
import { registerMcpRequestLifecycle, unregisterMcpServerForShutdown } from '../../src/mcp/request-lifecycle-registry.js';
import {
  createMcpServer,
  initializeHostToolSearchForServer,
} from '../../src/mcp/server.js';
import {
  getMaintenanceJobStatus,
  resetMaintenanceStateForTests,
  setHostTemplateRefreshHook,
} from '../../src/services/maintenance.js';
import { setShuttingDown } from '../../src/server/shutdown-state.js';
import { initSupabase, supabaseManager } from '../../src/storage/supabase.js';
import { initVault } from '../../src/storage/vault.js';
import {
  HAS_SUPABASE,
  TEST_DATABASE_URL,
  TEST_SUPABASE_KEY,
  TEST_SUPABASE_URL,
} from '../helpers/test-env.js';

interface Session {
  server: McpServer;
  client: Client;
  clientTransport: InMemoryTransport;
  serverTransport: InMemoryTransport;
}

const activeSessions: Session[] = [];
const activeServers: McpServer[] = [];
const tempRoots: string[] = [];
const instanceIds = new Set<string>();

function makeConfig(
  vaultPath: string,
  overrides: Partial<FlashQueryConfig> & {
    templates?: FlashQueryConfig['templates'];
    hostMcpTools?: FlashQueryConfig['hostMcpTools'];
  } = {}
): FlashQueryConfig {
  const instanceId = `host-template-refresh-${randomUUID()}`;
  instanceIds.add(instanceId);
  const config = {
    instance: {
      name: 'Host Template Refresh Integration',
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
    embedding: { provider: 'none', model: '', dimensions: 1536 },
    logging: { level: 'error', output: 'stdout' },
    host: { mcpServers: [], toolSearch: 'enabled' },
    macro: { defaultTimeoutMs: 60000 },
    templates: { defaultAccess: 'permissive', hostAccess: 'permissive', hostTemplates: [] },
    llm: {
      providers: [],
      models: [],
      purposes: [{ name: 'researcher', description: 'Researcher', models: [] }],
    },
    ...overrides,
  } as FlashQueryConfig;
  return config;
}

async function makeVault(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'fqc-host-template-refresh-'));
  tempRoots.push(root);
  return root;
}

async function writeDoc(vaultPath: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const path = join(vaultPath, relPath);
  await mkdir(dirname(path), { recursive: true });
  const yaml = Object.entries(frontmatter)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  await writeFile(path, `---\n${yaml}\n---\n\n${body}`, 'utf8');
}

function templateFrontmatter(input: {
  desc?: string;
  namespace?: string;
  expose?: boolean;
  params?: Record<string, unknown>;
} = {}): Record<string, unknown> {
  return {
    fq_template: true,
    fq_expose_as_tool: input.expose ?? true,
    fq_namespace: input.namespace ?? 'skill',
    fq_desc: input.desc ?? 'Integration template',
    ...(input.params === undefined ? {} : { fq_params: input.params }),
  };
}

async function createSession(config: FlashQueryConfig): Promise<Session> {
  await initVault(config);
  const server = createMcpServer(config, 'test');
  await initializeHostToolSearchForServer(server);
  setHostTemplateRefreshHook(refreshHostTemplateToolsForAllSessions);
  const client = new Client({ name: 'host-template-refresh-integration', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  const session = { server, client, clientTransport, serverTransport };
  activeSessions.push(session);
  return session;
}

async function closeSession(session: Session): Promise<void> {
  await session.client.close().catch(() => undefined);
  await session.serverTransport.close().catch(() => undefined);
  await session.clientTransport.close().catch(() => undefined);
  unregisterMcpServerForShutdown(session.server);
  releaseHostTemplateToolsForServer(session.server);
}

function textOf(result: CallToolResult): string {
  const first = result.content[0];
  if (first?.type !== 'text') throw new Error('Expected text result.');
  return first.text;
}

function jsonOf<T = Record<string, unknown>>(result: CallToolResult): T {
  return JSON.parse(textOf(result)) as T;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  return await client.callTool({ name, arguments: args }) as CallToolResult;
}

async function syncViaClient(client: Client, args: Record<string, unknown> = { action: 'sync' }): Promise<Record<string, unknown>> {
  const result = await callTool(client, 'maintain_vault', args);
  expect(result.isError).toBeFalsy();
  return jsonOf(result);
}

async function toolByName(client: Client, name: string): Promise<Tool | undefined> {
  const { tools } = await client.listTools();
  return tools.find((tool) => tool.name === name);
}

async function expectTool(client: Client, name: string): Promise<Tool> {
  const tool = await toolByName(client, name);
  expect(tool, `expected ${name} in tools/list`).toBeDefined();
  return tool as Tool;
}

async function expectNoTool(client: Client, name: string): Promise<void> {
  expect(await toolByName(client, name), `expected ${name} to be absent from tools/list`).toBeUndefined();
}

async function waitForBackgroundJob(jobId: string): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  await vi.waitFor(() => {
    const status = getMaintenanceJobStatus(jobId);
    expect(status.ok).toBe(true);
    if (!status.ok) throw new Error('status should exist');
    payload = status.payload as unknown as Record<string, unknown>;
    expect(payload.status).toBe('completed');
  }, { timeout: 10_000 });
  return payload ?? {};
}

async function cleanupDatabase(): Promise<void> {
  const client = supabaseManager.getClient();
  for (const instanceId of instanceIds) {
    await client.from('fqc_pending_plugin_review').delete().eq('instance_id', instanceId).then(() => undefined);
    await client.from('fqc_documents').delete().eq('instance_id', instanceId).then(() => undefined);
    await client.from('fqc_memory').delete().eq('instance_id', instanceId).then(() => undefined);
    await client.from('fqc_vault').delete().eq('id', instanceId).then(() => undefined);
  }
  instanceIds.clear();
}

describe.skipIf(!HAS_SUPABASE)('host template tool refresh integration', () => {
  beforeAll(async () => {
    const bootstrap = makeConfig(await makeVault());
    initLogger(bootstrap);
    await initSupabase(bootstrap);
    initEmbedding(bootstrap);
  }, 60_000);

  afterEach(async () => {
    while (activeSessions.length > 0) {
      const session = activeSessions.pop();
      if (session !== undefined) await closeSession(session);
    }
    while (activeServers.length > 0) {
      const server = activeServers.pop();
      if (server !== undefined) {
        unregisterMcpServerForShutdown(server);
        releaseHostTemplateToolsForServer(server);
      }
    }
    setShuttingDown(false);
    resetMaintenanceStateForTests();
    vi.restoreAllMocks();
    await cleanupDatabase();
    while (tempRoots.length > 0) {
      const root = tempRoots.pop();
      if (root !== undefined) await rm(root, { recursive: true, force: true });
    }
  });

  it('T-I-016 refreshes multiple active sessions with the same changed host surface', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const sessionA = await createSession(config);
    const sessionB = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Multi.md', templateFrontmatter({ desc: 'Multi session template' }), 'Multi body');

    const payload = await syncViaClient(sessionA.client);

    await expectTool(sessionA.client, 'flashquery_skill_multi');
    await expectTool(sessionB.client, 'flashquery_skill_multi');
    const refresh = ((payload.actions as Array<Record<string, unknown>>)[0].host_template_refresh ?? {}) as Record<string, unknown>;
    expect(refresh).toMatchObject({ sessions: 2 });
    expect(refresh).not.toHaveProperty('session_failures');
  });

  it('T-I-011 includes host_template_refresh summary counts and changed paths in maintain_vault response', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Summary.md', templateFrontmatter({ desc: 'Summary template' }), 'Summary body');

    const payload = await syncViaClient(client);

    const refresh = ((payload.actions as Array<Record<string, unknown>>)[0].host_template_refresh ?? {}) as Record<string, unknown>;
    expect(refresh).toMatchObject({
      attempted: true,
      sessions: 1,
      added: [{ tool: 'flashquery_skill_summary', path: 'Templates/Summary.md' }],
      removed: [],
      updated: [],
      skipped: [],
      warnings: [],
      conflicts: [],
    });
  });

  it('T-I-018 reports invalid templates with path and reason without leaking body content', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Invalid.md', {
      fq_template: true,
      fq_expose_as_tool: true,
    }, 'SECRET INVALID BODY');

    const payload = await syncViaClient(client);

    const refresh = ((payload.actions as Array<Record<string, unknown>>)[0].host_template_refresh ?? {}) as Record<string, unknown>;
    expect(refresh.skipped).toEqual([
      expect.objectContaining({ path: 'Templates/Invalid.md', code: expect.any(String), message: expect.any(String) }),
    ]);
    expect(JSON.stringify(refresh)).not.toContain('SECRET INVALID BODY');
  });

  it('T-I-001 sync makes a new valid template appear in tools/list', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/New Tool.md', templateFrontmatter({ desc: 'New tool template' }), 'New tool body');

    await syncViaClient(client);

    await expectTool(client, 'flashquery_skill_new_tool');
  });

  it('T-I-002 sync removes a disabled template from tools/list', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Disable.md', templateFrontmatter({ desc: 'Disable template' }), 'Disable body');
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await expectTool(client, 'flashquery_skill_disable');

    await writeDoc(vaultPath, 'Templates/Disable.md', templateFrontmatter({ desc: 'Disable template', expose: false }), 'Disabled body');
    await syncViaClient(client);

    await expectNoTool(client, 'flashquery_skill_disable');
  });

  it('T-I-003 sync updates a changed fq_desc in tools/list', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Describe.md', templateFrontmatter({ desc: 'Description v1' }), 'Describe body');
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);

    await writeDoc(vaultPath, 'Templates/Describe.md', templateFrontmatter({ desc: 'Description v2' }), 'Describe body');
    await syncViaClient(client);

    expect((await expectTool(client, 'flashquery_skill_describe')).description).toBe('Description v2');
  });

  it('T-I-004 sync updates changed fq_params in tools/list input schema', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Params.md', templateFrontmatter({
      desc: 'Params template',
      params: { topic: { type: 'string', required: true } },
    }), 'Params {{topic}} {{audience}}');
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);

    await writeDoc(vaultPath, 'Templates/Params.md', templateFrontmatter({
      desc: 'Params template',
      params: {
        topic: { type: 'string', required: true },
        audience: { type: 'string', required: true },
      },
    }), 'Params {{topic}} {{audience}}');
    await syncViaClient(client);

    const schema = (await expectTool(client, 'flashquery_skill_params')).inputSchema as Record<string, unknown>;
    expect(JSON.stringify(schema)).toContain('audience');
  });

  it('T-I-005 repair plus sync refreshes host tools after the sync portion', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Repair Sync.md', templateFrontmatter({ desc: 'Repair sync template' }), 'Repair sync body');

    await syncViaClient(client, { action: ['repair', 'sync'] });

    await expectTool(client, 'flashquery_skill_repair_sync');
  });

  it('T-I-006 background sync completion refreshes host tools', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Background.md', templateFrontmatter({ desc: 'Background template' }), 'Background body');

    const accepted = jsonOf(await callTool(client, 'maintain_vault', { action: 'sync', background: true }));
    await waitForBackgroundJob(accepted.job_id as string);

    await expectTool(client, 'flashquery_skill_background');
  });

  it('T-I-007 sync dry_run remains rejected by validation', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);

    const result = await callTool(client, 'maintain_vault', { action: 'sync', dry_run: true });

    expect(result.isError).toBeFalsy();
    expect(jsonOf(result)).toMatchObject({ error: 'invalid_input', details: { parameter: 'dry_run' } });
  });

  it('T-I-008 repair-only maintenance leaves host tools/list unchanged', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Repair Only.md', templateFrontmatter({ desc: 'Repair-only template' }), 'Repair body');

    await syncViaClient(client, { action: 'repair' });

    await expectNoTool(client, 'flashquery_skill_repair_only');
  });

  it('T-I-009 search_tools finds a new template tool after sync', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    await writeDoc(vaultPath, 'Templates/Searchable.md', templateFrontmatter({ desc: 'Queryable template diagnostics' }), 'Searchable body');

    await syncViaClient(client);
    const results = jsonOf<Array<Record<string, unknown>>>(await callTool(client, 'search_tools', { query: 'Queryable diagnostics', limit: 5 }));

    expect(results).toContainEqual(expect.objectContaining({
      server: 'flashquery',
      registry_key: 'flashquery_skill_searchable',
      tool: 'flashquery_skill_searchable',
    }));
  });

  it('T-I-010 search_tools drops a removed template tool after sync', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Search Drop.md', templateFrontmatter({ desc: 'Drop searchable template' }), 'Search drop body');
    const config = makeConfig(vaultPath);
    const { client } = await createSession(config);
    expect(jsonOf<Array<Record<string, unknown>>>(await callTool(client, 'search_tools', { query: 'Drop searchable', limit: 5 }))).toContainEqual(
      expect.objectContaining({ registry_key: 'flashquery_skill_search_drop' })
    );

    await writeDoc(vaultPath, 'Templates/Search Drop.md', templateFrontmatter({ desc: 'Drop searchable template', expose: false }), 'Search drop body');
    await syncViaClient(client);
    const results = jsonOf<Array<Record<string, unknown>>>(await callTool(client, 'search_tools', { query: 'Drop searchable', limit: 5 }));

    expect(results).not.toContainEqual(expect.objectContaining({ registry_key: 'flashquery_skill_search_drop' }));
  });

  it('T-I-012 host_access permissive exposes all eligible templates in tools/list', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Permissive.md', templateFrontmatter({ desc: 'Permissive template' }), 'Permissive body');
    const config = makeConfig(vaultPath, {
      templates: { defaultAccess: 'permissive', hostAccess: 'permissive', hostTemplates: [] },
    });
    const { client } = await createSession(config);

    await expectTool(client, 'flashquery_skill_permissive');
  });

  it('T-I-013 host_access restrictive exposes only host_templates exact paths', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Allowed.md', templateFrontmatter({ desc: 'Allowed template' }), 'Allowed body');
    await writeDoc(vaultPath, 'Templates/Denied.md', templateFrontmatter({ desc: 'Denied template' }), 'Denied body');
    const config = makeConfig(vaultPath, {
      templates: { defaultAccess: 'permissive', hostAccess: 'restrictive', hostTemplates: ['Templates/Allowed.md'] },
    });
    const { client } = await createSession(config);

    await expectTool(client, 'flashquery_skill_allowed');
    await expectNoTool(client, 'flashquery_skill_denied');
  });

  it('T-I-014 host_access restrictive with empty host_templates exposes no host template tools', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Hidden.md', templateFrontmatter({ desc: 'Hidden template' }), 'Hidden body');
    const config = makeConfig(vaultPath, {
      templates: { defaultAccess: 'permissive', hostAccess: 'restrictive', hostTemplates: [] },
    });
    const { client } = await createSession(config);

    await expectNoTool(client, 'flashquery_skill_hidden');
  });

  it('T-I-015 host_access does not alter delegated default_access template discovery', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Delegated.md', templateFrontmatter({ desc: 'Delegated template' }), 'Delegated body');
    const config = makeConfig(vaultPath, {
      templates: { defaultAccess: 'permissive', hostAccess: 'restrictive', hostTemplates: [] },
    });
    const { client } = await createSession(config);
    await syncViaClient(client);

    await expectNoTool(client, 'flashquery_skill_delegated');
    const registry = await assembleTemplateToolRegistry({ config, purposeName: 'researcher' });
    expect(registry.templateTools.map((tool) => tool.name)).toContain('flashquery_skill_delegated');
  });

  it('T-I-017 released sessions are absent from later refresh diagnostics', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const open = await createSession(config);
    const closed = await createSession(config);
    await closeSession(closed);
    activeSessions.splice(activeSessions.indexOf(closed), 1);
    await writeDoc(vaultPath, 'Templates/After Close.md', templateFrontmatter({ desc: 'After close template' }), 'After close body');

    const payload = await syncViaClient(open.client);

    await expectTool(open.client, 'flashquery_skill_after_close');
    const refresh = ((payload.actions as Array<Record<string, unknown>>)[0].host_template_refresh ?? {}) as Record<string, unknown>;
    expect(refresh).toMatchObject({ sessions: 1 });
    expect(refresh).not.toHaveProperty('session_failures');
  });

  it('T-I-019 notification failure is best-effort and keeps the registration diff applied', async () => {
    const vaultPath = await makeVault();
    const config = makeConfig(vaultPath);
    const { client, server } = await createSession(config);
    vi.spyOn(server, 'sendToolListChanged').mockRejectedValue(new Error('notify failed'));
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await writeDoc(vaultPath, 'Templates/Notify Failure.md', templateFrontmatter({ desc: 'Notify failure template' }), 'Notify failure body');

    await syncViaClient(client);

    await expectTool(client, 'flashquery_skill_notify_failure');
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('host template tool refresh notification failed: notify failed'));
  });

  it('T-I-020 multi-session refresh reports per-session failure detail while refreshing others', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Failure Detail.md', templateFrontmatter({ desc: 'Failure v1' }), 'Failure body');
    const config = makeConfig(vaultPath);
    const healthy = await createSession(config);
    const failing = {
      registerTool: vi.fn(() => {
        throw new Error('session registration failed');
      }),
      sendToolListChanged: vi.fn(async () => undefined),
    } as unknown as McpServer;
    registerMcpRequestLifecycle(failing, createMcpRequestLifecycle());
    activeServers.push(failing);
    await writeDoc(vaultPath, 'Templates/Failure Detail.md', templateFrontmatter({ desc: 'Failure v2' }), 'Failure body');

    const payload = await syncViaClient(healthy.client);

    expect((await expectTool(healthy.client, 'flashquery_skill_failure_detail')).description).toBe('Failure v2');
    const refresh = ((payload.actions as Array<Record<string, unknown>>)[0].host_template_refresh ?? {}) as Record<string, unknown>;
    expect(refresh).toMatchObject({ sessions: 2 });
    expect(refresh.session_failures).toEqual([
      expect.objectContaining({ message: 'session registration failed' }),
    ]);
  });

  it('T-I-021 host template exposure ignores host_mcp_tools native filtering', async () => {
    const vaultPath = await makeVault();
    await writeDoc(vaultPath, 'Templates/Native Filter.md', templateFrontmatter({ desc: 'Native filter template' }), 'Native filter body');
    const config = makeConfig(vaultPath, {
      hostMcpTools: { tools: ['maintain_vault'] },
      templates: { defaultAccess: 'permissive', hostAccess: 'permissive', hostTemplates: [] },
    });
    const { client } = await createSession(config);

    await expectTool(client, 'flashquery_skill_native_filter');
  });
});
