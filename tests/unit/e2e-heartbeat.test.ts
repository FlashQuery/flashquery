import { afterEach, describe, expect, it, vi } from 'vitest';
import { withE2EHeartbeat } from '../helpers/e2e-heartbeat.js';

describe('withE2EHeartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits periodic progress while an operation is still running and stops after completion', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];

    const resultPromise = withE2EHeartbeat(
      'template-tools maintain_vault sync',
      () => new Promise<string>((resolve) => setTimeout(() => resolve('done'), 25_000)),
      {
        intervalMs: 10_000,
        metadata: { pid: 12345, temp: 'fqc-template-tools-e2e-abc123' },
        write: (line) => writes.push(line),
      }
    );

    await vi.advanceTimersByTimeAsync(9_999);
    expect(writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(writes).toEqual([
      '[e2e heartbeat] template-tools maintain_vault sync still running after 10s pid=12345 temp=fqc-template-tools-e2e-abc123\n',
    ]);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(writes).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(resultPromise).resolves.toBe('done');

    await vi.advanceTimersByTimeAsync(20_000);
    expect(writes).toHaveLength(2);
  });
});
