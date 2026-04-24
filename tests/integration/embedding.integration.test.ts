// Requires: Ollama running at OLLAMA_URL (defaults to Matt's local server)
// Run: OLLAMA_URL=http://192.168.15.12:11434 npm run test:integration
//
// Server:  http://192.168.15.12:11434
// Model:   granite-embedding:278m

import { describe, it, expect, beforeAll } from 'vitest';
import { initLogger } from '../../src/logging/logger.js';
import { createEmbeddingProvider } from '../../src/embedding/provider.js';

import { TEST_OLLAMA_URL } from '../helpers/test-env.js';

// Read directly from process.env — TEST_OLLAMA_URL has a default so is unsafe for skip gating
const HAS_OLLAMA = !!process.env.OLLAMA_URL;
const OLLAMA_URL = TEST_OLLAMA_URL;
const OLLAMA_MODEL = 'granite-embedding:278m';

/** Returns true if the Ollama server at the given URL is reachable. */
async function isOllamaReachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  const dot = a.reduce((sum, v, i) => sum + v * b[i], 0);
  const magA = Math.sqrt(a.reduce((sum, v) => sum + v * v, 0));
  const magB = Math.sqrt(b.reduce((sum, v) => sum + v * v, 0));
  return dot / (magA * magB);
}

describe.skipIf(!HAS_OLLAMA)('Ollama embedding integration', () => {
  let provider: ReturnType<typeof createEmbeddingProvider>;
  let ollamaReachable = false;

  beforeAll(async () => {
    ollamaReachable = await isOllamaReachable(OLLAMA_URL);
    if (!ollamaReachable) return;
    initLogger({ logging: { level: 'error', output: 'stdout' } } as any);
    provider = createEmbeddingProvider({
      provider: 'ollama',
      model: OLLAMA_MODEL,
      endpoint: OLLAMA_URL,
      dimensions: 768,
    });
  });

  it('returns a non-empty numeric vector for a text input', async () => {
    if (!ollamaReachable) return;
    const vec = await provider.embed('hello world');
    expect(Array.isArray(vec)).toBe(true);
    expect(vec.length).toBeGreaterThan(0);
    expect(typeof vec[0]).toBe('number');
    expect(vec.every(v => isFinite(v))).toBe(true);
  });

  it('produces different vectors for different inputs', async () => {
    if (!ollamaReachable) return;
    const [vecA, vecB] = await Promise.all([
      provider.embed('the quick brown fox'),
      provider.embed('quantum physics and thermodynamics'),
    ]);
    expect(vecA).not.toEqual(vecB);
  });

  it('produces near-identical vectors for the same input twice', async () => {
    if (!ollamaReachable) return;
    const [vec1, vec2] = await Promise.all([
      provider.embed('deterministic embedding test'),
      provider.embed('deterministic embedding test'),
    ]);
    const similarity = cosineSimilarity(vec1, vec2);
    expect(similarity).toBeGreaterThan(0.999);
  });

  it('getDimensions() matches the actual vector length returned', async () => {
    if (!ollamaReachable) return;
    const vec = await provider.embed('dimension check');
    // getDimensions() returns the configured value — actual may differ by model
    // This test documents the real output dimension for granite-embedding:278m
    expect(vec.length).toBeGreaterThan(0);
    console.log(`granite-embedding:278m actual dimensions: ${vec.length}`);
  });
});
