// In-memory task registry for the golden model.
//
// Golden patch item 10 (REQ-025): converted from a process-global singleton
// to an instantiable class. Each `evaluate()` call constructs its own
// `TaskRegistry` so per-invocation isolation holds under concurrency. The
// runtime context carries the per-run instance through CallContext.exec.
//
// Golden patch item 3 (REQ-049 ac3): terminal transitions now delete the
// task record after the state snapshot is captured by the caller. Frozen-POC
// behavior was to retain records; the golden cleans up. The
// `state_notes`/trace emission happens BEFORE the delete in evaluator.ts.
//
// Golden patch item 5 (REQ-046): TaskTraceStep gains `args`, `result`,
// `elapsed_ms`. Tool-call dispatch emits a step containing all three.
//
// State names (`working`, `completed`, `failed`, `cancelled`) match SEP-1686
// vocabulary.

import { randomUUID } from "node:crypto";
import type { Value } from "./types.ts";
import type { StateNote } from "./statenotes.ts";

// v0 task status state machine.
//   working    — running
//   completed  — terminal: success
//   failed     — terminal: error
//   cancelled  — terminal: cancellation honored
export type TaskStatus = "working" | "completed" | "failed" | "cancelled";

const TERMINAL_STATUSES = new Set<TaskStatus>(["completed", "failed", "cancelled"]);

export type TaskProgress = {
  progress: number | null;
  total: number | null;
  message: string | null;
};

// REQ-046 extension: args, result, elapsed_ms. Tool-call steps populate
// all three (item 5); other kinds populate as relevant. state_notes is a
// sparse array of per-step intermediate-state events (per §5.6.1).
export type TaskTraceStep = {
  kind: "tool_call" | "model_call" | "progress" | "log" | "fail" | "exit";
  name?: string;
  message?: string;
  args?: Value;          // tool/model call arguments (truncated to ≤2KB for "summary" trace mode)
  result?: Value;        // tool/model call result (truncated)
  elapsed_ms?: number;
  at: string;            // ISO 8601
  state_notes?: StateNote[];  // populated by the golden's emission hooks; absent from production
};

// Record shape: v0 fields only. No TTL, no pollInterval — those wait for the
// external MCP Tasks protocol surface to stabilize.
export type TaskRecord = {
  taskId: string;
  status: TaskStatus;
  createdAt: string;          // ISO 8601
  lastUpdatedAt: string;      // ISO 8601
  statusMessage?: string;     // optional human-readable status
  parentTaskId?: string;

  // FlashQuery-specific augmentation (kept here for the prototype; in
  // production these live in a side table keyed by taskId)
  caller: string;
  macro_source_preview: string;
  progress: TaskProgress;
  result?: Value;
  error?: { kind: string; message: string };
  trace: TaskTraceStep[];
};

export class TaskRegistry {
  private tasks = new Map<string, TaskRecord>();
  private currentTaskId: string | null = null;
  // Snapshot of terminally-deleted tasks so the runner can still report
  // the final state after delete-on-terminal (item 3).
  private terminalSnapshots = new Map<string, TaskRecord>();

  /**
   * Create a new task in `working` state. The receiver generates the taskId;
   * the requester never specifies it.
   */
  create(opts: { macroSource: string; caller?: string; parentTaskId?: string }): string {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const preview = opts.macroSource
      .split(/\r?\n/)
      .slice(0, 3)
      .join(" / ")
      .slice(0, 120);
    const record: TaskRecord = {
      taskId,
      status: "working",
      createdAt: now,
      lastUpdatedAt: now,
      caller: opts.caller ?? "standalone-runner",
      macro_source_preview: preview,
      progress: { progress: null, total: null, message: null },
      trace: [],
      parentTaskId: opts.parentTaskId,
    };
    this.tasks.set(taskId, record);
    this.currentTaskId = taskId;
    return taskId;
  }

  /**
   * Update the current task's progress snapshot. By default this also
   * appends a `progress` trace step; pass `emitTrace: false` to suppress
   * the trace append (REQ-048 ac3 — `progress: "silent"` must not emit).
   */
  updateProgress(
    progress: number | null,
    total: number | null,
    message: string | null,
    opts: { emitTrace?: boolean } = {},
  ): void {
    const r = this.requireCurrentTask();
    r.progress = { progress, total, message };
    if (message) r.statusMessage = message;
    r.lastUpdatedAt = new Date().toISOString();
    if (opts.emitTrace !== false) {
      r.trace.push({
        kind: "progress",
        message: this.formatProgress(progress, total, message),
        at: r.lastUpdatedAt,
      });
    }
  }

  appendTrace(step: Omit<TaskTraceStep, "at">): void {
    const r = this.currentTaskId ? this.tasks.get(this.currentTaskId) : undefined;
    if (!r) return;
    const at = new Date().toISOString();
    r.trace.push({ ...step, at });
    r.lastUpdatedAt = at;
  }

  /**
   * Transition to `completed`. Terminal. Snapshots the record into
   * `terminalSnapshots` then deletes it from the active map (item 3,
   * REQ-049 ac3).
   */
  complete(taskId: string, result: Value): void {
    const r = this.requireTask(taskId);
    this.assertNotTerminal(r);
    r.status = "completed";
    r.lastUpdatedAt = new Date().toISOString();
    r.result = result;
    this.terminalSnapshots.set(taskId, { ...r, trace: [...r.trace] });
    this.tasks.delete(taskId);
  }

  /** Transition to `failed`. Terminal. Snapshots then deletes. */
  fail(taskId: string, error: { kind: string; message: string }): void {
    const r = this.requireTask(taskId);
    this.assertNotTerminal(r);
    r.status = "failed";
    r.lastUpdatedAt = new Date().toISOString();
    r.error = error;
    this.terminalSnapshots.set(taskId, { ...r, trace: [...r.trace] });
    this.tasks.delete(taskId);
  }

  /** Transition to `cancelled`. Terminal. Caller is responsible for actually
   *  stopping execution; the macro engine observes the cancelled status at
   *  the next cooperative-cancellation safe point and throws.
   *  Snapshots then deletes.
   */
  cancel(taskId: string): void {
    const r = this.requireTask(taskId);
    this.assertNotTerminal(r);
    r.status = "cancelled";
    r.lastUpdatedAt = new Date().toISOString();
    this.terminalSnapshots.set(taskId, { ...r, trace: [...r.trace] });
    this.tasks.delete(taskId);
  }

  /**
   * Mark that no macro is currently in-flight. The runner calls this once
   * execution has actually returned (after the evaluator finishes or throws),
   * so subsequent calls don't pollute the "current task" slot.
   */
  clearCurrentTask(): void {
    this.currentTaskId = null;
  }

  /** Look up a task — either active or its terminal snapshot. */
  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId) ?? this.terminalSnapshots.get(taskId);
  }

  /** List all currently-active and terminally-snapshotted tasks (for
   *  introspection builtins like `list_tasks`). */
  list(): TaskRecord[] {
    return [...this.terminalSnapshots.values(), ...this.tasks.values()];
  }

  getCurrentTaskId(): string | null {
    return this.currentTaskId;
  }

  /** For tests / runner reset. */
  reset(): void {
    this.tasks.clear();
    this.terminalSnapshots.clear();
    this.currentTaskId = null;
  }

  private requireTask(taskId: string): TaskRecord {
    const r = this.tasks.get(taskId);
    if (!r) throw new Error(`Unknown taskId: ${taskId}`);
    return r;
  }

  private requireCurrentTask(): TaskRecord {
    if (!this.currentTaskId) {
      throw new Error("No current task — registry not initialized for this run");
    }
    return this.requireTask(this.currentTaskId);
  }

  private assertNotTerminal(r: TaskRecord): void {
    if (TERMINAL_STATUSES.has(r.status)) {
      throw new Error(
        `Task ${r.taskId} is already in terminal state ${r.status}; cannot transition`,
      );
    }
  }

  private formatProgress(progress: number | null, total: number | null, message: string | null): string {
    const parts: string[] = [];
    if (progress !== null && total !== null) parts.push(`[${progress}/${total}]`);
    else if (progress !== null) parts.push(`[${progress}]`);
    if (message) parts.push(message);
    return parts.join(" ");
  }
}

// Convenience factory.
export function makeTaskRegistry(): TaskRegistry {
  return new TaskRegistry();
}
