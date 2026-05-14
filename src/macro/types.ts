import type { MacroParseErrorEnvelope } from './errors.js';
import type { MacroInvocationContext, MacroValue } from './evaluator.js';

export type ToolFn = (arg: Record<string, MacroValue>, ctx: MacroInvocationContext) => MacroValue | Promise<MacroValue>;

export interface ServerEntry {
  label: string;
  tools: Record<string, ToolFn>;
}

export type ToolRegistry = Record<string, ServerEntry>;

export interface ToolReference {
  server: string;
  tool: string;
  line?: number;
}

export interface MacroCallerContext {
  origin: 'host' | 'delegated';
  purposeName?: string;
}

export interface Program {
  kind: 'Program';
  statements: Statement[];
}

export type Statement =
  | Binding
  | Pipeline
  | ForLoop
  | WhileLoop
  | IfStmt
  | ToolCall
  | ToolExistsCall;

export interface Binding {
  kind: 'Binding';
  name: string;
  value: Expr;
  line: number;
}

export interface Pipeline {
  kind: 'Pipeline';
  stages: Call[];
  line: number;
}

export interface Call {
  kind: 'Call';
  name: string;
  args: Arg[];
  line: number;
}

export type Arg = NamedArg | PositionalArg;

export interface NamedArg {
  kind: 'NamedArg';
  name: string;
  value: Expr;
  rawShortFlag?: string;
}

export interface PositionalArg {
  kind: 'PositionalArg';
  value: Expr;
}

export interface ForLoop {
  kind: 'ForLoop';
  varName: string;
  iterable: Expr;
  body: Statement[];
  line: number;
}

export interface WhileLoop {
  kind: 'WhileLoop';
  condition: Expr;
  body: Statement[];
  line: number;
}

export interface IfStmt {
  kind: 'IfStmt';
  condition: Expr;
  thenBody: Statement[];
  elseBody: Statement[] | null;
  line: number;
}

export interface ToolCall {
  kind: 'ToolCall';
  server: string;
  tool: string;
  arg: ObjectLit | VarRef | FieldAccess | undefined;
  line: number;
}

export interface ToolExistsCall {
  kind: 'ToolExistsCall';
  server: string;
  method: string;
  line: number;
}

export type Expr =
  | StringLit
  | NumLit
  | NullLit
  | VarRef
  | ListLit
  | ObjectLit
  | FieldAccess
  | RangeExpr
  | BinaryExpr
  | UnaryExpr
  | Call
  | Pipeline
  | ToolCall
  | ToolExistsCall;

export interface StringLit {
  kind: 'StringLit';
  raw: string;
  interpolated: boolean;
}

export interface NumLit {
  kind: 'NumLit';
  value: number;
}

export interface NullLit {
  kind: 'NullLit';
}

export interface VarRef {
  kind: 'VarRef';
  name: string;
}

export interface ListLit {
  kind: 'ListLit';
  items: Expr[];
}

export interface ObjectLit {
  kind: 'ObjectLit';
  entries: ObjectEntry[];
}

export interface ObjectEntry {
  key: string;
  value: Expr;
}

export interface FieldAccess {
  kind: 'FieldAccess';
  target: VarRef | FieldAccess | ToolCall | ToolExistsCall;
  field: string;
}

export interface RangeExpr {
  kind: 'RangeExpr';
  start: Expr;
  end: Expr;
}

export interface BinaryExpr {
  kind: 'BinaryExpr';
  op: '==' | '!=' | '<' | '>' | '<=' | '>=' | '&&' | '||';
  left: Expr;
  right: Expr;
}

export interface UnaryExpr {
  kind: 'UnaryExpr';
  op: '!';
  expr: Expr;
}

export interface MacroSourceBlock {
  name: string | null;
  source: string;
  openingLine: number;
}

export type MacroParseResult =
  | { ok: true; program: Program }
  | { ok: false; error: MacroParseErrorEnvelope };
