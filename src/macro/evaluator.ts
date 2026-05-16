import { randomUUID } from 'node:crypto';
import type {
  Arg,
  Call,
  Expr,
  FieldAccess,
  ObjectLit,
  Pipeline,
  Program,
  Statement,
  ToolCall,
  ToolRegistry,
  MacroCallerContext,
} from './types.js';
import {
  jsonExpectedError,
  jsonRuntimeError,
  macroResult,
  withWarnings,
  type ToolResult,
  type TraceStep,
  type WarningCode,
} from '../mcp/utils/response-formats.js';
import type { McpBroker } from '../services/mcp-broker.js';
import { NullMcpBroker } from '../services/mcp-broker.js';
import { MacroPreflightError, collectInputVarContract, validateInputVars } from './preflight.js';
import { preflightProgram } from './preflight.js';
import { preScanForbiddenShellFlags } from './forbidden-flag-scan.js';
import { buildRange, standardBuiltins } from './builtins.js';
import { shellBuiltins } from './shell-verbs.js';
import { resolveNamespaceIntrospection } from './introspection.js';
import { preScanToolReferences } from './permission-prescan.js';
import { dispatchMacroTool } from './dispatcher.js';
import { MACRO_SAFE_POINTS } from './safe-points.js';
import { TraceBuilder, type TraceMode } from './trace-builder.js';
import { ProgressEmitter, type ProgressMode, type ProgressNotificationSink } from './progress-emitter.js';
import { BudgetTracker, type MacroBudgetLimits } from './budget.js';

const ESCAPED_DOLLAR_SENTINEL = '\uE000';

export type MacroValue =
  | null
  | boolean
  | number
  | string
  | MacroValue[]
  | { [key: string]: MacroValue };

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
  traceBuilder: TraceBuilder;
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
  toolRegistry?: ToolRegistry;
  allowedToolNames?: Set<string>;
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
  /**
   * Returns task records visible to the current MCP session only (REQ-040 ac3).
   * Implementations must filter cross-session records before returning. The
   * builtin applies a defensive session marker filter when sessionId is present.
   */
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
  checkCancelled?: (atSafePoint: string) => void | Promise<void>;
}

export class MacroRuntimeError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroRuntimeError';
  }
}

export class MacroCancellationError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly atSafePoint: string
  ) {
    super('Macro cancelled');
    this.name = 'MacroCancellationError';
  }
}

export class MacroExitError extends Error {
  constructor(
    public readonly value: MacroValue,
    public readonly line?: number
  ) {
    super('macro exited');
    this.name = 'MacroExitError';
  }
}

export class MacroFailError extends Error {
  constructor(
    message: string,
    public readonly line?: number
  ) {
    super(message);
    this.name = 'MacroFailError';
  }
}

export class MacroExpectedError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroExpectedError';
  }
}

class Env {
  private readonly bindings = new Map<string, MacroValue>();

  constructor(private readonly parent: Env | null = null) {}

  get(name: string): MacroValue {
    if (this.bindings.has(name)) {
      return this.bindings.get(name) as MacroValue;
    }
    if (this.parent) {
      return this.parent.get(name);
    }
    throw new MacroRuntimeError(`Unknown variable: $${name}`, undefined, {
      reason: 'unknown_variable',
      name,
    });
  }

  set(name: string, value: MacroValue): void {
    const owner = this.findOwner(name);
    if (owner) {
      owner.bindings.set(name, value);
      return;
    }
    this.bindings.set(name, value);
  }

  setLocal(name: string, value: MacroValue): void {
    this.bindings.set(name, value);
  }

  private findOwner(name: string): Env | null {
    if (this.bindings.has(name)) {
      return this;
    }
    return this.parent?.findOwner(name) ?? null;
  }
}

export function createInvocationContext(
  options: EvaluateProgramOptions = {}
): MacroInvocationContext {
  const cancelled =
    typeof options.cancelled === 'object'
      ? { value: options.cancelled.value }
      : { value: options.cancelled ?? false };
  const budget = {
    token_total: options.budget?.token_total ?? 0,
    model_calls: options.budget?.model_calls ?? 0,
    external_tool_calls: options.budget?.external_tool_calls ?? 0,
  };
  const warnings: WarningCode[] = [];
  const traceMode = options.traceMode ?? 'full';
  const trace = [...(options.trace ?? [])];
  const progressMode = options.progressMode ?? 'milestones';
  const progress = [...(options.progress ?? [])];
  const budgetTracker = new BudgetTracker(options.budgetLimits ?? {}, budget);
  const inputVars = cloneMacroObject(options.inputVars ?? options.input_vars ?? {});

  const context: MacroInvocationContext = {
    inputVars,
    trace,
    traceMode,
    traceBuilder: new TraceBuilder(traceMode, trace, warnings),
    log: [...(options.log ?? [])],
    budget,
    budgetTracker,
    warnings,
    taskId: options.taskId ?? randomUUID(),
    sessionId: options.sessionId,
    progress,
    progressMode,
    progressEmitter: new ProgressEmitter(
      progressMode,
      options.progressToken,
      options.progressNotificationSink,
      warnings,
      progress,
      undefined,
      (step) => context.traceBuilder.add(step)
    ),
    cancelled,
    builtins: { ...standardBuiltins, ...shellBuiltins, ...(options.builtins ?? {}) },
    vaultRoot: options.vaultRoot,
    stdin: options.stdin,
    broker: options.broker ?? new NullMcpBroker(),
    toolRegistry: options.toolRegistry,
    allowedToolNames: options.allowedToolNames === undefined && options.allowlist === undefined
      ? undefined
      : new Set(options.allowedToolNames ?? options.allowlist),
    templateToolNames: options.templateToolNames === undefined
      ? undefined
      : new Set(options.templateToolNames),
    hardExcludedReasons: options.hardExcludedReasons,
    callerContext: options.callerContext,
    dispatchTool: options.dispatchTool,
    progressSink: options.progressSink,
    progressNotificationSink: options.progressNotificationSink,
    listTasks: options.listTasks,
    checkCancelled: async (atSafePoint: string) => {
      budgetTracker.checkTimeout();
      if (cancelled.value) {
        throw new MacroCancellationError(context.taskId, atSafePoint);
      }
      await options.checkCancelled?.(atSafePoint);
    },
  };

  return context;
}

export async function evaluateProgram(
  program: Program,
  options: EvaluateProgramOptions = {}
): Promise<ToolResult> {
  const context = createInvocationContext(options);
  const env = new Env();

  try {
    preScanForbiddenShellFlags(program);
    preflightProgram(program);
    const inputVarContract = collectInputVarContract(program);
    validateInputVars(inputVarContract, context.inputVars);
    if (context.toolRegistry && context.allowedToolNames) {
      const permissionError = preScanToolReferences({
        program,
        registry: context.toolRegistry,
        allowlist: context.allowedToolNames,
        ...(context.templateToolNames === undefined ? {} : { templateToolNames: context.templateToolNames }),
        ...(context.hardExcludedReasons === undefined ? {} : { hardExcludedReasons: context.hardExcludedReasons }),
        ...(context.callerContext === undefined ? {} : { callerContext: context.callerContext }),
      });
      if (permissionError) {
        throwExpectedToolResult(permissionError);
      }
    }
    await execBlock(program.statements, env, context);
    return macroResult(buildSuccessPayload(context, null));
  } catch (error) {
    if (error instanceof MacroExitError) {
      pushTrace(context, { kind: 'exit', result: error.value });
      return macroResult(buildSuccessPayload(context, error.value));
    }
    if (error instanceof MacroFailError) {
      pushTrace(context, { kind: 'fail', message: error.message });
      return jsonExpectedError({
        error: 'macro_aborted',
        message: error.message,
        details: { line: error.line },
      });
    }
    if (error instanceof MacroExpectedError) {
      return jsonExpectedError({
        error: error.error,
        message: error.message,
        details: error.details,
      });
    }
    if (error instanceof MacroCancellationError) {
      return jsonExpectedError({
        error: 'cancelled',
        message: 'Macro cancelled',
        details: {
          task_id: error.taskId,
          at_safe_point: error.atSafePoint,
        },
      });
    }
    if (error instanceof MacroPreflightError) {
      return jsonExpectedError({
        error: error.error,
        message: error.message,
        details: error.details,
      });
    }
    if (error instanceof MacroRuntimeError) {
      return jsonRuntimeError({
        error: 'tool_call_failed',
        message: error.message,
        details: {
          ...(error.details ?? {}),
          ...(error.line === undefined ? {} : { line: error.line }),
        },
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    return jsonRuntimeError({
      error: 'tool_call_failed',
      message,
      details: { underlying_error: serializeError(error) },
    });
  }
}

export function isTruthy(value: MacroValue): boolean {
  if (value === null || value === false) return false;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

async function execBlock(
  statements: Statement[],
  env: Env,
  context: MacroInvocationContext
): Promise<void> {
  for (let index = 0; index < statements.length; index += 1) {
    if (index > 0) {
      await context.checkCancelled(MACRO_SAFE_POINTS.betweenStatements);
    }
    await context.checkCancelled(MACRO_SAFE_POINTS.beforeStatement);
    const stmt = statements[index];
    await execStatement(stmt, env, context);
  }
}

async function execStatement(
  stmt: Statement,
  env: Env,
  context: MacroInvocationContext
): Promise<void> {
  switch (stmt.kind) {
    case 'Binding': {
      const value = await evalExpr(stmt.value, env, context);
      env.set(stmt.name, value);
      return;
    }
    case 'Pipeline':
      await execPipeline(stmt, env, context);
      return;
    case 'ToolCall':
      await evalToolCall(stmt, env, context);
      return;
    case 'ToolExistsCall':
      await evalToolExists(stmt, context);
      return;
    case 'ForLoop': {
      const iterable = await evalExpr(stmt.iterable, env, context);
      if (!Array.isArray(iterable)) {
        throw new MacroRuntimeError('For-loop iterable must be a list.', stmt.line, {
          reason: 'for_iterable_type_mismatch',
        });
      }
      for (const itemValue of iterable) {
        await context.checkCancelled(MACRO_SAFE_POINTS.forLoopIteration);
        await context.progressEmitter.emitForLoopIteration(`for ${stmt.varName}`);
        const child = new Env(env);
        child.setLocal(stmt.varName, itemValue);
        await execBlock(stmt.body, child, context);
      }
      return;
    }
    case 'WhileLoop': {
      const child = new Env(env);
      while (isTruthy(await evalExpr(stmt.condition, child, context))) {
        await context.checkCancelled(MACRO_SAFE_POINTS.whileLoopIteration);
        await execBlock(stmt.body, child, context);
      }
      return;
    }
    case 'IfStmt': {
      const branch = isTruthy(await evalExpr(stmt.condition, env, context))
        ? stmt.thenBody
        : (stmt.elseBody ?? []);
      await execBlock(branch, new Env(env), context);
      return;
    }
  }
}

async function evalExpr(
  expr: Expr,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  switch (expr.kind) {
    case 'StringLit':
      return expr.interpolated ? interpolate(expr.raw, env) : expr.raw;
    case 'NumLit':
      return expr.value;
    case 'NullLit':
      return null;
    case 'VarRef':
      return env.get(expr.name);
    case 'ListLit':
      return Promise.all(expr.items.map((item) => evalExpr(item, env, context)));
    case 'ObjectLit':
      return evalObjectLit(expr, env, context);
    case 'FieldAccess':
      return evalFieldAccess(expr, env, context);
    case 'RangeExpr':
      return evalRange(expr.start, expr.end, env, context);
    case 'BinaryExpr':
      return evalBinaryExpr(expr, env, context);
    case 'UnaryExpr':
      return !isTruthy(await evalExpr(expr.expr, env, context));
    case 'Call':
      return evalCall(expr, env, context);
    case 'Pipeline':
      return evalPipeline(expr, env, context);
    case 'ToolCall':
      return evalToolCall(expr, env, context);
    case 'ToolExistsCall':
      return evalToolExists(expr, context);
  }
}

async function execPipeline(
  pipeline: Pipeline,
  env: Env,
  context: MacroInvocationContext
): Promise<void> {
  await evalPipeline(pipeline, env, context);
}

async function evalPipeline(
  pipeline: Pipeline,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  let value: MacroValue = null;
  for (let index = 0; index < pipeline.stages.length; index += 1) {
    if (index > 0) {
      await context.checkCancelled(MACRO_SAFE_POINTS.betweenPipelineStages);
    }
    const previousStdin = context.stdin;
    context.stdin = index === 0 ? previousStdin : value;
    try {
      value = await evalCall(pipeline.stages[index], env, context);
    } finally {
      context.stdin = previousStdin;
    }
  }
  return value;
}

async function evalCall(
  call: Call,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  await context.checkCancelled(MACRO_SAFE_POINTS.beforeCall(call.name));
  const { positional, named } = await evalCallArgs(call.args, env, context);

  if (call.name === 'exit') {
    if (Object.keys(named).length > 0 || positional.length > 1) {
      throw new MacroExpectedError('invalid_input', 'exit accepts at most one argument.', {
        reason: 'exit_argument_count',
        line: call.line,
      });
    }
    throw new MacroExitError(positional[0] ?? null, call.line);
  }

  if (call.name === 'fail') {
    if (
      Object.keys(named).length > 0 ||
      positional.length > 1 ||
      (positional.length === 1 && typeof positional[0] !== 'string')
    ) {
      throw new MacroExpectedError('invalid_input', 'fail accepts zero or one string argument.', {
        reason: 'fail_argument_shape',
        line: call.line,
      });
    }
    throw new MacroFailError(positional[0] ?? 'macro aborted', call.line);
  }

  const builtin = context.builtins[call.name];
  if (!builtin) {
    throw new MacroRuntimeError(`Unknown builtin: ${call.name}`, call.line, {
      reason: 'unknown_builtin',
      name: call.name,
    });
  }

  try {
    return await builtin(positional, named, context);
  } catch (error) {
    if (
      error instanceof MacroRuntimeError ||
      error instanceof MacroCancellationError ||
      error instanceof MacroExitError ||
      error instanceof MacroFailError ||
      error instanceof MacroExpectedError
    ) {
      throw error;
    }
    throw new MacroRuntimeError(error instanceof Error ? error.message : String(error), call.line, {
      reason: 'builtin_failed',
      name: call.name,
      underlying_error: serializeError(error),
    });
  }
}

async function evalCallArgs(
  args: Arg[],
  env: Env,
  context: MacroInvocationContext
): Promise<{ positional: MacroValue[]; named: MacroNamedArgs }> {
  const positional: MacroValue[] = [];
  const named: MacroNamedArgs = {};
  for (const arg of args) {
    if (arg.kind === 'PositionalArg') {
      positional.push(await evalExpr(arg.value, env, context));
    } else {
      named[arg.name] = await evalExpr(arg.value, env, context);
    }
  }
  return { positional, named };
}

async function evalObjectLit(
  objectLit: ObjectLit,
  env: Env,
  context: MacroInvocationContext
): Promise<Record<string, MacroValue>> {
  const output: Record<string, MacroValue> = {};
  for (const entry of objectLit.entries) {
    output[entry.key] = await evalExpr(entry.value, env, context);
  }
  return output;
}

async function evalFieldAccess(
  access: FieldAccess,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  const target = await evalExpr(access.target, env, context);
  return stepField(target, access.field);
}

function stepField(target: MacroValue, field: string): MacroValue {
  if (target === null || typeof target !== 'object' || Array.isArray(target)) {
    throw new MacroRuntimeError(`Cannot access .${field} on ${describeValue(target)}.`, undefined, {
      reason: 'invalid_field_target',
      field,
    });
  }
  if (!Object.prototype.hasOwnProperty.call(target, field)) {
    throw new MacroRuntimeError(`Missing field .${field}.`, undefined, {
      reason: 'missing_field',
      field,
    });
  }
  return target[field];
}

async function evalRange(
  startExpr: Expr,
  endExpr: Expr,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue[]> {
  const start = await evalExpr(startExpr, env, context);
  const end = await evalExpr(endExpr, env, context);
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isInteger(start) ||
    !Number.isInteger(end)
  ) {
    throw new MacroRuntimeError('Range operands must be integers.', undefined, {
      reason: 'range_operand_type_mismatch',
    });
  }
  return buildRange(start, end, start <= end ? 1 : -1);
}

async function evalBinaryExpr(
  expr: Extract<Expr, { kind: 'BinaryExpr' }>,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  if (expr.op === '&&') {
    const left = await evalExpr(expr.left, env, context);
    return isTruthy(left) && isTruthy(await evalExpr(expr.right, env, context));
  }
  if (expr.op === '||') {
    const left = await evalExpr(expr.left, env, context);
    return isTruthy(left) || isTruthy(await evalExpr(expr.right, env, context));
  }

  const left = await evalExpr(expr.left, env, context);
  const right = await evalExpr(expr.right, env, context);

  if (expr.op === '==') return deepEqual(left, right);
  if (expr.op === '!=') return !deepEqual(left, right);

  if (typeof left !== 'number' || typeof right !== 'number') {
    throw new MacroRuntimeError('Ordering comparisons require numeric operands.', undefined, {
      reason: 'comparison_type_mismatch',
      op: expr.op,
    });
  }

  switch (expr.op) {
    case '<':
      return left < right;
    case '<=':
      return left <= right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
  }
}

async function evalToolCall(
  call: ToolCall,
  env: Env,
  context: MacroInvocationContext
): Promise<MacroValue> {
  const arg = await evalToolArg(call, env, context);
  await context.checkCancelled(MACRO_SAFE_POINTS.beforeToolCall(call.server, call.tool));
  const toolName = `${call.server}.${call.tool}`;
  const isModelCall = call.server === 'fq' && call.tool === 'call_model';
  const isExternalToolCall = call.server !== 'fq';
  if (isModelCall) {
    context.budgetTracker.beforeModelCall();
    await context.progressEmitter.emitModelCallStart(toolName);
  } else {
    if (isExternalToolCall) context.budgetTracker.beforeExternalToolCall();
    await context.progressEmitter.emitToolCallStart(toolName);
  }
  if (!context.toolRegistry && !context.dispatchTool) {
    throw new MacroRuntimeError(
      `No tool dispatcher configured for ${call.server}.${call.tool}.`,
      call.line,
      {
        reason: 'tool_dispatcher_missing',
        server: call.server,
        tool: call.tool,
        line: call.line,
      }
    );
  }

  if (context.toolRegistry && context.allowedToolNames) {
    const dispatched = await dispatchMacroTool({
      registry: context.toolRegistry,
      allowlist: context.allowedToolNames,
      server: call.server,
      tool: call.tool,
      arg,
      context,
    });
    if (isToolResult(dispatched)) {
      throwExpectedToolResult(dispatched);
    }
    if (isModelCall) {
      context.budgetTracker.afterModelCall(extractTokenUsage(dispatched));
      await context.progressEmitter.emitModelCallFinish(toolName);
    }
    context.budgetTracker.checkTimeout();
    pushTrace(context, {
      kind: isModelCall ? 'model_call' : 'tool_call',
      name: toolName,
      args: arg,
      result: dispatched,
    });
    return dispatched;
  }

  let result: ToolResult;
  try {
    result = await context.dispatchTool(call.server, call.tool, arg, context);
  } catch (error) {
    throw new MacroRuntimeError(`Tool call failed: ${call.server}.${call.tool}`, call.line, {
      server: call.server,
      tool: call.tool,
      line: call.line,
      underlying_error: serializeError(error),
    });
  }

  const parsed = parseToolResultPayload(result);
  if (result.isError === true) {
    throw new MacroRuntimeError(`Tool call failed: ${call.server}.${call.tool}`, call.line, {
      server: call.server,
      tool: call.tool,
      line: call.line,
      underlying_error: parsed,
    });
  }

  if (isModelCall) {
    context.budgetTracker.afterModelCall(extractTokenUsage(parsed));
    await context.progressEmitter.emitModelCallFinish(toolName);
  }
  context.budgetTracker.checkTimeout();
  pushTrace(context, {
    kind: isModelCall ? 'model_call' : 'tool_call',
    name: toolName,
    args: arg,
    result: parsed,
  });
  return coerceMacroValue(parsed);
}

async function evalToolArg(
  call: ToolCall,
  env: Env,
  context: MacroInvocationContext
): Promise<Record<string, MacroValue>> {
  if (!call.arg) {
    return {};
  }
  const value = await evalExpr(call.arg, env, context);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MacroRuntimeError('Tool argument must evaluate to an object.', call.line, {
      reason: 'tool_argument_type_mismatch',
      server: call.server,
      tool: call.tool,
      line: call.line,
    });
  }
  return value;
}

async function evalToolExists(
  expr: Extract<Expr | Statement, { kind: 'ToolExistsCall' }>,
  context: MacroInvocationContext
): Promise<MacroValue> {
  const exists = await resolveNamespaceIntrospection(expr.server, expr.method, context.broker, {
    line: expr.line,
  });
  if (expr.server !== 'fq' && exists === false && !context.warnings.includes('broker_unavailable')) {
    context.warnings.push('broker_unavailable');
  }
  return exists;
}

function interpolate(raw: string, env: Env): string {
  return raw
    .replace(
      /\$\{([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)\}/g,
      (_match, path: string) => stringifyMacroValue(resolvePath(path, env))
    )
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*)/g, (_match, path: string) =>
      stringifyMacroValue(resolvePath(path, env))
    )
    .replaceAll(ESCAPED_DOLLAR_SENTINEL, '$');
}

function resolvePath(path: string, env: Env): MacroValue {
  const [name, ...fields] = path.split('.');
  if (!name) {
    throw new MacroRuntimeError('Interpolation path is empty.', undefined, {
      reason: 'empty_interpolation_path',
    });
  }
  let value = env.get(name);
  for (const field of fields) {
    value = stepField(value, field);
  }
  return value;
}

function stringifyMacroValue(value: MacroValue): string {
  if (typeof value === 'string') return value;
  if (value === null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function buildSuccessPayload(context: MacroInvocationContext, result: MacroValue) {
  const payload: Record<string, unknown> = {
    task_id: context.taskId,
    result,
  };
  if (context.traceMode !== 'none' && context.trace.length > 0) {
    payload.trace = context.trace;
  }
  if (context.budget.model_calls > 0) {
    payload.token_total = context.budget.token_total;
    payload.model_calls = context.budget.model_calls;
  }
  if (context.budget.external_tool_calls > 0) {
    payload.external_tool_calls = context.budget.external_tool_calls;
  }
  return withWarnings(payload, context.warnings);
}

function pushTrace(context: MacroInvocationContext, step: Omit<TraceStep, 'at'>): void {
  context.traceBuilder.add(step);
}

function parseToolResultPayload(result: ToolResult): unknown {
  const text = result.content[0]?.text ?? 'null';
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function isToolResult(value: unknown): value is ToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { content?: unknown }).content)
  );
}

function extractTokenUsage(value: unknown): number {
  if (!isRecord(value)) return 0;
  const metadata = value['metadata'];
  if (!isRecord(metadata)) return 0;
  const tokens = metadata['tokens'];
  if (isRecord(tokens)) {
    return toNumber(tokens['input']) + toNumber(tokens['output']);
  }
  const cumulative = metadata['trace_cumulative'];
  if (isRecord(cumulative) && isRecord(cumulative['total_tokens'])) {
    const total = cumulative['total_tokens'];
    return toNumber(total['input']) + toNumber(total['output']);
  }
  return 0;
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function throwExpectedToolResult(result: ToolResult): never {
  const parsed = parseToolResultPayload(result);
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const envelope = parsed as Record<string, unknown>;
    throw new MacroExpectedError(
      typeof envelope.error === 'string' ? envelope.error : 'invalid_input',
      typeof envelope.message === 'string' ? envelope.message : 'Macro preflight failed.',
      isRecord(envelope.details) ? envelope.details : undefined
    );
  }
  throw new MacroExpectedError('invalid_input', 'Macro preflight failed.', {
    response: parsed,
  });
}

function coerceMacroValue(value: unknown): MacroValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(coerceMacroValue);
  }
  if (typeof value === 'object') {
    const output: Record<string, MacroValue> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = coerceMacroValue(child);
    }
    return output;
  }
  throw new MacroRuntimeError('Unsupported macro value type.', undefined, {
    reason: 'unsupported_value_type',
    value_type: typeof value,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneMacroObject(input: Record<string, MacroValue>): Record<string, MacroValue> {
  return coerceMacroValue(structuredClone(input)) as Record<string, MacroValue>;
}

function deepEqual(left: MacroValue, right: MacroValue): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function describeValue(value: MacroValue): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  return typeof value;
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  if (typeof error === 'object' && error !== null) {
    return error as Record<string, unknown>;
  }
  return { message: String(error) };
}
