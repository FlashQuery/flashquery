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
  getLastEmbeddingMetadata?(): EmbeddingCallMetadata;
}

export interface EmbeddingCallMetadata {
  truncated: boolean;
  warnings: string[];
}

export interface EmbeddingCatalogEndpoint {
  provider_name?: string;
  providerName?: string;
  model: string;
  max_input_chars?: number;
  maxInputChars?: number;
  rate_limit?: { min_delay_ms?: number };
}

export const DEFAULT_MAX_INPUT_CHARS = 24_000;

export function truncateEmbeddingInput(
  text: string,
  maxInputChars = DEFAULT_MAX_INPUT_CHARS
): { text: string; truncated: boolean } {
  if (text.length <= maxInputChars) {
    return { text, truncated: false };
  }

  const bounded = text.slice(0, maxInputChars);
  const paragraphBoundary = bounded.lastIndexOf('\n\n');
  if (paragraphBoundary > 0) {
    return { text: bounded.slice(0, paragraphBoundary).trimEnd(), truncated: true };
  }

  const sentenceBoundary = Math.max(
    bounded.lastIndexOf('. '),
    bounded.lastIndexOf('! '),
    bounded.lastIndexOf('? ')
  );
  if (sentenceBoundary > 0) {
    return { text: bounded.slice(0, sentenceBoundary + 1).trimEnd(), truncated: true };
  }

  return { text: bounded.trimEnd(), truncated: true };
}

function isProviderOverLimitError(status: number, body: string): boolean {
  if (status === 413) return true;
  return /input length exceeds|context length|maximum context|too many tokens|token limit|too long/i.test(body);
}

export interface EmbeddingCatalogProviderEntry {
  name: string;
  dimensions: number;
  endpoints: EmbeddingCatalogEndpoint[];
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
  private maxInputChars: number;
  private lastMetadata: EmbeddingCallMetadata = { truncated: false, warnings: [] };

  constructor(
    baseUrl: string,
    model: string,
    apiKey: string,
    dimensions: number,
    providerName: string,
    maxInputChars = DEFAULT_MAX_INPUT_CHARS
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.apiKey = apiKey;
    this.dimensions = dimensions;
    this.providerName = providerName;
    this.maxInputChars = maxInputChars;
  }

  async embed(text: string): Promise<number[]> {
    const startTime = performance.now();
    const initial = truncateEmbeddingInput(text, this.maxInputChars);
    this.lastMetadata = {
      truncated: initial.truncated,
      warnings: initial.truncated ? ['truncated_inputs'] : [],
    };
    let response = await this.postEmbedding(initial.text);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (isProviderOverLimitError(response.status, body)) {
        const retry = truncateEmbeddingInput(text, Math.floor(this.maxInputChars * 0.75));
        this.lastMetadata = {
          truncated: true,
          warnings: ['truncated_inputs'],
        };
        response = await this.postEmbedding(retry.text);
        if (!response.ok) {
          const retryBody = await response.text().catch(() => '');
          throw this.errorForResponse(response.status, retryBody);
        }
      } else {
        throw this.errorForResponse(response.status, body);
      }
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

  private async postEmbedding(input: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input,
        }),
      });
    } catch {
      throw new Error(
        `Embedding error: Could not reach ${this.providerName} API. Check your internet connection.`
      );
    }
  }

  private errorForResponse(status: number, body: string): Error {
    if (status === 401) {
      return new Error(
        `Embedding error: ${this.providerName} API returned 401 Unauthorized. Check the API key in flashquery.yaml.`
      );
    }
    if (status === 429) {
      return new Error(
        `Embedding error: ${this.providerName} rate limit exceeded. Wait and retry.`
      );
    }
    const detail = body.trim() ? `: ${body.trim()}` : '';
    return new Error(`Embedding error: ${this.providerName} API returned ${status}${detail}.`);
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return { provider: this.providerName, model: this.model };
  }

  getLastEmbeddingMetadata(): EmbeddingCallMetadata {
    return this.lastMetadata;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OllamaProvider
// ─────────────────────────────────────────────────────────────────────────────

export class OllamaProvider implements EmbeddingProvider {
  private baseUrl: string;
  private model: string;
  private dimensions: number;
  private maxInputChars: number;
  private lastMetadata: EmbeddingCallMetadata = { truncated: false, warnings: [] };

  constructor(baseUrl: string, model: string, dimensions: number, maxInputChars = DEFAULT_MAX_INPUT_CHARS) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.model = model;
    this.dimensions = dimensions;
    this.maxInputChars = maxInputChars;
  }

  async embed(text: string): Promise<number[]> {
    const startTime = performance.now();
    const initial = truncateEmbeddingInput(text, this.maxInputChars);
    this.lastMetadata = {
      truncated: initial.truncated,
      warnings: initial.truncated ? ['truncated_inputs'] : [],
    };
    let response = await this.postEmbedding(initial.text);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (isProviderOverLimitError(response.status, body)) {
        const retry = truncateEmbeddingInput(text, Math.floor(this.maxInputChars * 0.75));
        this.lastMetadata = {
          truncated: true,
          warnings: ['truncated_inputs'],
        };
        response = await this.postEmbedding(retry.text);
        if (!response.ok) {
          const retryBody = await response.text().catch(() => '');
          throw new Error(`Embedding error: Ollama API returned ${response.status}${retryBody.trim() ? `: ${retryBody.trim()}` : ''}.`);
        }
      } else {
        throw new Error(`Embedding error: Ollama API returned ${response.status}${body.trim() ? `: ${body.trim()}` : ''}.`);
      }
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

  private async postEmbedding(prompt: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ model: this.model, prompt }),
      });
    } catch {
      throw new Error(
        'Embedding error: Could not reach Ollama API. Check your internet connection.'
      );
    }
  }

  getDimensions(): number {
    return this.dimensions;
  }

  getProviderInfo(): { provider: string; model: string } {
    return { provider: 'Ollama', model: this.model };
  }

  getLastEmbeddingMetadata(): EmbeddingCallMetadata {
    return this.lastMetadata;
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
  private lastProviderInfo?: { provider: string; model: string };
  private lastMetadata: EmbeddingCallMetadata = { truncated: false, warnings: [] };

  constructor(providers: Array<{ name: string; provider: EmbeddingProvider }>, dimensions: number) {
    this.providers = providers;
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const failures: string[] = [];
    for (const { name, provider } of this.providers) {
      try {
        const vector = await provider.embed(text);
        this.lastProviderInfo = provider.getProviderInfo?.() ?? { provider: name, model: 'unknown' };
        this.lastMetadata = provider.getLastEmbeddingMetadata?.() ?? { truncated: false, warnings: [] };
        return vector;
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
    if (this.lastProviderInfo) {
      return this.lastProviderInfo;
    }
    return {
      provider: this.providers.map(({ name }) => name).join(' fallback chain'),
      model: 'fallback embedding chain',
    };
  }

  getLastEmbeddingMetadata(): EmbeddingCallMetadata {
    return this.lastMetadata;
  }
}

export function createEmbeddingProviderForCatalogEntry(
  config: FlashQueryConfig,
  entry: EmbeddingCatalogProviderEntry
): EmbeddingProvider {
  const providers = entry.endpoints.map((endpoint) => {
    const providerName = endpoint.provider_name ?? endpoint.providerName;
    if (!providerName) {
      return {
        name: 'unknown',
        provider: new NullEmbeddingProvider(entry.dimensions),
      };
    }

    const providerConfig = config.llm?.providers.find((provider) => provider.name === providerName);
    if (!providerConfig) {
      return {
        name: providerName,
        provider: new NullEmbeddingProvider(entry.dimensions),
      };
    }

    if (providerConfig.type === 'ollama') {
      return {
        name: providerName,
        provider: new OllamaProvider(
          providerConfig.endpoint,
          endpoint.model,
          entry.dimensions,
          endpoint.max_input_chars ?? endpoint.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS
        ),
      };
    }

    if (!providerConfig.apiKey?.trim()) {
      return {
        name: providerName,
        provider: new NullEmbeddingProvider(entry.dimensions),
      };
    }

    return {
      name: providerName,
      provider: new OpenAICompatibleProvider(
        providerConfig.endpoint,
        endpoint.model,
        providerConfig.apiKey,
        entry.dimensions,
        providerName,
        endpoint.max_input_chars ?? endpoint.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS
      ),
    };
  });

  if (providers.length === 0) {
    return new NullEmbeddingProvider(entry.dimensions);
  }
  if (providers.length === 1) {
    return providers[0]!.provider;
  }
  return new FallbackEmbeddingProvider(providers, entry.dimensions);
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
