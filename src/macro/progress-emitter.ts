import type { WarningCode } from '../mcp/utils/response-formats.js';
import type { MacroProgressEntry } from './evaluator.js';

export type ProgressMode = 'full' | 'milestones' | 'silent';

export interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export type ProgressNotificationSink = (notification: ProgressNotification) => void | Promise<void>;

type ProgressCategory = 'explicit' | 'for_loop' | 'model_start' | 'model_finish' | 'tool_start';

export class ProgressEmitter {
  private lastEmittedAt: number | undefined;
  private sequence = 0;

  constructor(
    private readonly mode: ProgressMode,
    private readonly progressToken: string | number | undefined,
    private readonly sink: ProgressNotificationSink | undefined,
    private readonly warnings: WarningCode[],
    private readonly progressEntries: MacroProgressEntry[],
    private readonly clock: () => number = () => Date.now()
  ) {}

  async emitExplicitStatus(entry: MacroProgressEntry): Promise<void> {
    await this.emit('explicit', entry);
  }

  async emitForLoopIteration(label = 'for-loop iteration'): Promise<void> {
    await this.emit('for_loop', { message: label });
  }

  async emitModelCallStart(name: string): Promise<void> {
    await this.emit('model_start', { message: `model_call:start:${name}` });
  }

  async emitModelCallFinish(name: string): Promise<void> {
    await this.emit('model_finish', { message: `model_call:finish:${name}` });
  }

  async emitToolCallStart(name: string): Promise<void> {
    await this.emit('tool_start', { message: `tool_call:start:${name}` });
  }

  private async emit(category: ProgressCategory, entry: MacroProgressEntry): Promise<void> {
    if (!this.shouldEmit(category)) return;
    this.progressEntries.push(entry);
    if (this.progressToken === undefined || !this.sink) return;

    const now = this.clock();
    if (this.lastEmittedAt !== undefined && now - this.lastEmittedAt < 100) {
      this.warnOnce('progress_throttled');
      return;
    }
    this.lastEmittedAt = now;
    this.sequence += 1;
    await this.sink({
      progressToken: this.progressToken,
      progress: entry.progress ?? this.sequence,
      ...(entry.total === undefined ? {} : { total: entry.total }),
      ...(entry.message === undefined ? {} : { message: entry.message }),
    });
  }

  private shouldEmit(category: ProgressCategory): boolean {
    if (this.mode === 'silent') return false;
    if (this.mode === 'full') return true;
    return category === 'explicit' || category === 'model_start' || category === 'model_finish';
  }

  private warnOnce(code: WarningCode): void {
    if (!this.warnings.includes(code)) {
      this.warnings.push(code);
    }
  }
}
