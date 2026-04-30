import type { FlashQueryConfig } from '../config/loader.js';
import { logger } from '../logging/logger.js';
import type { LlmClient } from '../llm/client.js';

// ─────────────────────────────────────────────────────────────────────────────
// EmbeddingProvider interface
// ─────────────────────────────────────────────────────────────────────────────

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
  getDimensions(): number;
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
        body: JSON.stringify({ model: this.model, input: text }),
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
    const duration = Math.round(performance.now() - startTime);
    logger.debug(`Embedding: generated vector (${duration}ms) — semantic search enabled`);
    return data.data[0].embedding;
  }

  getDimensions(): number {
    return this.dimensions;
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
      throw new Error(`Embedding error: Ollama API returned ${response.status}.`);
    }

    const data = (await response.json()) as { embedding: number[] };
    const duration = Math.round(performance.now() - startTime);
    logger.debug(`Embedding: generated vector (${duration}ms) — semantic search enabled`);
    return data.embedding;
  }

  getDimensions(): number {
    return this.dimensions;
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
}

// ─────────────────────────────────────────────────────────────────────────────
// createEmbeddingProvider factory
// ─────────────────────────────────────────────────────────────────────────────

export function createEmbeddingProvider(config: FlashQueryConfig['embedding']): EmbeddingProvider {
  switch (config.provider) {
    case 'openai':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://api.openai.com',
        config.model,
        config.apiKey!,
        config.dimensions,
        'OpenAI'
      );
    case 'openrouter':
      return new OpenAICompatibleProvider(
        config.endpoint ?? 'https://openrouter.ai/api',
        config.model,
        config.apiKey!,
        config.dimensions,
        'OpenRouter'
      );
    case 'ollama':
      return new OllamaProvider(
        config.endpoint ?? 'http://localhost:11434',
        config.model,
        config.dimensions
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
  const dimensions = config.embedding.dimensions;

  // Purpose path (D-03, D-04, D-05, D-06): check config.llm.purposes FIRST.
  // Guard with `llmClient` truthiness BEFORE calling getModelForPurpose.
  // NullLlmClient.getModelForPurpose returns null (Phase 106 fix); the null-guard
  // at line ~202 handles that case cleanly.
  const hasEmbeddingPurpose = config.llm?.purposes?.some(p => p.name === 'embedding');
  if (hasEmbeddingPurpose && llmClient) {
    const result = llmClient.getModelForPurpose('embedding');
    if (!result) {
      logger.warn(
        "Embedding purpose 'embedding' has no models in its fallback chain — " +
        "semantic search DISABLED. Fix: add at least one model with type='embedding' to the embedding purpose."
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }
    const modelEntry = config.llm!.models.find(m => m.name === result.modelName);
    if (!modelEntry || modelEntry.type !== 'embedding') {
      logger.warn(
        `Embedding purpose 'embedding' resolves to model '${result.modelName}' which has ` +
        `type='${modelEntry?.type ?? 'unknown'}', not 'embedding' — semantic search DISABLED. ` +
        `Fix: assign a model with type='embedding' to the embedding purpose.`
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }
    const providerEntry = config.llm!.providers.find(p => p.name === result.providerName);
    if (!providerEntry) {
      logger.warn(
        `Embedding purpose provider '${result.providerName}' not found — semantic search DISABLED.`
      );
      embeddingProvider = new NullEmbeddingProvider(dimensions);
      return;
    }
    if (providerEntry.type === 'ollama') {
      embeddingProvider = new OllamaProvider(providerEntry.endpoint, modelEntry.model, dimensions);
    } else {
      embeddingProvider = new OpenAICompatibleProvider(
        providerEntry.endpoint,
        modelEntry.model,
        providerEntry.apiKey ?? '',
        dimensions,
        providerEntry.name
      );
    }
    logger.info(`Embedding: routing through purpose 'embedding' → ${providerEntry.name}/${modelEntry.model}`);
    return;
  }

  // Legacy path (unchanged from current implementation): D-05A, D-05B, then createEmbeddingProvider
  const { provider, model, apiKey } = config.embedding;

  // D-05A: Explicit provider="none" — user intentionally disabled embedding
  if (provider === 'none') {
    embeddingProvider = new NullEmbeddingProvider(dimensions);
    logger.info('Embedding: DISABLED (provider=none)');
    return;
  }

  // D-05B: Provider set but API key missing — warn and degrade gracefully
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
