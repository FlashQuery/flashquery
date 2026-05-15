import { MacroExpectedError } from './evaluator.js';

export interface MacroBudgetLimits {
  max_total_tokens?: number;
  max_model_calls?: number;
  max_external_tool_calls?: number;
  timeout_ms?: number;
}

export interface MacroBudgetCounters {
  token_total: number;
  model_calls: number;
  external_tool_calls: number;
}

export class BudgetTracker {
  private readonly startedAt = Date.now();

  constructor(
    private readonly limits: MacroBudgetLimits,
    private readonly counters: MacroBudgetCounters,
    private readonly clock: () => number = () => Date.now()
  ) {}

  checkTimeout(): void {
    if (this.limits.timeout_ms === undefined) return;
    const elapsed = this.clock() - this.startedAt;
    if (elapsed > this.limits.timeout_ms) {
      throw new MacroExpectedError('timeout', 'Macro execution timed out.', {
        timeout_ms: this.limits.timeout_ms,
        elapsed_ms: elapsed,
      });
    }
  }

  beforeModelCall(): void {
    this.checkTimeout();
    const limit = this.limits.max_model_calls;
    if (limit !== undefined && this.counters.model_calls >= limit) {
      throwBudgetExceeded('max_model_calls', limit, this.counters.model_calls);
    }
    this.counters.model_calls += 1;
  }

  afterModelCall(tokenUsage: number): void {
    this.counters.token_total += tokenUsage;
    const limit = this.limits.max_total_tokens;
    if (limit !== undefined && this.counters.token_total > limit) {
      throwBudgetExceeded('max_total_tokens', limit, this.counters.token_total);
    }
  }

  beforeExternalToolCall(): void {
    this.checkTimeout();
    const limit = this.limits.max_external_tool_calls;
    if (limit !== undefined && this.counters.external_tool_calls >= limit) {
      throwBudgetExceeded('max_external_tool_calls', limit, this.counters.external_tool_calls);
    }
    this.counters.external_tool_calls += 1;
  }
}

function throwBudgetExceeded(which: string, limit: number, consumed: number): never {
  throw new MacroExpectedError('budget_exceeded', `Macro budget exceeded: ${which}.`, {
    which,
    limit,
    consumed,
  });
}
