export interface McpDrainResult {
  timedOut: boolean;
  remaining: number;
  elapsedMs: number;
}

export interface McpRequestLifecycle {
  trackHandler<Args extends unknown[], Result>(
    handler: (...args: Args) => Result | Promise<Result>
  ): (...args: Args) => Promise<Awaited<Result>>;
  waitForIdle(timeoutMs: number): Promise<McpDrainResult>;
  getInFlightCount(): number;
}

type IdleWaiter = () => void;

export function createMcpRequestLifecycle(): McpRequestLifecycle {
  let inFlightCount = 0;
  const idleWaiters = new Set<IdleWaiter>();

  const notifyIdle = (): void => {
    if (inFlightCount !== 0) {
      return;
    }

    const waiters = [...idleWaiters];
    idleWaiters.clear();
    for (const waiter of waiters) {
      waiter();
    }
  };

  const increment = (): void => {
    inFlightCount += 1;
  };

  const decrement = (): void => {
    inFlightCount = Math.max(0, inFlightCount - 1);
    notifyIdle();
  };

  return {
    trackHandler<Args extends unknown[], Result>(
      handler: (...args: Args) => Result | Promise<Result>
    ): (...args: Args) => Promise<Awaited<Result>> {
      return async (...args: Args): Promise<Awaited<Result>> => {
        increment();
        try {
          return await handler(...args);
        } finally {
          decrement();
        }
      };
    },

    async waitForIdle(timeoutMs: number): Promise<McpDrainResult> {
      const startedAt = Date.now();
      if (inFlightCount === 0) {
        return {
          timedOut: false,
          remaining: 0,
          elapsedMs: Date.now() - startedAt,
        };
      }

      const normalizedTimeoutMs = Math.max(0, timeoutMs);
      if (normalizedTimeoutMs === 0) {
        return {
          timedOut: inFlightCount > 0,
          remaining: inFlightCount,
          elapsedMs: Date.now() - startedAt,
        };
      }

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let waiter: IdleWaiter | undefined;

      const idlePromise = new Promise<'idle'>((resolve) => {
        waiter = () => resolve('idle');
        idleWaiters.add(waiter);
      });

      const timeoutPromise = new Promise<'timeout'>((resolve) => {
        timeoutId = setTimeout(() => resolve('timeout'), normalizedTimeoutMs);
      });

      await Promise.race([idlePromise, timeoutPromise]);

      if (waiter) {
        idleWaiters.delete(waiter);
      }
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const remaining = inFlightCount;
      return {
        timedOut: remaining > 0,
        remaining,
        elapsedMs: Date.now() - startedAt,
      };
    },

    getInFlightCount(): number {
      return inFlightCount;
    },
  };
}
