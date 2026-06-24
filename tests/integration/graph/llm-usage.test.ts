import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import pg from 'pg';

import { loadConfig, type FlashQueryConfig } from '../../../src/config/loader.js';
import { registerLlmUsageTools } from '../../../src/mcp/tools/llm-usage.js';
import { resolveGraphLlmCompletion } from '../../../src/graph/llm-analysis.js';
import { recordLlmUsage, drainCostWrites } from '../../../src/llm/cost-tracker.js';
import { initLogger } from '../../../src/logging/logger.js';
import { initSupabase } from '../../../src/storage/supabase.js';
import { setupTestSupabase } from '../../helpers/supabase.js';
import { HAS_SUPABASE } from '../../helpers/test-env.js';
import type { LlmClient, LlmCompletionResult } from '../../../src/llm/runtime-types.js';

const TEST_INSTANCE_ID = 'graph-llm-usage-it';

interface CapturedUsageServer {
  getLlmUsage(params: Record<string, unknown>): Promise<unknown>;
}

function parseToolJson<T>(result: unknown): T {
  return JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text) as T;
}

function captureUsageServer(config: FlashQueryConfig): CapturedUsageServer {
  const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: (params: Record<string, unknown>) => Promise<unknown>) => {
      handlers[name] = handler;
    },
  } as unknown as McpServer;
  registerLlmUsageTools(server, config);
  return {
    getLlmUsage: (params) => handlers.get_llm_usage!(params),
  };
}

function configForTest(): FlashQueryConfig {
  const config = loadConfig('tests/fixtures/flashquery.test.yml');
  if (process.env.SUPABASE_URL) config.supabase.url = process.env.SUPABASE_URL;
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) config.supabase.serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (process.env.DATABASE_URL) config.supabase.databaseUrl = process.env.DATABASE_URL;
  config.supabase.skipDdl = false;
  config.instance.id = TEST_INSTANCE_ID;
  config.llm = {
    providers: [],
    models: [],
    purposes: [],
  };
  config.graph = {
    enabled: true,
    classificationPurpose: 'graph-classifier',
  };
  return config;
}

function usageRecordingMockClient(): LlmClient {
  const result: LlmCompletionResult = {
    text: '{"key_claims":[]}',
    modelName: 'graph-mock-model',
    providerName: 'mock-provider',
    inputTokens: 10,
    outputTokens: 20,
    latencyMs: 5,
  };
  return {
    completeByPurpose: vi.fn(async (_purpose, _messages, _parameters, traceId) => {
      recordLlmUsage({
        instanceId: TEST_INSTANCE_ID,
        purposeName: 'graph-classifier',
        modelName: result.modelName,
        providerName: result.providerName,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: 0,
        latencyMs: result.latencyMs,
        fallbackPosition: 1,
        traceId: traceId ?? null,
      });
      return { ...result, purposeName: 'graph-classifier', fallbackPosition: 1 };
    }),
    complete: vi.fn(),
    chat: vi.fn(),
    chatByPurpose: vi.fn(),
    chatByPurposeUnrecorded: vi.fn(),
    getModelForPurpose: vi.fn(),
  } as unknown as LlmClient;
}

describe.skipIf(!HAS_SUPABASE)('graph LLM usage integration', () => {
  let client: pg.Client;
  let config: FlashQueryConfig;
  let usageServer: CapturedUsageServer;

  beforeAll(async () => {
    config = configForTest();
    initLogger(config);
    await initSupabase(config);
    client = await setupTestSupabase();
    usageServer = captureUsageServer(config);
  });

  beforeEach(async () => {
    await client.query('DELETE FROM fqc_llm_usage WHERE instance_id = $1', [TEST_INSTANCE_ID]);
  });

  afterAll(async () => {
    await client.query('DELETE FROM fqc_llm_usage WHERE instance_id = $1', [TEST_INSTANCE_ID]);
    await client.end();
  });

  it('T-I-020 shows graph purpose/model/trace records through get_llm_usage', async () => {
    const traceId = 'graph-node-analysis:usage-it-source';
    const llm = usageRecordingMockClient();

    const completion = await resolveGraphLlmCompletion({
      llmClient: llm,
      graphConfig: { enabled: true, classificationPurpose: 'graph-classifier' },
      messages: [{ role: 'user', content: 'mock graph analysis' }],
      traceId,
    });
    expect(completion.ok).toBe(true);
    await drainCostWrites(2_000);

    const recent = parseToolJson<{ entries: Array<Record<string, unknown>> }>(
      await usageServer.getLlmUsage({
        mode: 'recent',
        period: 'all',
        purpose_name: 'graph-classifier',
        model_name: 'graph-mock-model',
        trace_id: traceId,
      })
    );

    expect(recent.entries).toHaveLength(1);
    expect(recent.entries[0]).toMatchObject({
      purpose_name: 'graph-classifier',
      model_name: 'graph-mock-model',
      provider_name: 'mock-provider',
      trace_id: traceId,
    });
  });
});
