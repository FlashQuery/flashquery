/**
 * Phase 103 Wave 0 RED-state unit tests for src/mcp/tools/llm-usage.ts.
 * Coverage: U-36 (period: 7d resolves correct from/to), U-37 (from_date only through now),
 *           U-38 (from_date+to_date overrides period), U-39 (summary mode shape + vs_prior_period),
 *           U-40 (by_purpose excludes _direct from array, surfaces in direct_model_calls),
 *           U-41 (by_purpose primary_model_hit_rate computation),
 *           U-42 (no usage data returns zero/empty results, NOT isError).
 * These tests fail with module-not-found until Plan 103-01 creates src/mcp/tools/llm-usage.ts.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerLlmUsageTools } from '../../src/mcp/tools/llm-usage.js';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn(() => false),
}));

// Chainable supabase mock — supports any order of .eq()/.gte()/.lte()/.order()/.limit()
// followed by an implicit await. Tests override _currentRows / _currentError to control
// what the terminal await resolves to.
let _currentRows: Array<Record<string, unknown>> = [];
let _currentError: Error | null = null;

function makeChain(): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  // every chain method returns the same chain (so further filters compose)
  for (const method of ['eq', 'gte', 'lte', 'order', 'limit'] as const) {
    chain[method] = vi.fn(() => chain);
  }
  // Terminal: await on the chain resolves to { data, error }
  chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve({ data: _currentRows, error: _currentError }).then(onFulfilled);
  return chain;
}

const selectMock = vi.fn(() => makeChain());
const fromMock = vi.fn(() => ({ select: selectMock }));

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: {
    getClient: vi.fn(() => ({ from: fromMock })),
  },
}));

const TEST_CONFIG = {
  instance: { id: 'test-instance-123', name: 'Test', vault: { path: '/tmp/vault', markdownExtensions: ['.md'] } },
} as unknown as import('../../src/config/loader.js').FlashQueryConfig;

// ─── Helper types and functions ──────────────────────────────────────────────

type Handler = (params: unknown) => Promise<{ isError?: boolean; content: Array<{ type: string; text: string }> }>;

function getHandler(): Handler {
  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool: vi.fn((name: string, _spec: unknown, handler: Handler) => {
      handlers.set(name, handler);
    }),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerLlmUsageTools(fakeServer as any, TEST_CONFIG);
  const handler = handlers.get('get_llm_usage');
  if (!handler) throw new Error('get_llm_usage handler was not registered');
  return handler;
}

function makeRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'row-' + Math.random().toString(36).slice(2),
    instance_id: 'test-instance-123',
    purpose_name: 'general',
    model_name: 'fast',
    provider_name: 'openai',
    input_tokens: '10',           // BIGINT → string per Pitfall 2
    output_tokens: '20',
    cost_usd: '0.0000150000',     // NUMERIC → string
    latency_ms: 150,
    fallback_position: 1,
    trace_id: null,
    created_at: '2026-04-29T10:00:00.000Z',
    ...overrides,
  };
}

// ─── Lifecycle hooks ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Re-apply the default implementations after reset (vi.resetAllMocks strips them)
  selectMock.mockImplementation(() => makeChain());
  fromMock.mockImplementation(() => ({ select: selectMock }));
  _currentRows = [];
  _currentError = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── U-36: period: '7d' resolves to a window 7 days wide ending now ──────────

describe('get_llm_usage date range — period: "7d" (U-36)', () => {
  it('U-36: period: "7d" issues a Supabase query with .gte() and .lte() spanning ~7 days', async () => {
    _currentRows = [];
    const handler = getHandler();
    const before = Date.now();
    const result = await handler({ mode: 'summary', period: '7d' });
    const after = Date.now();
    expect(result.isError).toBeUndefined();
    // Verify .gte was called with a Date roughly 7 days ago and .lte with ~now.
    const chain = (selectMock.mock.results[0]?.value ?? null) as Record<string, unknown> | null;
    expect(chain).not.toBeNull();
    const gteCalls = (chain!.gte as ReturnType<typeof vi.fn>).mock.calls;
    const lteCalls = (chain!.lte as ReturnType<typeof vi.fn>).mock.calls;
    expect(gteCalls.length).toBe(1);
    expect(lteCalls.length).toBe(1);
    // Second arg of gte/lte is the ISO string; first arg is column name 'created_at'
    expect(gteCalls[0][0]).toBe('created_at');
    expect(lteCalls[0][0]).toBe('created_at');
    const fromMs = new Date(gteCalls[0][1] as string).getTime();
    const toMs = new Date(lteCalls[0][1] as string).getTime();
    const sevenDaysMs = 7 * 86_400_000;
    // window length is approximately 7 days (allow ±1 minute slack)
    expect(Math.abs((toMs - fromMs) - sevenDaysMs)).toBeLessThan(60_000);
    // window ends roughly at "now" (within the test window)
    expect(toMs).toBeGreaterThanOrEqual(before - 60_000);
    expect(toMs).toBeLessThanOrEqual(after + 60_000);
  });
});

// ─── U-37: from_date only resolves to from_date through now ──────────────────

describe('get_llm_usage date range — from_date only (U-37)', () => {
  it('U-37: from_date only sets gte to that date and lte to ~now', async () => {
    const handler = getHandler();
    await handler({ mode: 'summary', from_date: '2026-04-01' });
    const chain = (selectMock.mock.results[0]?.value ?? null) as Record<string, unknown> | null;
    const gteCalls = (chain!.gte as ReturnType<typeof vi.fn>).mock.calls;
    const lteCalls = (chain!.lte as ReturnType<typeof vi.fn>).mock.calls;
    expect(gteCalls[0][1]).toMatch(/^2026-04-01T/);
    const lteMs = new Date(lteCalls[0][1] as string).getTime();
    expect(Math.abs(lteMs - Date.now())).toBeLessThan(60_000);
  });
});

// ─── U-38: from_date + to_date overrides period; to_date is end-of-day inclusive ─

describe('get_llm_usage date range — from_date+to_date overrides period (U-38)', () => {
  it('U-38: explicit from_date + to_date overrides period; to is set to end-of-day (23:59:59.999)', async () => {
    const handler = getHandler();
    await handler({
      mode: 'summary',
      period: '24h',                 // should be ignored
      from_date: '2026-04-01',
      to_date: '2026-04-28',
    });
    const chain = (selectMock.mock.results[0]?.value ?? null) as Record<string, unknown> | null;
    const gteCalls = (chain!.gte as ReturnType<typeof vi.fn>).mock.calls;
    const lteCalls = (chain!.lte as ReturnType<typeof vi.fn>).mock.calls;
    expect(gteCalls[0][1]).toMatch(/^2026-04-01T/);
    // to_date end-of-day inclusive — 23:59:59.999 UTC
    expect(lteCalls[0][1]).toMatch(/^2026-04-28T23:59:59\.999Z$/);
  });
});

// ─── U-39: summary mode returns correct aggregate shape including vs_prior_period ─

describe('get_llm_usage summary mode (U-39)', () => {
  it('U-39: summary returns total_calls, total_spend_usd, avg_cost_per_call_usd, avg_latency_ms, top_purpose, top_model_name, and vs_prior_period block', async () => {
    // First query (current window) returns 4 rows; second query (prior window) returns 2 rows.
    // Implementation runs current query, then prior query — set up sequence:
    let callCount = 0;
    const currentRows = [
      makeRow({ purpose_name: 'general', model_name: 'fast', cost_usd: '0.001', latency_ms: 100 }),
      makeRow({ purpose_name: 'general', model_name: 'fast', cost_usd: '0.002', latency_ms: 200 }),
      makeRow({ purpose_name: '_direct', model_name: 'fast', cost_usd: '0.003', latency_ms: 300 }),
      makeRow({ purpose_name: 'general', model_name: 'fast', cost_usd: '0.004', latency_ms: 400 }),
    ];
    const priorRows = [
      makeRow({ cost_usd: '0.001', latency_ms: 50 }),
      makeRow({ cost_usd: '0.001', latency_ms: 50 }),
    ];
    selectMock.mockImplementation(() => {
      const chain: Record<string, unknown> = {};
      for (const m of ['eq', 'gte', 'lte', 'order', 'limit'] as const) chain[m] = vi.fn(() => chain);
      chain.then = (onFulfilled: (v: { data: unknown; error: unknown }) => unknown) => {
        const rows = callCount === 0 ? currentRows : priorRows;
        callCount += 1;
        return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
      };
      return chain;
    });
    const handler = getHandler();
    const result = await handler({ mode: 'summary', period: '7d' });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect(parsed.mode).toBe('summary');
    expect(parsed.total_calls).toBe(4);
    expect(parsed.total_spend_usd).toBeCloseTo(0.010, 6);   // 0.001+0.002+0.003+0.004
    expect(parsed.avg_cost_per_call_usd).toBeCloseTo(0.0025, 6);
    expect(parsed.avg_latency_ms).toBe(250);                  // (100+200+300+400)/4
    expect(parsed.top_purpose).toBe('general');               // 3 calls vs _direct's 1 (excluded from top_purpose ranking)
    expect(parsed.top_model_name).toBe('fast');
    expect(parsed.vs_prior_period).toBeDefined();
    expect(parsed.vs_prior_period.calls_delta_pct).toBeCloseTo(((4 - 2) / 2) * 100, 6);   // +100%
    expect(parsed.vs_prior_period.spend_delta_pct).toBeCloseTo(((0.010 - 0.002) / 0.002) * 100, 4);  // +400%
  });

  it('U-39b: summary mode with period: "all" omits vs_prior_period (D-05)', async () => {
    _currentRows = [makeRow()];
    const handler = getHandler();
    const result = await handler({ mode: 'summary', period: 'all' });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect('vs_prior_period' in parsed).toBe(false);
  });
});

// ─── U-40: by_purpose excludes _direct from purposes array ───────────────────

describe('get_llm_usage by_purpose mode (U-40)', () => {
  it('U-40: by_purpose excludes _direct rows from purposes[] and surfaces them in direct_model_calls', async () => {
    _currentRows = [
      makeRow({ purpose_name: 'general', cost_usd: '0.001', latency_ms: 100, fallback_position: 1 }),
      makeRow({ purpose_name: 'general', cost_usd: '0.002', latency_ms: 200, fallback_position: 1 }),
      makeRow({ purpose_name: '_direct', cost_usd: '0.005', latency_ms: 50, fallback_position: null }),
      makeRow({ purpose_name: '_direct', cost_usd: '0.006', latency_ms: 60, fallback_position: null }),
    ];
    const handler = getHandler();
    const result = await handler({ mode: 'by_purpose', period: '7d' });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect(parsed.mode).toBe('by_purpose');
    // purposes array contains 'general' but NEVER '_direct'
    const purposeNames = parsed.purposes.map((p: { purpose_name: string }) => p.purpose_name);
    expect(purposeNames).toContain('general');
    expect(purposeNames).not.toContain('_direct');
    expect(parsed.direct_model_calls).toBeDefined();
    expect(parsed.direct_model_calls.calls).toBe(2);
    expect(parsed.direct_model_calls.spend_usd).toBeCloseTo(0.011, 6);
  });
});

// ─── U-41: by_purpose primary_model_hit_rate computation ─────────────────────

describe('get_llm_usage by_purpose primary_model_hit_rate (U-41)', () => {
  it('U-41: primary_model_hit_rate = fraction of rows with fallback_position === 1', async () => {
    _currentRows = [
      makeRow({ purpose_name: 'p1', fallback_position: 1, cost_usd: '0.001', latency_ms: 100 }),
      makeRow({ purpose_name: 'p1', fallback_position: 1, cost_usd: '0.001', latency_ms: 100 }),
      makeRow({ purpose_name: 'p1', fallback_position: 2, cost_usd: '0.001', latency_ms: 100 }),
      makeRow({ purpose_name: 'p1', fallback_position: 1, cost_usd: '0.001', latency_ms: 100 }),
    ];
    const handler = getHandler();
    const result = await handler({ mode: 'by_purpose', period: '7d' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    const p1 = parsed.purposes.find((p: { purpose_name: string }) => p.purpose_name === 'p1');
    expect(p1).toBeDefined();
    expect(p1.calls).toBe(4);
    // 3 of 4 had fallback_position === 1
    expect(p1.primary_model_hit_rate).toBeCloseTo(0.75, 6);
  });
});

// ─── U-42: no usage data returns empty/zero results (D-16) — NOT isError ─────

describe('get_llm_usage empty state (U-42)', () => {
  it('U-42: when fqc_llm_usage has zero matching rows, summary returns total_calls=0 — NOT isError', async () => {
    _currentRows = [];
    const handler = getHandler();
    const result = await handler({ mode: 'summary', period: '7d' });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect(parsed.total_calls).toBe(0);
    expect(parsed.total_spend_usd).toBe(0);
    expect(parsed.top_purpose).toBeNull();
    expect(parsed.top_model_name).toBeNull();
  });

  it('U-42b: empty state by_purpose returns purposes:[] and direct_model_calls.calls=0', async () => {
    _currentRows = [];
    const handler = getHandler();
    const result = await handler({ mode: 'by_purpose', period: '7d' });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect(parsed.purposes).toEqual([]);
    expect(parsed.direct_model_calls.calls).toBe(0);
  });

  it('U-42c: empty state recent returns entries:[]', async () => {
    _currentRows = [];
    const handler = getHandler();
    const result = await handler({ mode: 'recent', limit: 10 });
    expect(result.isError).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parsed = JSON.parse(result.content[0].text) as any;
    expect(parsed.entries).toEqual([]);
  });
});

// ─── T-106-01: pct_of_total_calls is a fraction [0, 1] — not a percentage ────

describe('get_llm_usage by_model — pct_of_total_calls fraction (T-106-01)', () => {
  it('T-106-01a: pct_of_total_calls is a fraction in [0, 1] for a 1-of-2 model split (exactly 0.5)', async () => {
    // Seed two rows with distinct models — equal split should produce pct_of_total_calls === 0.5 each.
    _currentRows = [
      { instance_id: 'test-instance-123', model_name: 'fast', provider_name: 'openai', purpose_name: '_direct', input_tokens: 10, output_tokens: 5, cost_usd: '0.001', latency_ms: 100, fallback_position: 1, called_at: new Date().toISOString() },
      { instance_id: 'test-instance-123', model_name: 'smart', provider_name: 'openrouter', purpose_name: '_direct', input_tokens: 20, output_tokens: 8, cost_usd: '0.005', latency_ms: 200, fallback_position: 1, called_at: new Date().toISOString() },
    ];

    const handler = getHandler();
    const result = await handler({ mode: 'by_model' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = JSON.parse((result.content[0] as { text: string }).text) as any;

    const fastEntry = payload.models.find((m: { model_name: string }) => m.model_name === 'fast');
    expect(fastEntry).toBeDefined();
    expect(fastEntry.pct_of_total_calls).toBe(0.5);
    expect(fastEntry.pct_of_total_calls).toBeGreaterThanOrEqual(0);
    expect(fastEntry.pct_of_total_calls).toBeLessThanOrEqual(1);

    const smartEntry = payload.models.find((m: { model_name: string }) => m.model_name === 'smart');
    expect(smartEntry).toBeDefined();
    expect(smartEntry.pct_of_total_calls).toBe(0.5);
  });

  it('T-106-01b: pct_of_total_calls is exactly 1 for a single-row dataset', async () => {
    _currentRows = [
      { instance_id: 'test-instance-123', model_name: 'fast', provider_name: 'openai', purpose_name: '_direct', input_tokens: 10, output_tokens: 5, cost_usd: '0.001', latency_ms: 100, fallback_position: 1, called_at: new Date().toISOString() },
    ];

    const handler = getHandler();
    const result = await handler({ mode: 'by_model' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const payload = JSON.parse((result.content[0] as { text: string }).text) as any;

    const onlyEntry = payload.models[0];
    expect(onlyEntry).toBeDefined();
    expect(onlyEntry.pct_of_total_calls).toBe(1);
  });
});
