import type { WarningCode, ToolResult, TraceStep } from '../mcp/utils/response-formats.js';
import type { McpBroker } from '../services/mcp-broker.js';
import type { TraceMode } from './trace-builder.js';

export type MacroValue =
  | null
  | boolean
  | number
  | string
  | MacroValue[]
  | object;

export type MacroNamedArgs = Record<string, MacroValue>;

export type MacroBuiltin = (
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
) => MacroValue | Promise<MacroValue>;

export type ToolFn = (arg: Record<string, MacroValue>, ctx: MacroInvocationContext) => MacroValue | Promise<MacroValue>;

export interface ServerEntry {
  label: string;
  tools: Record<string, ToolFn>;
}

export type ToolRegistry = Record<string, ServerEntry>;

export interface MacroCallerContext {
  origin: 'host' | 'delegated';
  purposeName?: string;
  interactive?: boolean;
  consumerContext?: import('../services/mcp-broker/types.js').ConsumerContext;
}

export interface MacroNeedsUserInputPayload {
  question?: string;
  context?: unknown;
  options?: readonly string[];
  answer_shape?: string;
  resume_hint?: string;
  event?: string;
  server?: string;
  tool?: string;
  old_schema?: unknown;
  new_schema?: unknown;
  diff_summary?: string;
  changes?: unknown;
}

export interface MacroSelfSnapshot {
  path: string;
  frontmatter: Record<string, MacroValue>;
  title: string;
  tags: MacroValue[];
  fq_id: string;
}

export interface MacroBudget {
  token_total: number;
  model_calls: number;
  external_tool_calls: number;
}

export interface MacroBudgetLimits {
  max_total_tokens?: number;
  max_model_calls?: number;
  max_external_tool_calls?: number;
  timeout_ms?: number;
}

export interface MacroCancellationState {
  value: boolean;
}

export interface MacroProgressEntry {
  message?: string;
  progress?: number;
  total?: number;
}

export type ProgressMode = 'full' | 'milestones' | 'silent';

export interface ProgressNotification {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

export type ProgressNotificationSink = (notification: ProgressNotification) => void | Promise<void>;

export interface MacroTaskRecord {
  task_id: string;
  status: 'working';
  session_id?: string;
  sessionId?: string;
  progress?: MacroProgressEntry;
}

export interface MacroBudgetTracker {
  checkTimeout(): void;
  beforeModelCall(): void;
  afterModelCall(tokenUsage: number): void;
  beforeExternalToolCall(): void;
  beforeNestedMacroCall(): void;
}

export interface MacroTraceBuilder {
  add(step: Omit<TraceStep, 'at'>): void;
}

export interface MacroProgressEmitter {
  emitExplicitStatus(entry: MacroProgressEntry): Promise<void>;
  emitForLoopIteration(label?: string): Promise<void>;
  emitModelCallStart(name: string): Promise<void>;
  emitModelCallFinish(name: string): Promise<void>;
  emitToolCallStart(name: string): Promise<void>;
}

export interface MacroInvocationContext {
  inputVars: Record<string, MacroValue>;
  trace: TraceStep[];
  traceMode: TraceMode;
  traceBuilder: MacroTraceBuilder;
  log: string[];
  budget: MacroBudget;
  budgetTracker: MacroBudgetTracker;
  warnings: WarningCode[];
  taskId: string;
  sessionId?: string;
  progress: MacroProgressEntry[];
  progressMode: ProgressMode;
  progressEmitter: MacroProgressEmitter;
  cancelled: MacroCancellationState;
  builtins: Record<string, MacroBuiltin>;
  vaultRoot?: string;
  stdin?: MacroValue;
  broker: McpBroker;
  toolRegistry: ToolRegistry;
  allowedToolNames: Set<string>;
  templateToolNames?: Set<string>;
  hardExcludedReasons?: Map<string, string>;
  callerContext?: MacroCallerContext;
  dispatchTool?: (
    server: string,
    tool: string,
    arg: Record<string, MacroValue>,
    context: MacroInvocationContext
  ) => ToolResult | Promise<ToolResult>;
  progressSink?: (
    entry: MacroProgressEntry,
    context: MacroInvocationContext
  ) => void | Promise<void>;
  progressNotificationSink?: ProgressNotificationSink;
  listTasks?: (context: MacroInvocationContext) => MacroValue[] | Promise<MacroValue[]>;
  checkCancelled(atSafePoint: string): void | Promise<void>;
}

export interface EvaluateProgramOptions {
  builtins?: Record<string, MacroBuiltin>;
  inputVars?: Record<string, MacroValue>;
  input_vars?: Record<string, MacroValue>;
  taskId?: string;
  sessionId?: string;
  trace?: TraceStep[];
  traceMode?: TraceMode;
  log?: string[];
  budget?: Partial<MacroBudget>;
  budgetLimits?: MacroBudgetLimits;
  progress?: MacroProgressEntry[];
  progressMode?: ProgressMode;
  progressToken?: string | number;
  cancelled?: boolean | MacroCancellationState;
  broker?: McpBroker;
  toolRegistry?: ToolRegistry;
  allowedToolNames?: Iterable<string>;
  allowlist?: Iterable<string>;
  templateToolNames?: Iterable<string>;
  hardExcludedReasons?: Map<string, string>;
  callerContext?: MacroCallerContext;
  dispatchTool?: MacroInvocationContext['dispatchTool'];
  progressSink?: MacroInvocationContext['progressSink'];
  progressNotificationSink?: ProgressNotificationSink;
  listTasks?: MacroInvocationContext['listTasks'];
  vaultRoot?: string;
  stdin?: MacroValue;
  self?: MacroSelfSnapshot;
  checkCancelled?: (atSafePoint: string) => void | Promise<void>;
}
