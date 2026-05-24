import type { WarningCode, ToolResult, TraceStep } from '../mcp/utils/response-formats.js';
import type { McpBroker } from '../services/mcp-broker.js';
import type { MacroBudgetLimits, BudgetTracker } from './budget.js';
import type { ProgressEmitter, ProgressMode, ProgressNotificationSink } from './progress-emitter.js';
import type { TraceMode } from './trace-builder.js';
import type {
  MacroCallerContext,
  MacroSelfSnapshot,
  ToolRegistry,
} from './types.js';

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

export interface MacroBudget {
  token_total: number;
  model_calls: number;
  external_tool_calls: number;
}

export interface MacroCancellationState {
  value: boolean;
}

export interface MacroProgressEntry {
  message?: string;
  progress?: number;
  total?: number;
}

export interface MacroTaskRecord {
  task_id: string;
  status: 'working';
  session_id?: string;
  sessionId?: string;
  progress?: MacroProgressEntry;
}

export interface MacroInvocationContext {
  inputVars: Record<string, MacroValue>;
  trace: TraceStep[];
  traceMode: TraceMode;
  traceBuilder: import('./trace-builder.js').TraceBuilder;
  log: string[];
  budget: MacroBudget;
  budgetTracker: BudgetTracker;
  warnings: WarningCode[];
  taskId: string;
  sessionId?: string;
  progress: MacroProgressEntry[];
  progressMode: ProgressMode;
  progressEmitter: ProgressEmitter;
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
