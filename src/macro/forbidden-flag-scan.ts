import { MacroExpectedError } from './evaluator.js';
import type { Arg, Call, Expr, Pipeline, Program, Statement } from './types.js';

type ForbiddenVerb = 'sed' | 'find';
type ForbiddenReason =
  | 'sed_in_place_mutates_files'
  | 'find_exec_mutates_or_executes'
  | 'find_delete_mutates_files';

export function preScanForbiddenShellFlags(program: Program): void {
  program.statements.forEach(visitStatement);
}

function visitStatement(statement: Statement): void {
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
}

function visitExpr(expr: Expr): void {
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
}

function visitPipeline(pipeline: Pipeline): void {
  pipeline.stages.forEach(visitCall);
}

function visitCall(call: Call): void {
  call.args.forEach((arg) => visitExpr(arg.value));

  if (call.name === 'sed') {
    scanSedCall(call);
    return;
  }
  if (call.name === 'find') {
    scanFindCall(call);
  }
}

function scanSedCall(call: Call): void {
  for (const arg of call.args) {
    const namedFlag = namedFlagImage(arg);
    if (namedFlag && isSedInPlaceFlag(namedFlag, arg)) {
      throwForbiddenFlag('sed', namedFlag, 'sed_in_place_mutates_files', call.line);
    }

    const positionalFlag = positionalStringFlag(arg);
    if (positionalFlag && isSedInPlacePositionalFlag(positionalFlag)) {
      throwForbiddenFlag('sed', positionalFlag, 'sed_in_place_mutates_files', call.line);
    }
  }
}

function scanFindCall(call: Call): void {
  for (const arg of call.args) {
    const namedFlag = namedFlagImage(arg);
    if (namedFlag === '-exec' || namedFlag === '--exec') {
      throwForbiddenFlag('find', namedFlag, 'find_exec_mutates_or_executes', call.line);
    }
    if (namedFlag === '-delete' || namedFlag === '--delete') {
      throwForbiddenFlag('find', namedFlag, 'find_delete_mutates_files', call.line);
    }

    const positionalFlag = positionalStringFlag(arg);
    if (positionalFlag === '-exec' || positionalFlag === '--exec') {
      throwForbiddenFlag('find', positionalFlag, 'find_exec_mutates_or_executes', call.line);
    }
    if (positionalFlag === '-delete' || positionalFlag === '--delete') {
      throwForbiddenFlag('find', positionalFlag, 'find_delete_mutates_files', call.line);
    }
  }
}

function namedFlagImage(arg: Arg): string | null {
  if (arg.kind !== 'NamedArg') return null;
  return arg.rawShortFlag ?? `--${arg.name}`;
}

function positionalStringFlag(arg: Arg): string | null {
  if (arg.kind !== 'PositionalArg' || arg.value.kind !== 'StringLit') return null;
  return arg.value.raw;
}

function isSedInPlaceFlag(flag: string, arg: Arg): boolean {
  if (arg.kind !== 'NamedArg') return false;
  if (arg.rawShortFlag) {
    return arg.rawShortFlag.startsWith('-') && arg.rawShortFlag.slice(1).includes('i');
  }
  return arg.name === 'i' || arg.name === 'in-place';
}

function isSedInPlacePositionalFlag(flag: string): boolean {
  return flag === '--i' || flag === '--in-place' || flag === '-i' || flag.startsWith('-i');
}

function throwForbiddenFlag(
  verb: ForbiddenVerb,
  flag: string,
  reason: ForbiddenReason,
  line: number
): never {
  throw new MacroExpectedError('forbidden_shell_flag', 'Macro shell flag is forbidden.', {
    verb,
    flag,
    reason,
    line,
  });
}
