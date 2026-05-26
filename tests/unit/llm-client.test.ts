import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAICompatibleLlmClient,
  NullLlmClient,
  initLlm,
  mergeParameters,
  LlmHttpError,
  LlmNetworkError,
  type ChatMessage,
  type LlmCompletionResult,
  type LlmClient,
} from '../../src/llm/client.js';
import { LlmFallbackError, PurposeResolver } from '../../src/llm/resolver.js';
import * as clientModule from '../../src/llm/client.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';
import { AGENT_LOOP_STOP_REASONS, FINISH_REASONS, LLM_PARTICIPANT_NAMES } from '../../src/constants/llm.js';
import type { CallModelMetadata, LlmChatMessage } from '../../src/llm/types.js';
import * as costTracker from '../../src/llm/cost-tracker.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../src/llm/config-sync.js', () => ({
  syncLlmConfigToDb: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/llm/purpose-template-bindings.js', () => ({
  validatePersistedPurposeTemplateAdmissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/llm/cost-tracker.js', () => ({
  computeCost: vi.fn(() => 0.0001),
  recordLlmUsage: vi.fn(),
}));

// ─────────────────────────────────────────────────────────────────────────────
// node:http / node:https mock infrastructure
//
// Provides a __setNextResponse({ status?, body?, networkError? }) helper so
// individual tests can control what the HTTP layer returns without touching
// the network.
// ─────────────────────────────────────────────────────────────────────────────

interface MockResponseSpec {
  status?: number;
  body?: unknown;
  networkError?: Error;
  headers?: Record<string, string>;  // ADD — for Retry-After tests (D-04)
}

let _nextResponse: MockResponseSpec = { status: 200, body: {} };

function __setNextResponse(spec: MockResponseSpec): void {
  _nextResponse = spec;
}

function _makeRequester() {
  return {
    request(
      _opts: unknown,
      cb: (res: {
        statusCode: number;
        statusMessage: string;
        headers: Record<string, string>;
        on: (event: string, handler: (chunk?: Buffer | Error) => void) => void;
      }) => void
    ): {
      on: (event: string, handler: (err?: Error) => void) => void;
      write: (body: string | Buffer) => void;
      end: () => void;
    } {
      const spec = _nextResponse;
      const reqObj = {
        on(_event: string, _handler: (err?: Error) => void) {
          // If networkError, fire error on 'error' event
          if (_event === 'error' && spec.networkError) {
            setTimeout(() => _handler(spec.networkError), 0);
          }
        },
        write(_body: string | Buffer) { /* no-op */ },
        end() {
          if (spec.networkError) return; // error fired via req.on('error')
          const bodyStr = JSON.stringify(spec.body ?? {});
          const chunks: Buffer[] = [Buffer.from(bodyStr, 'utf-8')];
          const status = spec.status ?? 200;
          const res = {
            statusCode: status,
            statusMessage: status === 200 ? 'OK' : String(status),
            headers: spec.headers ?? {} as Record<string, string>,
            on(event: string, handler: (chunk?: Buffer | Error) => void) {
              if (event === 'data') {
                for (const chunk of chunks) {
                  handler(chunk);
                }
              } else if (event === 'end') {
                setTimeout(() => handler(), 0);
              } else if (event === 'error') {
                // no-op for success path
              }
            },
          };
          cb(res);
        },
      };
      return reqObj;
    },
  };
}

vi.mock('node:http', () => _makeRequester());
vi.mock('node:https', () => _makeRequester());

// ─────────────────────────────────────────────────────────────────────────────
// Test fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TEST_LLM_CONFIG = {
  providers: [
    { name: 'openai', type: 'openai-compatible' as const, endpoint: 'https://api.openai.com', apiKey: 'sk-test-key' },
    { name: 'ollama-local', type: 'ollama' as const, endpoint: 'http://localhost:11434' }, // no apiKey
  ],
  models: [
    { name: 'gpt-4o', providerName: 'openai', model: 'gpt-4o', type: 'language' as const, costPerMillion: { input: 2.5, output: 10 } },
    { name: 'fast', providerName: 'openai', model: 'gpt-4o-mini', type: 'language' as const, costPerMillion: { input: 0.15, output: 0.6 } },
    { name: 'llama', providerName: 'ollama-local', model: 'llama3', type: 'language' as const, costPerMillion: { input: 0, output: 0 } },
  ],
  purposes: [
    { name: 'default', description: 'General', models: ['gpt-4o'] },
  ],
};

const SAMPLE_MESSAGES: ChatMessage[] = [
  { role: 'system', content: 'You are a helpful assistant.' },
  { role: 'user', content: 'Hello, world!' },
];

function makeOpenAISuccessBody(options?: { modelName?: string; text?: string; promptTokens?: number; completionTokens?: number }) {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    model: options?.modelName ?? 'gpt-4o',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: options?.text ?? 'Hello!' },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: options?.promptTokens ?? 10,
      completion_tokens: options?.completionTokens ?? 20,
      total_tokens: (options?.promptTokens ?? 10) + (options?.completionTokens ?? 20),
    },
  };
}

function makeOpenAIToolCallBody(options?: {
  finishReason?: string;
  content?: string | null;
  args?: unknown;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}) {
  return {
    id: 'chatcmpl-tool-test',
    object: 'chat.completion',
    model: 'gpt-4o',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: options?.content ?? null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_documents',
                arguments: options?.args ?? '{"query":"alpha"}',
              },
            },
          ],
        },
        finish_reason: options?.finishReason ?? 'tool_calls',
      },
    ],
    ...(options?.usage === null
      ? {}
      : {
          usage: {
            prompt_tokens: options?.usage?.prompt_tokens ?? 10,
            completion_tokens: options?.usage?.completion_tokens ?? 20,
          },
        }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// mergeParameters (U-19, U-20)
// ─────────────────────────────────────────────────────────────────────────────

describe('mergeParameters', () => {
  it('U-19: caller wins — mergeParameters({temperature: 0.5}, {temperature: 0.1, max_tokens: 100}) returns {temperature: 0.5, max_tokens: 100}', () => {
    const result = mergeParameters({ temperature: 0.5 }, { temperature: 0.1, max_tokens: 100 });
    expect(result).toEqual({ temperature: 0.5, max_tokens: 100 });
  });

  it('U-20: defaults pass through — mergeParameters({}, {temperature: 0.1}) returns {temperature: 0.1}', () => {
    const result = mergeParameters({}, { temperature: 0.1 });
    expect(result).toEqual({ temperature: 0.1 });
  });
});

describe('Phase 112 canonical LLM contracts', () => {
  it('FINISH_REASONS exposes the supported finish reason constants', () => {
    expect(FINISH_REASONS).toEqual(['stop', 'tool_calls', 'length', 'content_filter', 'unknown']);
  });

  it('LLM_PARTICIPANT_NAMES exposes centralized participant attribution constants', () => {
    expect(LLM_PARTICIPANT_NAMES).toEqual({ host: 'host' });
  });

  it('AGENT_LOOP_STOP_REASONS exposes the canonical Mode 2 stop reasons', () => {
    expect(AGENT_LOOP_STOP_REASONS).toEqual([
      'final_response',
      'max_iterations',
      'timeout',
      'max_cost',
      'max_tokens',
      'shutdown',
      'error',
    ]);
  });

  it('CallModelMetadata.tools supports the public Mode 2 metadata shape and remains optional', () => {
    const mode1Metadata: CallModelMetadata = {
      resolver: 'purpose',
      name: 'research',
      resolved_model_name: 'fast',
      provider_name: 'openai',
      fallback_position: 1,
      tokens: { input: 0, output: 0 },
      cost_usd: 0,
      latency_ms: 0,
    };
    const mode2Metadata: CallModelMetadata = {
      ...mode1Metadata,
      tools: {
        native_tool_names: ['get_document'],
        diagnostics: { expanded_tiers: [] },
        stop_reason: 'final_response',
        iterations: 1,
        calls_log: [
          {
            iteration: 1,
            model_name: 'fast',
            provider_name: 'openai',
            fallback_position: 1,
            finish_reason: 'stop',
            tokens: { input: 11, output: 7 },
            cost_usd: 0.000025,
            latency_ms: 31,
            assistant: { content: 'done' },
            tool_calls: [],
          },
        ],
        aggregate_usage: {
          tokens: { input: 11, output: 7 },
          cost_usd: 0.000025,
          latency_ms: 31,
        },
      },
    };

    expect(mode1Metadata.tools).toBeUndefined();
    expect(mode2Metadata.tools?.calls_log[0].tokens).toEqual({ input: 11, output: 7 });
  });

  it('host participant attribution is not hard-coded outside the constants module', () => {
    const files = [
      ...listTypeScriptFiles('src/llm'),
      'src/mcp/tools/llm.ts',
    ];
    const hostLiteralRe = /['"](host|flashquery\.host)['"]/g;

    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      expect(text.match(hostLiteralRe) ?? [], file).toEqual([]);
    }
  });

  it('LlmChatMessage supports nullable assistant content with normalized tool calls', () => {
    const assistantMessage: LlmChatMessage = {
      role: 'assistant',
      content: null,
      name: 'general',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'search_documents', arguments: { query: 'alpha' } },
        },
      ],
    };
    const toolMessage: LlmChatMessage = {
      role: 'tool',
      content: '{"ok":true}',
      tool_call_id: 'call_1',
    };

    expect(assistantMessage.tool_calls?.[0].function.arguments).toEqual({ query: 'alpha' });
    expect(toolMessage.name).toBeUndefined();
    expect(toolMessage.tool_call_id).toBe('call_1');
  });
});

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) return listTypeScriptFiles(fullPath);
    return fullPath.endsWith('.ts') ? [fullPath] : [];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// LlmHttpError and LlmNetworkError class identity (U-29..U-33)
// RED tests — Plan 100-01 will implement these classes
// ─────────────────────────────────────────────────────────────────────────────

describe('LlmHttpError', () => {
  it('U-29: LlmHttpError(msg, 429) sets name="LlmHttpError", status=429, retryAfterMs=undefined, and is instanceof Error', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmHttpError('LLM error: openai rate limit exceeded.', 429);
    expect(err).toBeInstanceOf(LlmHttpError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LlmHttpError');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.message).toBe('LLM error: openai rate limit exceeded.');
  });

  it('U-30: LlmHttpError(msg, 429, 5000) carries retryAfterMs=5000', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmHttpError('msg', 429, 5000);
    expect(err.retryAfterMs).toBe(5000);
  });

  it('U-31: LlmHttpError(msg, 401) carries status=401 (arbitrary status code)', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmHttpError('msg', 401);
    expect(err.status).toBe(401);
  });
});

describe('LlmNetworkError', () => {
  it('U-32: LlmNetworkError(msg) sets name="LlmNetworkError" and is instanceof Error', () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmNetworkError('timeout');
    expect(err).toBeInstanceOf(LlmNetworkError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('LlmNetworkError');
    expect(err.message).toBe('timeout');
  });

  it('U-33: LlmNetworkError(msg, { cause }) preserves the cause field', () => {
    const underlying = new Error('ECONNREFUSED');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    const err = new LlmNetworkError('reach failed', { cause: underlying });
    expect(err.cause).toBeInstanceOf(Error);
    expect((err.cause as Error).message).toBe('ECONNREFUSED');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// NullLlmClient
// ─────────────────────────────────────────────────────────────────────────────

describe('NullLlmClient', () => {
  it('NullLlmClient.complete() throws "No LLM configuration found. Add an llm: section to flashquery.yml to use this tool."', async () => {
    const client = new NullLlmClient();
    await expect(
      client.complete('gpt-4o', SAMPLE_MESSAGES)
    ).rejects.toThrow('No LLM configuration found. Add an llm: section to flashquery.yml to use this tool.');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// OpenAICompatibleLlmClient.complete (U-15..U-18, U-23..U-28 + model-not-found)
// ─────────────────────────────────────────────────────────────────────────────

describe('OpenAICompatibleLlmClient.complete', () => {
  let client: OpenAICompatibleLlmClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenAICompatibleLlmClient(TEST_LLM_CONFIG);
    // Default to a successful response
    __setNextResponse({ status: 200, body: makeOpenAISuccessBody() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('U-15: complete() returns LlmCompletionResult with text/modelName/providerName/inputTokens/outputTokens/latencyMs populated when provider returns a valid OpenAI-shaped response', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAISuccessBody({ text: 'Hello!', promptTokens: 15, completionTokens: 25 }),
    });

    const result = await client.complete('gpt-4o', SAMPLE_MESSAGES);

    expect(result.text).toBe('Hello!');
    expect(result.modelName).toBe('gpt-4o');
    expect(result.providerName).toBe('openai');
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(25);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('U-16: complete() passes the messages array through to the request body without transformation', async () => {
    // Capture the request body via a custom mock
    let capturedBody: unknown;
    const httpMock = {
      request(
        _opts: unknown,
        cb: (res: {
          statusCode: number;
          statusMessage: string;
          headers: Record<string, string>;
          on: (event: string, handler: (chunk?: Buffer) => void) => void;
        }) => void
      ) {
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(body: string) {
            capturedBody = JSON.parse(body) as unknown;
          },
          end() {
            const bodyStr = JSON.stringify(makeOpenAISuccessBody());
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: 200,
              statusMessage: 'OK',
              headers: _nextResponse.headers ?? {} as Record<string, string>,
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') {
                  for (const chunk of chunks) handler(chunk);
                } else if (event === 'end') {
                  setTimeout(() => handler(), 0);
                }
              },
            };
            cb(res);
          },
        };
      },
    };

    // Override the https mock for this test
    const httpsMod = await import('node:https');
    const originalRequest = (httpsMod as typeof httpsMod & { request: typeof httpsMod.request }).request;
    // Use vi.spyOn approach — monkeypatch the module for this single test
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (opts: unknown, cb: unknown) => httpMock.request(opts as never, cb as never) as ReturnType<typeof httpsMod.request>
    );

    const testMessages: ChatMessage[] = [
      { role: 'system', content: 'System message here' },
      { role: 'user', content: 'User message here' },
      { role: 'assistant', content: 'Prior assistant response' },
    ];

    await client.complete('gpt-4o', testMessages);

    // Assert messages passed through without transformation
    const body = capturedBody as { messages?: ChatMessage[] };
    expect(body.messages).toHaveLength(3);
    expect(body.messages?.[0]).toEqual({ role: 'system', content: 'System message here' });
    expect(body.messages?.[1]).toEqual({ role: 'user', content: 'User message here' });
    expect(body.messages?.[2]).toEqual({ role: 'assistant', content: 'Prior assistant response' });
  });

  it('U-17: complete() aborts with a timeout error when the provider does not respond within the timeout window', async () => {
    vi.useFakeTimers();

    // Set up a response that never resolves (simulates hanging server)
    const httpsMod = await import('node:https');
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      () => {
        // Return a req object that never calls the callback, simulating timeout
        return {
          on(_event: string, _handler: (err?: Error) => void) {
            // The abort signal will fire 'error' when abort is called
          },
          write(_body: string) {},
          end() {
            // Never resolve — simulates no response from server
          },
          destroy(err?: Error) {
            // Called when AbortController aborts the request
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    const completePromise = client.complete('gpt-4o', SAMPLE_MESSAGES);

    // Register the rejection handler BEFORE advancing timers so the rejection is
    // never seen as unhandled (fake timer fires synchronously before microtasks run).
    const assertion = expect(completePromise).rejects.toThrow(/timeout|timed out|abort/i);

    // Advance fake timers past the timeout window (default: 30 seconds)
    await vi.advanceTimersByTimeAsync(31000);

    await assertion;
  });

  it('U-18: complete() routes through nodeFetch (node:http/node:https), not globalThis.fetch', async () => {
    __setNextResponse({ status: 200, body: makeOpenAISuccessBody() });

    // Track if globalThis.fetch is called
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn().mockImplementation(originalFetch);
    globalThis.fetch = fetchSpy;

    try {
      await client.complete('gpt-4o', SAMPLE_MESSAGES);
    } finally {
      globalThis.fetch = originalFetch;
    }

    // globalThis.fetch must NOT be called
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('U-23: complete() maps response.usage.prompt_tokens → result.inputTokens AND response.usage.completion_tokens → result.outputTokens', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAISuccessBody({ promptTokens: 42, completionTokens: 87 }),
    });

    const result = await client.complete('gpt-4o', SAMPLE_MESSAGES);

    expect(result.inputTokens).toBe(42);
    expect(result.outputTokens).toBe(87);
  });

  it('U-24: complete() omits Authorization header when provider has no apiKey (Ollama case) and includes "Authorization: Bearer <key>" when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};

    const httpMod = await import('node:http');
    vi.spyOn(httpMod as typeof httpMod & { request: unknown }, 'request').mockImplementation(
      (opts: unknown, cb: unknown) => {
        capturedHeaders = (opts as { headers?: Record<string, string> }).headers ?? {};
        const bodyStr = JSON.stringify(makeOpenAISuccessBody({ modelName: 'llama3' }));
        const chunks = [Buffer.from(bodyStr, 'utf-8')];
        const res = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: _nextResponse.headers ?? {} as Record<string, string>,
          on(event: string, handler: (chunk?: Buffer) => void) {
            if (event === 'data') for (const chunk of chunks) handler(chunk);
            else if (event === 'end') setTimeout(() => handler(), 0);
          },
        };
        (cb as (res: typeof res) => void)(res);
        return {
          on(_e: string, _h: (err?: Error) => void) {},
          write(_b: string) {},
          end() {},
        } as unknown as ReturnType<typeof httpMod.request>;
      }
    );

    // Ollama model — no apiKey
    await client.complete('llama', SAMPLE_MESSAGES);
    expect(capturedHeaders['Authorization']).toBeUndefined();

    // OpenAI model — has apiKey — use https spy
    const httpsMod = await import('node:https');
    let capturedHttpsHeaders: Record<string, string> = {};
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (opts: unknown, cb: unknown) => {
        capturedHttpsHeaders = (opts as { headers?: Record<string, string> }).headers ?? {};
        const bodyStr = JSON.stringify(makeOpenAISuccessBody());
        const chunks = [Buffer.from(bodyStr, 'utf-8')];
        const res = {
          statusCode: 200,
          statusMessage: 'OK',
          headers: _nextResponse.headers ?? {} as Record<string, string>,
          on(event: string, handler: (chunk?: Buffer) => void) {
            if (event === 'data') for (const chunk of chunks) handler(chunk);
            else if (event === 'end') setTimeout(() => handler(), 0);
          },
        };
        (cb as (res: typeof res) => void)(res);
        return {
          on(_e: string, _h: (err?: Error) => void) {},
          write(_b: string) {},
          end() {},
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    await client.complete('gpt-4o', SAMPLE_MESSAGES);
    expect(capturedHttpsHeaders['Authorization']).toBe('Bearer sk-test-key');
  });

  it('U-25: complete("FAST", messages) lowercases the model name to "fast" before lookup; result.modelName is "fast"', async () => {
    let capturedBody: { model?: string } = {};
    const httpsMod = await import('node:https');
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (opts: unknown, cb: unknown) => {
        return {
          on(_e: string, _h: (err?: Error) => void) {},
          write(body: string) { capturedBody = JSON.parse(body) as { model?: string }; },
          end() {
            const bodyStr = JSON.stringify(makeOpenAISuccessBody());
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: 200,
              statusMessage: 'OK',
              headers: _nextResponse.headers ?? {} as Record<string, string>,
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') for (const chunk of chunks) handler(chunk);
                else if (event === 'end') setTimeout(() => handler(), 0);
              },
            };
            (cb as (res: typeof res) => void)(res);
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    const result = await client.complete('FAST', SAMPLE_MESSAGES);

    // The model alias 'fast' should map to model.model = 'gpt-4o-mini' in the API call
    expect(capturedBody.model).toBe('gpt-4o-mini');
    // result.modelName should be the lowercased alias, not the underlying model ID
    expect(result.modelName).toBe('fast');
  });

  it('U-26: complete() with a 401 response throws Error matching /LLM error: openai API returned 401 Unauthorized/', async () => {
    __setNextResponse({ status: 401, body: { error: { message: 'Unauthorized' } } });

    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow(
      /LLM error: openai API returned 401 Unauthorized/
    );
  });

  it('U-27: complete() with a 429 response throws Error matching /LLM error: openai rate limit exceeded/', async () => {
    __setNextResponse({ status: 429, body: { error: { message: 'Rate limit exceeded' } } });

    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow(
      /LLM error: openai rate limit exceeded/
    );
  });

  it('U-28: complete() with a network failure (fetch rejects) throws Error matching /LLM error: Could not reach openai API/', async () => {
    __setNextResponse({ networkError: new Error('ECONNREFUSED') });

    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow(
      /LLM error: Could not reach openai API/
    );
  });

  it('U-34: complete() throws LlmHttpError with status=401 on a 401 response (D-02)', async () => {
    __setNextResponse({ status: 401, body: { error: 'unauthorized' } });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toBeInstanceOf(LlmHttpError);
    __setNextResponse({ status: 401, body: { error: 'unauthorized' } });
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toMatchObject({ status: 401 });
  });

  it('U-35: complete() throws LlmHttpError with status=429 and retryAfterMs=7000 when provider sends Retry-After: 7 header (D-04)', async () => {
    __setNextResponse({ status: 429, headers: { 'Retry-After': '7' }, body: { error: 'rate limit' } });
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toMatchObject({
      status: 429,
      retryAfterMs: 7000,
    });
  });

  it('U-36: complete() throws LlmHttpError with the actual status (e.g., 500) on generic 5xx', async () => {
    __setNextResponse({ status: 500, body: 'server error' });
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toMatchObject({ status: 500 });
  });

  it('U-37: complete() throws LlmNetworkError (not plain Error) when timeout fires via AbortError (D-02)', async () => {
    vi.useFakeTimers();

    // Set up a response that never resolves (simulates hanging server)
    const httpsMod = await import('node:https');
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      () => {
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(_body: string) {},
          end() {
            // Never resolve — simulates no response from server
          },
          destroy(_err?: Error) {},
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    const completePromise = client.complete('gpt-4o', SAMPLE_MESSAGES);

    // Register rejection handler BEFORE advancing timers
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    const assertion = expect(completePromise).rejects.toBeInstanceOf(LlmNetworkError);

    // Advance fake timers past the timeout window (default: 30 seconds)
    await vi.advanceTimersByTimeAsync(31000);

    await assertion;
  });

  it('U-38: complete() throws LlmNetworkError when nodeFetch network call rejects (ECONNREFUSED)', async () => {
    __setNextResponse({ networkError: new Error('ECONNREFUSED') });
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toBeInstanceOf(LlmNetworkError);
  });

  it('complete() throws a clear error "LLM error: Model \'foo\' not found in configuration." when modelName does not match any model in config.llm.models', async () => {
    await expect(client.complete('foo', SAMPLE_MESSAGES)).rejects.toThrow(
      /LLM error: Model 'foo' not found in configuration\./
    );
  });
});

describe('OpenAICompatibleLlmClient.chat', () => {
  let client: OpenAICompatibleLlmClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new OpenAICompatibleLlmClient(TEST_LLM_CONFIG, 'test-instance-chat');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('chat() returns finishReason stop for provider finish_reason stop', async () => {
    __setNextResponse({ status: 200, body: makeOpenAISuccessBody({ text: 'plain text' }) });
    const result = await client.chat('gpt-4o', SAMPLE_MESSAGES);
    expect(result.finishReason).toBe('stop');
    expect(result.message).toEqual({ role: 'assistant', content: 'plain text' });
  });

  it('chat() omits empty tools arrays from provider requests while preserving non-empty tools', async () => {
    const httpsMod = await import('node:https');
    const capturedBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (_opts: unknown, cb: unknown) => {
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(body: string) {
            capturedBodies.push(JSON.parse(body) as Record<string, unknown>);
          },
          end() {
            const bodyStr = JSON.stringify(makeOpenAISuccessBody({ text: 'ok' }));
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: 200,
              statusMessage: 'OK',
              headers: {},
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') for (const chunk of chunks) handler(chunk);
                else if (event === 'end') setTimeout(() => handler(), 0);
              },
            };
            (cb as (res: typeof res) => void)(res);
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    await client.chat('gpt-4o', SAMPLE_MESSAGES, { tools: [] });
    await client.chat('gpt-4o', SAMPLE_MESSAGES, {
      tools: [{ type: 'function', function: { name: 'search_documents', parameters: {} } }],
    });

    expect(capturedBodies[0]).not.toHaveProperty('tools');
    expect(capturedBodies[1].tools).toEqual([
      { type: 'function', function: { name: 'search_documents', parameters: {} } },
    ]);
  });

  it('chat() serializes assistant tool call arguments for provider requests without mutating messages', async () => {
    const httpsMod = await import('node:https');
    const capturedBodies: Array<Record<string, unknown>> = [];
    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (_opts: unknown, cb: unknown) => {
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(body: string) {
            capturedBodies.push(JSON.parse(body) as Record<string, unknown>);
          },
          end() {
            const bodyStr = JSON.stringify(makeOpenAISuccessBody({ text: 'ok' }));
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: 200,
              statusMessage: 'OK',
              headers: {},
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') for (const chunk of chunks) handler(chunk);
                else if (event === 'end') setTimeout(() => handler(), 0);
              },
            };
            (cb as (res: typeof res) => void)(res);
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );
    const messages: LlmChatMessage[] = [
      { role: 'user', content: 'Use the tool.' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'search_documents', arguments: { query: 'alpha' } },
          },
          {
            id: 'call_2',
            type: 'function',
            function: {
              name: 'search_documents',
              arguments: '{"query":"already-string"}' as unknown as Record<string, unknown>,
            },
          },
        ],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ];

    await client.chat('gpt-4o', messages);

    const sentMessages = capturedBodies[0].messages as Array<{
      tool_calls?: Array<{ function: { arguments: unknown } }>;
    }>;
    const sentToolCalls = sentMessages[1].tool_calls ?? [];
    expect(sentToolCalls[0].function.arguments).toBe('{"query":"alpha"}');
    expect(sentToolCalls[1].function.arguments).toBe('{"query":"already-string"}');
    expect(messages[1].tool_calls?.[0].function.arguments).toEqual({ query: 'alpha' });
    expect(messages[1].tool_calls?.[1].function.arguments).toBe('{"query":"already-string"}');
  });

  it('chat() maps function_call and non-empty tool_calls to finishReason tool_calls', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody({ finishReason: 'function_call', args: '{"query":"alpha"}' }),
    });
    const functionCallResult = await client.chat('gpt-4o', SAMPLE_MESSAGES);
    expect(functionCallResult.finishReason).toBe('tool_calls');
    expect(functionCallResult.message.tool_calls?.[0].function.arguments).toEqual({ query: 'alpha' });

    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody({ finishReason: 'stop', args: { query: 'beta' } }),
    });
    const stopWithToolsResult = await client.chat('gpt-4o', SAMPLE_MESSAGES);
    expect(stopWithToolsResult.finishReason).toBe('tool_calls');
    expect(stopWithToolsResult.message.tool_calls?.[0].function.arguments).toEqual({ query: 'beta' });
  });

  it('chat() rejects invalid tool call arguments JSON', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody({ args: '{"query":' }),
    });
    await expect(client.chat('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow('invalid tool call arguments JSON');
  });

  it('chat() accepts empty/null assistant content with tool calls and rejects empty/null content without tool calls', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody({ content: null }),
    });
    await expect(client.chat('gpt-4o', SAMPLE_MESSAGES)).resolves.toMatchObject({
      message: { content: null },
      finishReason: 'tool_calls',
    });

    __setNextResponse({
      status: 200,
      body: makeOpenAISuccessBody({ text: '' }),
    });
    await expect(client.chat('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow('no completion choices');
  });

  it('chat() rejects missing usage on tool-call responses and does not record usage', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody({ usage: null }),
    });
    await expect(client.chat('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow('tool-call response without usage');
    expect(costTracker.recordLlmUsage).not.toHaveBeenCalled();
  });

  it('complete() rejects tool-call responses and still records usage for text responses', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody(),
    });
    await expect(client.complete('gpt-4o', SAMPLE_MESSAGES)).rejects.toThrow(
      'text completion wrapper received tool calls'
    );

    vi.clearAllMocks();
    __setNextResponse({
      status: 200,
      body: makeOpenAISuccessBody({ text: 'tracked text' }),
    });
    await client.complete('gpt-4o', SAMPLE_MESSAGES);
    expect(costTracker.recordLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      purposeName: '_direct',
      modelName: 'gpt-4o',
    }));
  });

  it('chatByPurpose() records usage with trace id and fallback position for tool-call responses', async () => {
    __setNextResponse({
      status: 200,
      body: makeOpenAIToolCallBody(),
    });

    const result = await client.chatByPurpose('default', SAMPLE_MESSAGES, {
      tools: [{ type: 'function', function: { name: 'search_documents', parameters: {} } }],
    }, 'trace-native-tools');

    expect(result.finishReason).toBe('tool_calls');
    expect(costTracker.recordLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'test-instance-chat',
      purposeName: 'default',
      modelName: 'gpt-4o',
      providerName: 'openai',
      inputTokens: 10,
      outputTokens: 20,
      fallbackPosition: 1,
      traceId: 'trace-native-tools',
    }));
  });
});

describe('OpenAICompatibleLlmClient.chatByPurposeUnrecorded', () => {
  it('walks the purpose fallback chain and never records public usage', async () => {
    const config = {
      ...TEST_LLM_CONFIG,
      purposes: [
        ...TEST_LLM_CONFIG.purposes,
        { name: 'unrecorded', description: 'Unrecorded purpose', models: ['gpt-4o', 'fast'] },
      ],
    };
    const client = new OpenAICompatibleLlmClient(config, 'test-instance-unrecorded');
    const httpsMod = await import('node:https');
    const requestedModels: string[] = [];
    const responses = [
      { statusCode: 500, body: { error: 'first model failed' } },
      { statusCode: 200, body: makeOpenAISuccessBody({ text: 'fallback ok', promptTokens: 21, completionTokens: 9 }) },
    ];

    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (_opts: unknown, cb: unknown) => {
        const response = responses.shift();
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(body: string) {
            const parsed = JSON.parse(body) as { model?: string };
            if (parsed.model) requestedModels.push(parsed.model);
          },
          end() {
            if (!response) throw new Error('unexpected request');
            const bodyStr = JSON.stringify(response.body);
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: response.statusCode,
              statusMessage: response.statusCode === 200 ? 'OK' : 'ERROR',
              headers: {},
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') for (const chunk of chunks) handler(chunk);
                else if (event === 'end') setTimeout(() => handler(), 0);
              },
            };
            (cb as (res: typeof res) => void)(res);
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    vi.clearAllMocks();
    const result = await client.chatByPurposeUnrecorded('unrecorded', SAMPLE_MESSAGES);

    expect(requestedModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(result).toMatchObject({
      purposeName: 'unrecorded',
      fallbackPosition: 2,
      modelName: 'fast',
      providerName: 'openai',
      inputTokens: 21,
      outputTokens: 9,
    });
    expect(costTracker.recordLlmUsage).not.toHaveBeenCalled();
  });
});

describe('OpenAICompatibleLlmClient purpose fallback behavior', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('preserves fallback ordering, permanent attempts, and successful purpose usage recording', async () => {
    const config = {
      ...TEST_LLM_CONFIG,
      purposes: [
        ...TEST_LLM_CONFIG.purposes,
        { name: 'resilient', description: 'Fallback purpose', models: ['gpt-4o', 'fast'] },
        { name: 'blocked', description: 'Permanent failure purpose', models: ['gpt-4o', 'fast'] },
      ],
    };
    const client = new OpenAICompatibleLlmClient(config, 'test-instance-fallback');
    const httpsMod = await import('node:https');
    const requestedModels: string[] = [];
    const responses = [
      { statusCode: 500, headers: {}, body: { error: 'server error' } },
      { statusCode: 200, headers: {}, body: makeOpenAISuccessBody({ text: 'fallback ok', promptTokens: 30, completionTokens: 12 }) },
      { statusCode: 401, headers: {}, body: { error: 'unauthorized' } },
    ];

    vi.spyOn(httpsMod as typeof httpsMod & { request: unknown }, 'request').mockImplementation(
      (_opts: unknown, cb: unknown) => {
        const response = responses.shift();
        return {
          on(_event: string, _handler: (err?: Error) => void) {},
          write(body: string) {
            const parsed = JSON.parse(body) as { model?: string };
            if (parsed.model) requestedModels.push(parsed.model);
          },
          end() {
            if (!response) throw new Error('unexpected request');
            const bodyStr = JSON.stringify(response.body);
            const chunks = [Buffer.from(bodyStr, 'utf-8')];
            const res = {
              statusCode: response.statusCode,
              statusMessage: response.statusCode === 200 ? 'OK' : 'ERROR',
              headers: response.headers,
              on(event: string, handler: (chunk?: Buffer) => void) {
                if (event === 'data') for (const chunk of chunks) handler(chunk);
                else if (event === 'end') setTimeout(() => handler(), 0);
              },
            };
            (cb as (res: typeof res) => void)(res);
          },
        } as unknown as ReturnType<typeof httpsMod.request>;
      }
    );

    vi.clearAllMocks();
    const fallbackResult = await client.completeByPurpose('resilient', SAMPLE_MESSAGES, {}, 'trace-fallback');

    expect(fallbackResult).toMatchObject({
      text: 'fallback ok',
      purposeName: 'resilient',
      fallbackPosition: 2,
      modelName: 'fast',
      providerName: 'openai',
      inputTokens: 30,
      outputTokens: 12,
    });
    expect(requestedModels).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(costTracker.recordLlmUsage).toHaveBeenCalledTimes(1);
    expect(costTracker.recordLlmUsage).toHaveBeenCalledWith(expect.objectContaining({
      instanceId: 'test-instance-fallback',
      purposeName: 'resilient',
      fallbackPosition: 2,
      traceId: 'trace-fallback',
    }));

    let blockedError: unknown;
    try {
      await client.completeByPurpose('blocked', SAMPLE_MESSAGES);
    } catch (err) {
      blockedError = err;
    }
    expect(blockedError).toBeInstanceOf(LlmFallbackError);
    expect(blockedError).toMatchObject({
      name: 'LlmFallbackError',
      purposeName: 'blocked',
      attempts: [
        {
          modelName: 'gpt-4o',
          providerName: 'openai',
          error: expect.objectContaining({ name: 'LlmHttpError', status: 401 }),
        },
      ],
    });
    expect(requestedModels).toEqual(['gpt-4o', 'gpt-4o-mini', 'gpt-4o']);
    expect(costTracker.recordLlmUsage).toHaveBeenCalledTimes(1);
  });

  it('preserves resolver 429 retry delay cap before trying the next model', async () => {
    vi.useFakeTimers();
    const chatFn = vi.fn()
      .mockRejectedValueOnce(new LlmHttpError('rate limit', 429, 60000))
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'fallback ok' },
        modelName: 'fast',
        providerName: 'openai',
        inputTokens: 3,
        outputTokens: 4,
        latencyMs: 5,
        finishReason: 'stop',
      });
    const config = {
      ...TEST_LLM_CONFIG,
      purposes: [
        ...TEST_LLM_CONFIG.purposes,
        { name: 'capped', description: 'Retry cap purpose', models: ['gpt-4o', 'fast'] },
      ],
    };
    const resolver = new PurposeResolver(config, chatFn);

    const resultPromise = resolver.chatByPurpose('capped', SAMPLE_MESSAGES);

    await vi.advanceTimersByTimeAsync(29999);
    expect(chatFn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2);

    await expect(resultPromise).resolves.toMatchObject({
      purposeName: 'capped',
      fallbackPosition: 2,
      modelName: 'fast',
    });
    expect(chatFn).toHaveBeenCalledTimes(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initLlm (U-21, U-22)
// ─────────────────────────────────────────────────────────────────────────────

describe('initLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('U-21: initLlm(config) with config.llm defined assigns llmClient to OpenAICompatibleLlmClient and runs startup sync/admission', async () => {
    const { syncLlmConfigToDb } = await import('../../src/llm/config-sync.js');
    const { validatePersistedPurposeTemplateAdmissions } = await import('../../src/llm/purpose-template-bindings.js');

    const config = {
      llm: TEST_LLM_CONFIG,
      instance: { id: 'test-instance-u21' },
    } as unknown as FlashQueryConfig;

    await initLlm(config);

    expect(clientModule.llmClient).toBeInstanceOf(OpenAICompatibleLlmClient);
    expect(syncLlmConfigToDb).toHaveBeenCalledOnce();
    expect(syncLlmConfigToDb).toHaveBeenCalledWith(config);
    expect(validatePersistedPurposeTemplateAdmissions).toHaveBeenCalledOnce();
    expect(validatePersistedPurposeTemplateAdmissions).toHaveBeenCalledWith(config);
  });

  it('U-22: initLlm(config) with config.llm undefined assigns llmClient to NullLlmClient, logs "LLM: not configured" at info level, and does NOT call syncLlmConfigToDb', async () => {
    const { syncLlmConfigToDb } = await import('../../src/llm/config-sync.js');
    const { validatePersistedPurposeTemplateAdmissions } = await import('../../src/llm/purpose-template-bindings.js');
    const { logger } = await import('../../src/logging/logger.js');

    const config = {
      llm: undefined,
    } as unknown as FlashQueryConfig;

    await initLlm(config);

    expect(clientModule.llmClient).toBeInstanceOf(NullLlmClient);
    expect(syncLlmConfigToDb).not.toHaveBeenCalled();
    expect(validatePersistedPurposeTemplateAdmissions).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('not configured'));
  });
});
