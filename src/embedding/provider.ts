import type { FlashQueryConfig } from '../config/types.js';
import { logger } from '../logging/logger.js';
import type { LlmClient } from '../llm/client.js';
import { getLegacyEmbeddingDimensions } from './legacy-dimensions.js';

// ─────────────────────────────────────────────────────────────────────────────
// EmbeddingProvider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  getDimensions(): number;
  getProviderInfo?(): { provider: string; model: string };
}

export function assertEmbeddingVectorDimensions(input: {
  vector: number[];
  expectedDimensions: number;
  provider: string;
  model: string;
}): void {
  const actualDimensions = input.vector.length;
  if (actualDimensions === input.expectedDimensions) {
    return;
  }

  throw new Error(
    `Embedding error: ${input.provider} model "${input.model}" returned wrong vector width: ` +
    `expected ${input.expectedDimensions} dimensions, actual ${actualDimensions}. ` +
    `Change dimensions: to ${actualDimensions} for the model's native width, or wait for the deferred dimensions-reduction feature.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// OpenAICompatibleProvider (handles OpenAI and OpenRouter)
// ─────────────────────────────────────────────────────────────────────────────

export class OpenAICompatibleProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private apiKey: string;
  private dimensions: number;
  private providerName: string;

  constructor(
    baseUrl: string,
    model: string,
    apiKey: string,
    dimensions: number,
    providerName: string
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.dimensions = dimensions;
    this.providerName = providerName;
  }

  async embed(text: string): Promise<number[]> {
    const startTime = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
        }),
      });
    } catch {
      throw new Error(
        `Embedding error: Could not reach ${this.providerName} API. Check your internet connection.`
      );
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error(
          `Embedding error: ${this.providerName} API returned 401 Unauthorized. Check the API key in flashquery.yaml.`
        );
      }
      if (response.status === 429) {
        throw new Error(
          `Embedding error: ${this.providerName} rate limit exceeded. Wait and retry.`
        );
      }
      throw new Error(`Embedding error: ${this.providerName} API returned ${response.status}.`);
    }

    const data = (await response.json()) as { data: Array<{ embedding: number[] }> };
    const vector = data.data[0].embedding;
    assertEmbeddingVectorDimensions({
      vector,
      expectedDimensions: this.dimensions,
      provider: this.providerName,
      model: this.model,
    });
    const duration = Math.round(performance.now() - startTime);
    logger?.debug?.(`Embedding: generated vector (${duration}ms) — semantic search enabled`);
    return vector;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return { provider: this.providerName, model: this.model };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OllamaProvider
// ─────────────────────────────────────────────────────────────────────────────

export class OllamaProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;

  constructor(baseUrl: string, model: string, dimensions: number) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const startTime = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
    } catch {
      throw new Error(
        'Embedding error: Could not reach Ollama API. Check your internet connection.'
      );
    }

    if (!response.ok) {
      let detail: string;
      try {
        const data = (await response.json()) as { error?: unknown };
        detail = typeof data.error === 'string' ? `: ${data.error}` : '';
      } catch {
        detail = '';
      }
      throw new Error(`Embedding error: Ollama API returned ${response.status}${detail}.`);
    }

    const data = (await response.json()) as { embedding: number[] };
    assertEmbeddingVectorDimensions({
      vector: data.embedding,
      expectedDimensions: this.dimensions,
      provider: 'Ollama',
      model: this.model,
    });
    const duration = Math.round(performance.now() - startTime);
    logger?.debug?.(`Embedding: generated vector (${duration}ms) — semantic search enabled`);
    return data.embedding;
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return { provider: 'Ollama', model: this.model };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// NullEmbeddingProvider (disabled/unavailable embedding)
// ─────────────────────────────────────────────────────────────────────────────

export class NullEmbeddingProvider implements EmbeddingProvider {
  private dimensions: number;

  constructor(dimensions: number) {
    this.dimensions = dimensions;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async embed(_text: string): Promise<number[]> {
    throw new Error(
      'Semantic search unavailable (no API key configured). Use tag-based search instead.'
    );
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return { provider: 'none', model: 'none' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FallbackEmbeddingProvider
// ─────────────────────────────────────────────────────────────────────────────

export class FallbackEmbeddingProvider implements EmbeddingProvider {
  private providers: Array<{ name: string; provider: EmbeddingProvider }>;
  private dimensions: number;

  constructor(providers: Array<{ name: string; provider: EmbeddingProvider }>, dimensions: number) {
    this.providers = providers;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const failures: string[] = [];
    for (const { name, provider } of this.providers) {
      try {
        return await provider.embed(text);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        failures.push(`${name}: ${message}`);
        logger?.warn?.(`Embedding: ${name} failed, trying next fallback: ${message}`);
      }
    }
    throw new Error(`Embedding error: all providers failed (${failures.join('; ')})`);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return {
      provider: this.providers.map(({ name }) => name).join(' fallback chain'),
      model: 'fallback embedding chain',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createEmbeddingProvider factory
// ─────────────────────────────────────────────────────────────────────────────

function requireApiKey(
  config: NonNullable<FlashQueryConfig['embedding']>,
  provider: 'openai' | 'openrouter'
): string {
  if (!config.apiKey?.trim()) {
    throw new Error(`Embedding error: ${provider} provider requires apiKey in flashquery.yaml.`);
  }
  return config.apiKey;
}

function requireDimensions(config: NonNullable<FlashQueryConfig['embedding']>): number {
  if (config.dimensions === undefined) {
    throw new Error('Embedding error: dimensions are required for active legacy embedding providers.');
  }
  return config.dimensions;
}

export function createEmbeddingProvider(config: NonNullable<FlashQueryConfig['embedding']>): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://api.openai.com',
        config.model,
        requireApiKey(config, 'openai'),
        requireDimensions(config),
        'OpenAI'
      );
    case 'openrouter':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://openrouter.ai/api',
        config.model,
        requireApiKey(config, 'openrouter'),
        requireDimensions(config),
        'OpenRouter'
      );
    case 'ollama':
      return new OllamaProvider(
        config.endpoint ?? 'http://localhost:11434',
        config.model,
        requireDimensions(config)
      );
    default:
      throw new Error(
        `Embedding error: Unsupported provider '${config.provider}'. Use 'openai', 'openrouter', or 'ollama'.`
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Module singleton and init function
// ─────────────────────────────────────────────────────────────────────────────

export let embeddingProvider: EmbeddingProvider;

export function initEmbedding(config: FlashQueryConfig, llmClient?: LlmClient): void {
  const dimensions = getLegacyEmbeddingDimensions(config);

  // Purpose path (D-03, D-04, D-05, D-06): check config.llm.purposes FIRST.
  // Guard with `llmClient` truthiness BEFORE calling getModelForPurpose.
  // NullLlmClient.getModelForPurpose returns null (Phase 106 fix); the null-guard
  // at line ~202 handles that case cleanly.
  const hasEmbeddingPurpose = config.llm?.purposes?.some(p => p.name === 'embedding');
  if (hasEmbeddingPurpose && llmClient) {
    const selectedModel = llmClient.getModelForPurpose('embedding');
    if (!selectedModel) {
      logger.warn(
        "Embedding purpose 'embedding' has no models in its fallback chain — " +
        "semantic search DISABLED. Fix: add at least one model with type='embedding' to the embedding purpose."
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }

    const modelEntry = config.llm!.models.find(m => m.name === selectedModel.modelName) ?? selectedModel.config;
    if (modelEntry.type !== 'embedding') {
      logger.warn(
        `Embedding purpose 'embedding' resolved model '${selectedModel.modelName}' with ` +
        `type='${modelEntry.type}', not 'embedding' — semantic search DISABLED.`
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }

    const providerEntry = config.llm!.providers.find(p => p.name === selectedModel.providerName);
    if (!providerEntry) {
      logger.warn(
        `Embedding purpose model '${selectedModel.modelName}' references missing provider ` +
        `'${selectedModel.providerName}' — semantic search DISABLED.`
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }

    if (providerEntry.type === 'ollama') {
      embeddingProvider = new OllamaProvider(providerEntry.endpoint, modelEntry.model, dimensions);
    } else if (providerEntry.apiKey) {
      embeddingProvider = new OpenAICompatibleProvider(
        providerEntry.endpoint,
        modelEntry.model,
        providerEntry.apiKey,
        dimensions,
        providerEntry.name
      );
    } else {
      logger.warn(
        `Embedding purpose provider '${providerEntry.name}' has no API key — semantic search DISABLED.`
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }
    logger.info(
      `Embedding: routing through purpose 'embedding' → ` +
      `${providerEntry.name}/${modelEntry.model}`
    );
    return;
  }

  // Legacy path: only reached when no LLM embedding purpose is configured.
  if (!config.embedding) {
    embeddingProvider = new NullEmbeddingProvider(dimensions);
    logger.info('Embedding: DISABLED (no embedding configured)');
    return;
  }

  const { provider, model, apiKey } = config.embedding;

  if (provider === 'none') {
    embeddingProvider = new NullEmbeddingProvider(dimensions);
    logger.info('Embedding: DISABLED (provider=none)');
    return;
  }

  if ((provider === 'openai' || provider === 'openrouter') && !apiKey) {
    const providerName = provider === 'openai' ? 'OpenAI' : 'OpenRouter';
    logger.warn(
      `Embedding configured but API key missing — semantic search DISABLED (provider=${providerName})`
    );
    embeddingProvider = new NullEmbeddingProvider(dimensions);
    return;
  }

  embeddingProvider = createEmbeddingProvider(config.embedding);
  logger.info(`Embedding: provider=${provider} model=${model}`);
}
