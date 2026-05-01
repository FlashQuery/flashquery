/**
 * Phase 104 Wave 0 RED-state unit tests for src/embedding/provider.ts — purpose path.
 * Coverage: U-44, U-44b (purpose path constructs provider from purpose model config; D-06 dimensions),
 *           U-45, U-45b (purpose path with non-embedding model type or null resolution → WARN + NullEmbeddingProvider).
 * These tests exercise the new purpose-routing branch added by Plan 104-01.
 * EXPECTED RED STATE: tests fail before Wave 1 because initEmbedding(config) currently takes one parameter,
 * not (config, llmClient?), and contains no purpose-path branch.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  initEmbedding,
  NullEmbeddingProvider,
  OpenAICompatibleProvider,
  OllamaProvider,
} from '../../src/embedding/provider.js';
import * as providerModule from '../../src/embedding/provider.js';
import type { LlmClient } from '../../src/llm/client.js';

// Mock the logger module
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock LlmClient factory
// ─────────────────────────────────────────────────────────────────────────────

function makeMockLlmClient(returnValue: { modelName: string; providerName: string; config: unknown } | null): LlmClient {
  return {
    complete: vi.fn(),
    completeByPurpose: vi.fn(),
    getModelForPurpose: vi.fn(() => returnValue),
  } as unknown as LlmClient;
}

// ─────────────────────────────────────────────────────────────────────────────
// Config fixture
// ─────────────────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<{
  embeddingPurposeModelType: string;
  providerType: 'openai-compatible' | 'ollama';
  embeddingDimensions: number;
}> = {}): Parameters<typeof initEmbedding>[0] {
  return {
    embedding: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      apiKey: 'sk-legacy',
      dimensions: overrides.embeddingDimensions ?? 1536,
    },
    llm: {
      providers: [{
        name: 'openai',
        type: overrides.providerType ?? 'openai-compatible',
        endpoint: 'https://api.openai.com',
        apiKey: 'sk-test',
      }],
      models: [{
        name: 'embed-model',
        providerName: 'openai',
        model: 'text-embedding-3-small',
        type: overrides.embeddingPurposeModelType ?? 'embedding',
        costPerMillion: { input: 0, output: 0 },
      }],
      purposes: [{
        name: 'embedding',
        description: 'Embedding via purpose system',
        models: ['embed-model'],
      }],
    },
    instance: { id: 'test-instance', vault: { path: '/tmp/test-vault' } },
  } as unknown as Parameters<typeof initEmbedding>[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// U-44: purpose path constructs OpenAICompatibleProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('initEmbedding — purpose path (U-44)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('U-44: constructs OpenAICompatibleProvider from purpose model config when embedding purpose configured', () => {
    const config = makeConfig();
    const llmClient = makeMockLlmClient({ modelName: 'embed-model', providerName: 'openai', config: {} });
    initEmbedding(config, llmClient);
    expect(providerModule.embeddingProvider).toBeInstanceOf(OpenAICompatibleProvider);
    expect(providerModule.embeddingProvider).not.toBeInstanceOf(NullEmbeddingProvider);
    expect(llmClient.getModelForPurpose).toHaveBeenCalledWith('embedding');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U-44b: D-06 dimensions fallback on purpose-path error
// ─────────────────────────────────────────────────────────────────────────────

describe('initEmbedding — purpose path dimensions (U-44b / D-06)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('U-44b: NullEmbeddingProvider on purpose-path error uses config.embedding.dimensions per D-06', () => {
    const config = makeConfig({ embeddingPurposeModelType: 'language', embeddingDimensions: 768 });
    const llmClient = makeMockLlmClient({ modelName: 'embed-model', providerName: 'openai', config: {} });
    initEmbedding(config, llmClient);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(providerModule.embeddingProvider.getDimensions()).toBe(768);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U-45: type mismatch → WARN + NullEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('initEmbedding — purpose path type mismatch (U-45 / D-04, D-05)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('U-45: logs WARN and sets NullEmbeddingProvider when embedding purpose resolves to non-embedding model type', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const config = makeConfig({ embeddingPurposeModelType: 'language' });
    const llmClient = makeMockLlmClient({ modelName: 'embed-model', providerName: 'openai', config: {} });
    initEmbedding(config, llmClient);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('semantic search DISABLED'));
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("type='language'"));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// U-45b: null resolution → WARN + NullEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

describe('initEmbedding — purpose path null resolution (U-45b / D-05)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('U-45b: logs WARN and sets NullEmbeddingProvider when getModelForPurpose returns null (empty fallback chain)', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const config = makeConfig();
    const llmClient = makeMockLlmClient(null);
    initEmbedding(config, llmClient);
    expect(providerModule.embeddingProvider).toBeInstanceOf(NullEmbeddingProvider);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('no models in its fallback chain'));
  });
});
