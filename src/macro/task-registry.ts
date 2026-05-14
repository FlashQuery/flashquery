import { randomUUID } from 'node:crypto';
import type { MacroProgressEntry } from './evaluator.js';

export const MACRO_TASK_STATUSES = ['working', 'completed', 'failed', 'cancelled'] as const;

export type MacroTaskStatus = (typeof MACRO_TASK_STATUSES)[number];

export interface MacroTaskRecord {
  task_id: string;
  status: MacroTaskStatus;
  created_at: string;
  updated_at: string;
  session_id?: string;
  progress?: MacroProgressEntry;
  source_preview?: string;
}

export interface CreateMacroTaskOptions {
  taskId?: string;
  sessionId?: string;
  source?: string;
  sourcePreview?: string;
  progress?: MacroProgressEntry;
}

export type MacroTaskTransitionListener = (record: MacroTaskRecord) => void;

export class MacroTaskRegistry {
  private readonly tasks = new Map<string, MacroTaskRecord>();
  private readonly cancellationRequests = new Set<string>();

  create(options: CreateMacroTaskOptions = {}): MacroTaskRecord {
    const now = new Date().toISOString();
    const record: MacroTaskRecord = {
      task_id: options.taskId ?? randomUUID(),
      status: 'working',
      created_at: now,
      updated_at: now,
      ...(options.sessionId === undefined ? {} : { session_id: options.sessionId }),
      ...(options.progress === undefined ? {} : { progress: options.progress }),
      ...taskSourcePreview(options),
    };
    this.tasks.set(record.task_id, record);
    return { ...record };
  }

  complete(taskId: string, onTransition?: MacroTaskTransitionListener): boolean {
    return this.transitionTerminal(taskId, 'completed', onTransition);
  }

  fail(taskId: string, onTransition?: MacroTaskTransitionListener): boolean {
    return this.transitionTerminal(taskId, 'failed', onTransition);
  }

  cancel(taskId: string, sessionId?: string, onTransition?: MacroTaskTransitionListener): boolean {
    const record = this.tasks.get(taskId);
    if (!record) return false;
    if (!isSameSession(record, sessionId)) return false;

    this.cancellationRequests.add(taskId);
    return this.transitionTerminal(taskId, 'cancelled', onTransition);
  }

  get(taskId: string, sessionId?: string): MacroTaskRecord | undefined {
    const record = this.tasks.get(taskId);
    if (!record || !isSameSession(record, sessionId)) return undefined;
    return { ...record };
  }

  list(sessionId?: string): MacroTaskRecord[] {
    return Array.from(this.tasks.values())
      .filter((record) => isSameSession(record, sessionId))
      .map((record) => ({ ...record }));
  }

  isCancellationRequested(taskId: string): boolean {
    return this.cancellationRequests.has(taskId);
  }

  clearCancellationRequest(taskId: string): void {
    this.cancellationRequests.delete(taskId);
  }

  private transitionTerminal(
    taskId: string,
    status: Exclude<MacroTaskStatus, 'working'>,
    onTransition?: MacroTaskTransitionListener
  ): boolean {
    const current = this.tasks.get(taskId);
    if (!current) {
      if (status === 'cancelled' && this.cancellationRequests.has(taskId)) {
        const now = new Date().toISOString();
        onTransition?.({
          task_id: taskId,
          status,
          created_at: now,
          updated_at: now,
        });
        this.cancellationRequests.delete(taskId);
        return true;
      }
      return false;
    }

    const terminal: MacroTaskRecord = {
      ...current,
      status,
      updated_at: new Date().toISOString(),
    };
    onTransition?.({ ...terminal });
    this.tasks.delete(taskId);
    if (status !== 'cancelled') {
      this.cancellationRequests.delete(taskId);
    }
    return true;
  }
}

function taskSourcePreview(options: CreateMacroTaskOptions): Pick<MacroTaskRecord, 'source_preview'> {
  const rawPreview = options.sourcePreview ?? options.source;
  if (rawPreview === undefined) return {};
  const source_preview = rawPreview
    .split(/\r?\n/)
    .slice(0, 3)
    .join(' / ')
    .slice(0, 120);
  return { source_preview };
}

function isSameSession(record: MacroTaskRecord, sessionId: string | undefined): boolean {
  return sessionId === undefined || record.session_id === undefined || record.session_id === sessionId;
}
