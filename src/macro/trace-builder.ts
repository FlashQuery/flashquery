import type { TraceStep, WarningCode } from '../mcp/utils/response-formats.js';

export type TraceMode = 'full' | 'summary' | 'none';

const MAX_TRACE_VALUE_BYTES = 2048;

export class TraceBuilder {
  constructor(
    private readonly mode: TraceMode,
    private readonly trace: TraceStep[],
    private readonly warnings: WarningCode[],
    private readonly now: () => Date = () => new Date()
  ) {}

  add(step: Omit<TraceStep, 'at'>): void {
    if (this.mode === 'none') return;

    const retained: TraceStep = { ...step, at: this.now().toISOString() };
    if (this.mode === 'summary') {
      delete retained.args;
      delete retained.result;
    } else {
      retained.args = this.capValue(retained.args);
      retained.result = this.capValue(retained.result);
    }
    this.trace.push(retained);
  }

  private capValue(value: unknown): unknown {
    if (value === undefined) return undefined;
    const serialized = JSON.stringify(value);
    const byteLength = Buffer.byteLength(serialized, 'utf8');
    if (byteLength <= MAX_TRACE_VALUE_BYTES) return value;
    this.warnOnce('trace_value_truncated');
    return `<truncated: ${byteLength} bytes>`;
  }

  private warnOnce(code: WarningCode): void {
    if (!this.warnings.includes(code)) {
      this.warnings.push(code);
    }
  }
}
