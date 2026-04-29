/**
 * Phase 102 Wave 0 RED-state unit tests for src/llm/cost-tracker.ts.
 * Coverage: U-32 (correct fields), U-33 (_direct sentinel), U-34 (fallback_position null/int),
 *           U-35 (write failure logs WARN, does not throw).
 * These tests fail with module-not-found until Plan 102-01 creates src/llm/cost-tracker.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { recordLlmUsage, drainCostWrites, computeCost, type LlmUsageRecord } from '../../src/llm/cost-tracker.js';

vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const insertMock = vi.fn().mockResolvedValue({ error: null });
const fromMock = vi.fn(() => ({ insert: insertMock }));
vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn(() => ({ from: fromMock })) },
}));

function buildRecord(overrides: Partial<LlmUsageRecord> = {}): LlmUsageRecord {
  return {
    instanceId: 'test-instance',
    purposeName: 'general',
    modelName: 'fast',
    providerName: 'openai',
    inputTokens: 10,
    outputTokens: 20,
    costUsd: 0.00000150,
    latencyMs: 150,
    fallbackPosition: 1,
    traceId: 'trace-abc',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  insertMock.mockResolvedValue({ error: null });
});
afterEach(() => {
  vi.restoreAllMocks();
});

// ─── U-32: recordLlmUsage inserts correct fields ─────────────────────────────

describe('recordLlmUsage (U-32)', () => {
  it('U-32: inserts correct snake_case fields into fqc_llm_usage including trace_id and fallback_position', async () => {
    recordLlmUsage(buildRecord());
    await drainCostWrites(1000);
    expect(fromMock).toHaveBeenCalledWith('fqc_llm_usage');
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      instance_id: 'test-instance',
      purpose_name: 'general',
      model_name: 'fast',
      provider_name: 'openai',
      input_tokens: 10,
      output_tokens: 20,
      cost_usd: 0.00000150,
      latency_ms: 150,
      fallback_position: 1,
      trace_id: 'trace-abc',
    }));
  });
});

// ─── U-33: _direct sentinel for resolver=model ────────────────────────────────

describe('recordLlmUsage _direct sentinel (U-33)', () => {
  it('U-33: purpose_name=_direct and fallback_position=null are persisted as-is', async () => {
    recordLlmUsage(buildRecord({ purposeName: '_direct', fallbackPosition: null, traceId: null }));
    await drainCostWrites(1000);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      purpose_name: '_direct',
      fallback_position: null,
      trace_id: null,
    }));
  });
});

// ─── U-34: fallback_position null vs integer ──────────────────────────────────

describe('recordLlmUsage fallback_position handling (U-34)', () => {
  it('U-34: fallback_position=null persists as null', async () => {
    recordLlmUsage(buildRecord({ fallbackPosition: null }));
    await drainCostWrites(1000);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ fallback_position: null }));
  });
  it('U-34b: fallback_position=2 persists as integer 2', async () => {
    recordLlmUsage(buildRecord({ fallbackPosition: 2 }));
    await drainCostWrites(1000);
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ fallback_position: 2 }));
  });
});

// ─── U-35: Supabase error logs WARN, does not throw ──────────────────────────

describe('recordLlmUsage write-failure isolation (U-35)', () => {
  it('U-35: insert rejection logs WARN, does NOT throw, and drainCostWrites still resolves', async () => {
    const { logger } = await import('../../src/logging/logger.js');
    const warnMock = vi.spyOn(logger, 'warn');
    insertMock.mockRejectedValueOnce(new Error('connection refused'));
    expect(() => recordLlmUsage(buildRecord())).not.toThrow();
    await expect(drainCostWrites(1000)).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('Cost tracking failed'));
    expect(warnMock).toHaveBeenCalledWith(expect.stringContaining('connection refused'));
  });
});

// ─── computeCost sanity checks ────────────────────────────────────────────────
// These mirror U-29 pattern; computeCost is relocated to cost-tracker.ts in Phase 102.

describe('computeCost (relocated from llm.ts)', () => {
  it('computeCost(10, 5, { input: 2.5, output: 10 }) returns correct value', () => {
    expect(computeCost(10, 5, { input: 2.5, output: 10 })).toBeCloseTo((10 * 2.5 + 5 * 10) / 1_000_000, 12);
  });
  it('computeCost(0, 0, { input: 1, output: 1 }) returns 0', () => {
    expect(computeCost(0, 0, { input: 1, output: 1 })).toBe(0);
  });
});
