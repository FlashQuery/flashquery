import type {
  Arg,
  Call,
  Expr,
  ListLit,
  ObjectLit,
  Pipeline,
  Program,
  Statement,
} from './types.js';
import type { MacroValue } from './evaluator.js';

export type InputVarDefault = MacroValue;

export interface InputVarContract {
  required: string[];
  optional: Record<string, InputVarDefault>;
}

export class MacroPreflightError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'MacroPreflightError';
  }
}

export function preflightProgram(program: Program): void {
  for (const statement of program.statements) {
    preflightStatement(statement);
  }
}

function preflightStatement(statement: Statement): void {
  switch (statement.kind) {
    case 'Binding':
      preflightExpr(statement.value);
      return;
    case 'Pipeline':
      preflightPipeline(statement);
      return;
    case 'ToolCall':
      if (statement.arg) preflightExpr(statement.arg);
      return;
    case 'ToolExistsCall':
      return;
    case 'ForLoop':
      preflightExpr(statement.iterable);
      statement.body.forEach(preflightStatement);
      return;
    case 'WhileLoop':
      preflightExpr(statement.condition);
      statement.body.forEach(preflightStatement);
      return;
    case 'IfStmt':
      preflightExpr(statement.condition);
      statement.thenBody.forEach(preflightStatement);
      statement.elseBody?.forEach(preflightStatement);
      return;
  }
}

function preflightExpr(expr: Expr): void {
  switch (expr.kind) {
    case 'StringLit':
    case 'NumLit':
    case 'NullLit':
    case 'VarRef':
    case 'ToolExistsCall':
      return;
    case 'ListLit':
      expr.items.forEach(preflightExpr);
      return;
    case 'ObjectLit':
      expr.entries.forEach((entry) => preflightExpr(entry.value));
      return;
    case 'FieldAccess':
      preflightExpr(expr.target);
      return;
    case 'RangeExpr':
      preflightExpr(expr.start);
      preflightExpr(expr.end);
      return;
    case 'BinaryExpr':
      preflightExpr(expr.left);
      preflightExpr(expr.right);
      return;
    case 'UnaryExpr':
      preflightExpr(expr.expr);
      return;
    case 'Call':
      preflightCall(expr);
      return;
    case 'Pipeline':
      preflightPipeline(expr);
      return;
    case 'ToolCall':
      if (expr.arg) preflightExpr(expr.arg);
      return;
  }
}

function preflightPipeline(pipeline: Pipeline): void {
  pipeline.stages.forEach(preflightCall);
}

function preflightCall(call: Call): void {
  call.args.forEach((arg) => preflightExpr(arg.value));

  if (call.name === 'exit' && call.args.filter((arg) => arg.kind === 'PositionalArg').length > 1) {
    throw new MacroPreflightError('invalid_input', 'exit accepts at most one argument.', {
      reason: 'exit_argument_count',
      line: call.line,
    });
  }
}

export function collectInputVarContract(program: Program): InputVarContract {
  const required = new Set<string>();
  const optional = new Map<string, InputVarDefault>();

  const visitStatement = (statement: Statement): void => {
    switch (statement.kind) {
      case 'Binding':
        visitExpr(statement.value);
        return;
      case 'Pipeline':
        visitPipeline(statement);
        return;
      case 'ToolCall':
        if (statement.arg) visitExpr(statement.arg);
        return;
      case 'ToolExistsCall':
        return;
      case 'ForLoop':
        visitExpr(statement.iterable);
        statement.body.forEach(visitStatement);
        return;
      case 'WhileLoop':
        visitExpr(statement.condition);
        statement.body.forEach(visitStatement);
        return;
      case 'IfStmt':
        visitExpr(statement.condition);
        statement.thenBody.forEach(visitStatement);
        statement.elseBody?.forEach(visitStatement);
        return;
    }
  };

  const visitExpr = (expr: Expr): void => {
    switch (expr.kind) {
      case 'StringLit':
      case 'NumLit':
      case 'NullLit':
      case 'VarRef':
      case 'ToolExistsCall':
        return;
      case 'ListLit':
        expr.items.forEach(visitExpr);
        return;
      case 'ObjectLit':
        expr.entries.forEach((entry) => visitExpr(entry.value));
        return;
      case 'FieldAccess':
        visitExpr(expr.target);
        return;
      case 'RangeExpr':
        visitExpr(expr.start);
        visitExpr(expr.end);
        return;
      case 'BinaryExpr':
        visitExpr(expr.left);
        visitExpr(expr.right);
        return;
      case 'UnaryExpr':
        visitExpr(expr.expr);
        return;
      case 'Call':
        visitCall(expr);
        return;
      case 'Pipeline':
        visitPipeline(expr);
        return;
      case 'ToolCall':
        if (expr.arg) visitExpr(expr.arg);
        return;
    }
  };

  const visitPipeline = (pipeline: Pipeline): void => {
    pipeline.stages.forEach(visitCall);
  };

  const visitCall = (call: Call): void => {
    call.args.forEach((arg) => visitExpr(arg.value));
    if (call.name !== 'input_var') {
      return;
    }

    const positionalArgs = call.args.filter((arg) => arg.kind === 'PositionalArg');
    if (positionalArgs.length !== 1) {
      throw new MacroPreflightError(
        'invalid_input',
        'input_var expects exactly one positional argument.',
        { reason: 'input_var_argument_count', line: call.line }
      );
    }

    const unsupportedNamedArgs = call.args.filter(
      (arg): arg is Extract<Arg, { kind: 'NamedArg' }> =>
        arg.kind === 'NamedArg' && arg.name !== 'default'
    );
    if (unsupportedNamedArgs.length > 0) {
      throw new MacroPreflightError(
        'invalid_input',
        'input_var received unsupported named arguments.',
        {
          reason: 'input_var_named_argument',
          named_args: unsupportedNamedArgs.map((arg) => arg.name),
          line: call.line,
        }
      );
    }

    const keyArg = positionalArgs[0];
    if (keyArg?.kind !== 'PositionalArg' || keyArg.value.kind !== 'StringLit') {
      throw new MacroPreflightError(
        'invalid_input',
        'input_var first argument must be a string literal.',
        { reason: 'input_var_key_must_be_literal', line: call.line }
      );
    }

    const defaultArg = call.args.find(
      (arg): arg is Extract<Arg, { kind: 'NamedArg' }> =>
        arg.kind === 'NamedArg' && arg.name === 'default'
    );
    const key = keyArg.value.raw;
    if (defaultArg) {
      optional.set(key, literalToMacroValue(defaultArg.value, call.line));
      required.delete(key);
      return;
    }
    if (!optional.has(key)) {
      required.add(key);
    }
  };

  program.statements.forEach(visitStatement);
  return { required: [...required], optional: Object.fromEntries(optional) };
}

export function validateInputVars(
  contract: InputVarContract,
  inputVars: Record<string, MacroValue>
): void {
  const requiredInputs = contract.required;
  const optionalInputs = Object.keys(contract.optional);
  const providedInputs = Object.keys(inputVars);
  const missingInputs = requiredInputs.filter(
    (key) => !Object.prototype.hasOwnProperty.call(inputVars, key)
  );

  if (missingInputs.length > 0) {
    throw new MacroPreflightError(
      'invalid_input',
      `Macro is missing required input(s): ${missingInputs.join(', ')}.`,
      {
        required_inputs: requiredInputs,
        optional_inputs: optionalInputs,
        provided_inputs: providedInputs,
        missing_inputs: missingInputs,
      }
    );
  }
}

function literalToMacroValue(expr: Expr, line: number): InputVarDefault {
  switch (expr.kind) {
    case 'StringLit':
      return expr.raw;
    case 'NumLit':
      return expr.value;
    case 'NullLit':
      return null;
    case 'ListLit':
      return listLiteralToMacroValue(expr, line);
    case 'ObjectLit':
      return objectLiteralToMacroValue(expr, line);
    default:
      throw new MacroPreflightError(
        'invalid_input',
        'input_var default must be a literal value.',
        { reason: 'input_var_default_must_be_literal', line }
      );
  }
}

function listLiteralToMacroValue(expr: ListLit, line: number): MacroValue[] {
  return expr.items.map((item) => literalToMacroValue(item, line));
}

function objectLiteralToMacroValue(expr: ObjectLit, line: number): Record<string, MacroValue> {
  const output: Record<string, MacroValue> = {};
  for (const entry of expr.entries) {
    output[entry.key] = literalToMacroValue(entry.value, line);
  }
  return output;
}
