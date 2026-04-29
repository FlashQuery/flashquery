import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  OpenAICompatibleLlmClient,
  NullLlmClient,
  initLlm,
  mergeParameters,
  type ChatMessage,
  type LlmCompletionResult,
  type LlmClient,
} from '../../src/llm/client.js';
import * as clientModule from '../../src/llm/client.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

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
            headers: {} as Record<string, string>,
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
              headers: {} as Record<string, string>,
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
          headers: {} as Record<string, string>,
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
          headers: {} as Record<string, string>,
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
              headers: {} as Record<string, string>,
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

  it('complete() throws a clear error "LLM error: Model \'foo\' not found in configuration." when modelName does not match any model in config.llm.models', async () => {
    await expect(client.complete('foo', SAMPLE_MESSAGES)).rejects.toThrow(
      /LLM error: Model 'foo' not found in configuration\./
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// initLlm (U-21, U-22)
// ─────────────────────────────────────────────────────────────────────────────

describe('initLlm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('U-21: initLlm(config) with config.llm defined assigns llmClient to OpenAICompatibleLlmClient and calls syncLlmConfigToDb(config) once', async () => {
    const { syncLlmConfigToDb } = await import('../../src/llm/config-sync.js');

    const config = {
      llm: TEST_LLM_CONFIG,
    } as unknown as FlashQueryConfig;

    await initLlm(config);

    expect(clientModule.llmClient).toBeInstanceOf(OpenAICompatibleLlmClient);
    expect(syncLlmConfigToDb).toHaveBeenCalledOnce();
    expect(syncLlmConfigToDb).toHaveBeenCalledWith(config);
  });

  it('U-22: initLlm(config) with config.llm undefined assigns llmClient to NullLlmClient, logs "LLM: not configured" at info level, and does NOT call syncLlmConfigToDb', async () => {
    const { syncLlmConfigToDb } = await import('../../src/llm/config-sync.js');
    const { logger } = await import('../../src/logging/logger.js');

    const config = {
      llm: undefined,
    } as unknown as FlashQueryConfig;

    await initLlm(config);

    expect(clientModule.llmClient).toBeInstanceOf(NullLlmClient);
    expect(syncLlmConfigToDb).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('not configured'));
  });
});
