import { describe, expect, it } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/types.js';
import { getEmbeddingDimensions } from '../../src/embedding/dimensions.js';

function makeConfig(overrides: Partial<FlashQueryConfig>): FlashQueryConfig {
  return {
    instance: {
      name: 'test',
      id: 'test-instance',
      vault: { path: '/tmp/fq-test', markdownExtensions: ['.md'] },
    },
    server: { host: '127.0.0.1', port: 3100 },
    supabase: {
      url: 'http://127.0.0.1:54321',
      serviceRoleKey: 'test-service-role',
      databaseUrl: '',
      skipDdl: true,
    },
    git: { autoCommit: false, autoPush: false, remote: 'origin', branch: 'main' },
    mcp: { transport: 'stdio' },
    locking: { enabled: false },
    trashFolder: { enabled: false, path: '.trash', collisionStrategy: 'suffix' },
    mcpServers: {},
    host: { mcpServers: [], toolSearch: 'disabled' },
    macro: { defaultTimeoutMs: 30_000 },
    logging: { level: 'error', output: 'stdout' },
    ...overrides,
  };
}

describe('embedding dimension policy', () => {
  it('uses the LLM embedding purpose model dimensions before legacy embedding config', () => {
    const config = makeConfig({
      embedding: {
        provider: 'openai',
        model: 'legacy-embedding',
        dimensions: 1536,
      },
      llm: {
        providers: [
          {
            name: 'openai',
            type: 'openai-compatible',
            endpoint: 'https://api.openai.com',
            apiKey: 'sk-test',
          },
        ],
        models: [
          {
            name: 'embedding-small',
            providerName: 'openai',
            model: 'text-embedding-3-small',
            type: 'embedding',
            dimensions: 3072,
            costPerMillion: { input: 0, output: 0 },
          },
        ],
        purposes: [
          {
            name: 'embedding',
            description: 'Semantic search embeddings',
            models: ['embedding-small'],
            toolSearch: 'disabled',
          },
        ],
      },
    });

    expect(getEmbeddingDimensions(config)).toBe(3072);
  });

  it('falls back to legacy embedding dimensions when no LLM embedding purpose is configured', () => {
    const config = makeConfig({
      embedding: {
        provider: 'ollama',
        model: 'nomic-embed-text',
        dimensions: 768,
      },
    });

    expect(getEmbeddingDimensions(config)).toBe(768);
  });

  it('falls back to 1536 when neither LLM model nor legacy dimensions are configured', () => {
    const config = makeConfig({});

    expect(getEmbeddingDimensions(config)).toBe(1536);
  });
});
