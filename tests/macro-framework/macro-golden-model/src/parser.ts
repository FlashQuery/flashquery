import { CstParser, type CstNode, type IToken } from "chevrotain";
import {
  allTokens,
  AndAnd,
  Bang,
  Break,
  Colon,
  Comma,
  Continue,
  Do,
  Done,
  Dot,
  DotDot,
  DoubleQuotedString,
  Else,
  EqEq,
  Equals,
  FalseTok,
  Fi,
  For,
  GtEq,
  Gt,
  Identifier,
  If,
  In,
  LBrace,
  LBracket,
  LongFlag,
  LParen,
  LtEq,
  Lt,
  Newline,
  NotEq,
  NullTok,
  NumberLit,
  OrOr,
  Pipe,
  RBrace,
  RBracket,
  RParen,
  ShortFlag,
  SingleQuotedString,
  Then,
  TrueTok,
  VarRefTok,
  While,
  longFlagName,
  shortFlagLetters,
  unquoteDouble,
  unquoteSingle,
  varRefName,
  macroLexer,
} from "./lexer.ts";
import type {
  Arg,
  BinaryOp,
  Binding,
  BoolLit,
  BreakStmt,
  Call,
  ContinueStmt,
  Expr,
  FieldAccess,
  ForLoop,
  IfStmt,
  ListLit,
  NamedArg,
  Negation,
  NullLit,
  NumLit,
  ObjectEntry,
  ObjectLit,
  Pipeline,
  PositionalArg,
  Program,
  RangeOp,
  Statement,
  StringLit,
  ToolCall,
  VarRef,
  WhileLoop,
} from "./types.ts";

// ParseError canonical reason codes (REQ-018 / item 1). The full spec set is
// documented in §B-REQ-018; the golden enumerates the strings the evaluator/
// parser actually emit.
export type ParseErrorReason =
  | "unexpected_token"
  | "missing_done"
  | "missing_then"
  | "missing_fi"
  | "missing_do"
  | "malformed_fence_attributes"
  | "reserved_keyword_assignment"
  | "builtin_name_shadowing"
  | "invalid_literal"
  | "input_var_key_must_be_literal"
  | "lexer_error"
  // Tier 2 (Macro Testing Framework v0.2):
  | "loop_control_outside_loop"  // REQ-104: continue/break outside a for/while body
  | "assign_to_self";            // REQ-103: _self.* is read-only at parse time

export type ParseErrorDetail = {
  reason: ParseErrorReason;
  at_line: number;
  near_token?: string;
  message: string;
};

// Spec envelope (per REQ-018, item 1): an array of `{reason, at_line,
// near_token?}` objects. Carries a friendly multi-line message for human
// display alongside the structured `errors` array.
export class ParseError extends Error {
  constructor(message: string, public readonly errors: ParseErrorDetail[]) {
    super(message);
    this.name = "ParseError";
  }
}

// Names that must NOT be assigned to (REQ-010 ac1, item 7). Builtin shadowing
// rejection. The set mirrors the keys exported from `builtins.ts` plus the
// shell verbs plus `input_var`. Kept here to avoid an evaluator/parser cyclic
// import; the test in `enforceBuiltinShadowing` reads from this list.
export const BUILTIN_NAMES = new Set<string>([
  // Operators
  "echo", "count", "unique", "append", "concat", "range",
  "add", "sub", "mul", "div", "mod",
  // Termination
  "fail", "exit",
  // Tasks / progress
  "status", "task_id", "list_tasks",
  // Sleep / slow_op
  "sleep", "slow_op",
  // Shell verbs
  "grep", "find", "sed", "cat", "wc", "head", "tail", "ls",
  // Input contract
  "input_var",
  // Tier 2: termination extension (REQ-105). Macro-callable builtin that
  // raises `MacroNeedsUserInputError`. Named here so binding LHS may not
  // shadow it.
  "needs_user_input",
]);

// Reserved keywords (REQ-018) — assignment LHS may not be one of these.
const RESERVED_KEYWORDS = new Set<string>([
  "for", "in", "done", "do", "while",
  "if", "then", "else", "fi",
  "null", "true", "false",
  // Tier 2 (REQ-104): loop-control keywords cannot be assignment targets.
  "continue", "break",
  // Tier 2 (REQ-103): the engine-bound `_self` is read-only. Bare `_self =`
  // assignment is rejected here; `_self.*` dotted-LHS assignment is
  // syntactically rejected at the grammar level (there's no LHS-dotted
  // form in the binding rule). Subfield-access assignment would require a
  // new grammar production, so this check covers the only path the
  // current grammar admits.
  "_self",
]);

// ----- Chevrotain parser -----

class MacroParser extends CstParser {
  constructor() {
    super(allTokens, {
      recoveryEnabled: false,
      maxLookahead: 3,
    });
    this.performSelfAnalysis();
  }

  public program = this.RULE("program", () => {
    this.MANY(() => this.CONSUME(Newline));
    this.MANY2(() => {
      this.SUBRULE(this.statement);
      this.MANY3(() => this.CONSUME2(Newline));
    });
  });

  private statement = this.RULE("statement", () => {
    this.OR([
      { ALT: () => this.SUBRULE(this.forLoop) },
      { ALT: () => this.SUBRULE(this.whileLoop) },
      { ALT: () => this.SUBRULE(this.ifStmt) },
      // Tier 2 / REQ-104: `continue` and `break` loop-control statements.
      // The parser accepts them anywhere (so the source line can be
      // captured); `enforceStaticChecks` rejects them outside a loop body.
      { ALT: () => this.SUBRULE(this.continueStmt) },
      { ALT: () => this.SUBRULE(this.breakStmt) },
      {
        GATE: () => this.LA(2).tokenType === Equals,
        ALT: () => this.SUBRULE(this.binding),
      },
      // Statement-position tool call.
      {
        GATE: () =>
          this.LA(1).tokenType === Identifier &&
          this.LA(2).tokenType === Dot &&
          this.LA(3).tokenType === Identifier,
        ALT: () => this.SUBRULE(this.toolCall),
      },
      { ALT: () => this.SUBRULE(this.pipeline) },
    ]);
  });

  // Tier 2 (REQ-104): bare `continue` / `break` statements. Grammar accepts
  // them anywhere; semantic validation rejects them outside a loop body
  // (see enforceStaticChecks).
  private continueStmt = this.RULE("continueStmt", () => {
    this.CONSUME(Continue);
  });
  private breakStmt = this.RULE("breakStmt", () => {
    this.CONSUME(Break);
  });

  private binding = this.RULE("binding", () => {
    this.CONSUME(Identifier);
    this.CONSUME(Equals);
    this.SUBRULE(this.rhsExpr);
  });

  private rhsExpr = this.RULE("rhsExpr", () => {
    this.OR([
      {
        GATE: () =>
          this.LA(1).tokenType === Identifier &&
          this.LA(2).tokenType === Dot &&
          this.LA(3).tokenType === Identifier,
        ALT: () => this.SUBRULE(this.toolCall),
      },
      {
        GATE: () => this.LA(1).tokenType === Identifier,
        ALT: () => this.SUBRULE(this.pipeline),
      },
      // Expression with possible binary operators (comparison / range /
      // boolean combinator). The expression rule handles `..` natively.
      { ALT: () => this.SUBRULE(this.exprWithOps) },
    ]);
  });

  // Boolean OR (lowest precedence in binary ops).
  private exprWithOps = this.RULE("exprWithOps", () => {
    this.SUBRULE(this.andExpr);
    this.MANY(() => {
      this.CONSUME(OrOr);
      this.SUBRULE2(this.andExpr);
    });
  });

  // Boolean AND.
  private andExpr = this.RULE("andExpr", () => {
    this.SUBRULE(this.compareExpr);
    this.MANY(() => {
      this.CONSUME(AndAnd);
      this.SUBRULE2(this.compareExpr);
    });
  });

  // Comparison operators (==, !=, <, >, <=, >=). Non-associative — left-to-right
  // chain repeats are valid syntactically (we don't gate that here).
  private compareExpr = this.RULE("compareExpr", () => {
    this.SUBRULE(this.rangeExpr);
    this.MANY(() => {
      this.OR([
        { ALT: () => this.CONSUME(EqEq) },
        { ALT: () => this.CONSUME(NotEq) },
        { ALT: () => this.CONSUME(LtEq) },
        { ALT: () => this.CONSUME(GtEq) },
        { ALT: () => this.CONSUME(Lt) },
        { ALT: () => this.CONSUME(Gt) },
      ]);
      this.SUBRULE2(this.rangeExpr);
    });
  });

  // Range op: `<start>..<end>` (binary). Higher precedence than comparison so
  // `1..5 == ...` would parse left as `1..5`.
  private rangeExpr = this.RULE("rangeExpr", () => {
    this.SUBRULE(this.primary);
    this.OPTION(() => {
      this.CONSUME(DotDot);
      this.SUBRULE2(this.primary);
    });
  });

  // Tool call: namespace.tool({...}).
  private toolCall = this.RULE("toolCall", () => {
    this.CONSUME(Identifier, { LABEL: "server" });
    this.CONSUME(Dot);
    this.CONSUME2(Identifier, { LABEL: "tool" });
    this.CONSUME(LParen);
    this.OPTION(() => {
      this.OR([
        { ALT: () => this.SUBRULE(this.objectLit) },
        { ALT: () => this.SUBRULE(this.varOrField) },
      ]);
    });
    this.CONSUME(RParen);
  });

  // Object literal: { key1: value1, key2: value2, ... } — trailing comma OK.
  private objectLit = this.RULE("objectLit", () => {
    this.CONSUME(LBrace);
    this.MANY(() => this.CONSUME(Newline));
    this.OPTION(() => {
      this.SUBRULE(this.objectEntry);
      this.MANY2(() => {
        this.CONSUME(Comma);
        this.MANY3(() => this.CONSUME2(Newline));
        this.SUBRULE2(this.objectEntry);
      });
      this.MANY4(() => this.CONSUME3(Newline));
      this.OPTION2(() => this.CONSUME2(Comma));
      this.MANY5(() => this.CONSUME4(Newline));
    });
    this.CONSUME(RBrace);
  });

  private objectEntry = this.RULE("objectEntry", () => {
    this.OR([
      { ALT: () => this.CONSUME(Identifier) },
      { ALT: () => this.CONSUME(DoubleQuotedString) },
      { ALT: () => this.CONSUME(SingleQuotedString) },
    ]);
    this.CONSUME(Colon);
    this.SUBRULE(this.primary);
  });

  // pipeline := call (Pipe call)*
  private pipeline = this.RULE("pipeline", () => {
    this.SUBRULE(this.call);
    this.MANY(() => {
      this.CONSUME(Pipe);
      this.SUBRULE2(this.call);
    });
  });

  private call = this.RULE("call", () => {
    this.CONSUME(Identifier);
    this.MANY(() => this.SUBRULE(this.arg));
  });

  // for X in <iterable> do <body> done — REQ-016 (item 17).
  private forLoop = this.RULE("forLoop", () => {
    this.CONSUME(For);
    this.CONSUME(Identifier);
    this.CONSUME(In);
    this.SUBRULE(this.iterable);
    this.CONSUME(Do);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(Done);
  });

  // while <condition> do <body> done — REQ-015 (item 17).
  private whileLoop = this.RULE("whileLoop", () => {
    this.CONSUME(While);
    this.SUBRULE(this.condition);
    this.CONSUME(Do);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block);
    this.CONSUME(Done);
  });

  private ifStmt = this.RULE("ifStmt", () => {
    this.CONSUME(If);
    this.SUBRULE(this.condition);
    this.CONSUME(Then);
    this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    this.SUBRULE(this.block, { LABEL: "thenBlock" });
    this.OPTION(() => {
      this.CONSUME(Else);
      this.AT_LEAST_ONE2(() => this.CONSUME2(Newline));
      this.SUBRULE2(this.block, { LABEL: "elseBlock" });
    });
    this.CONSUME(Fi);
  });

  private block = this.RULE("block", () => {
    this.MANY(() => {
      this.SUBRULE(this.statement);
      this.AT_LEAST_ONE(() => this.CONSUME(Newline));
    });
  });

  // Iterable: either a $var/$obj.field, a list literal, or a range expression
  // (`<start>..<end>`). The range form is detected by lookahead.
  private iterable = this.RULE("iterable", () => {
    this.OR([
      {
        GATE: () => this.LA(1).tokenType === LBracket,
        ALT: () => this.SUBRULE(this.listLit),
      },
      { ALT: () => this.SUBRULE(this.rangeOrPrimary) },
    ]);
  });

  // Iterable primary — a single primary or a range. Used by `for X in N..M`.
  private rangeOrPrimary = this.RULE("rangeOrPrimary", () => {
    this.SUBRULE(this.primary);
    this.OPTION(() => {
      this.CONSUME(DotDot);
      this.SUBRULE2(this.primary);
    });
  });

  // condition := (boolean expression) — uses exprWithOps so `&&`/`||`/`==`
  // can appear in `if` / `while` conditions. Optional leading `!` negation
  // remains supported.
  private condition = this.RULE("condition", () => {
    this.OPTION(() => this.CONSUME(Bang));
    this.SUBRULE(this.exprWithOps);
  });

  private arg = this.RULE("arg", () => {
    this.OR([
      {
        ALT: () => {
          this.CONSUME(LongFlag);
          this.SUBRULE(this.primary);
        },
      },
      { ALT: () => this.CONSUME(ShortFlag) },
      { ALT: () => this.SUBRULE2(this.primary) },
    ]);
  });

  private primary = this.RULE("primary", () => {
    this.OR([
      { ALT: () => this.CONSUME(DoubleQuotedString) },
      { ALT: () => this.CONSUME(SingleQuotedString) },
      { ALT: () => this.CONSUME(NumberLit) },
      { ALT: () => this.CONSUME(NullTok) },
      { ALT: () => this.CONSUME(TrueTok) },
      { ALT: () => this.CONSUME(FalseTok) },
      {
        GATE: () =>
          this.LA(1).tokenType === Identifier &&
          this.LA(2).tokenType === Dot &&
          this.LA(3).tokenType === Identifier,
        ALT: () => this.SUBRULE(this.toolCall),
      },
      { ALT: () => this.SUBRULE(this.varOrField) },
      { ALT: () => this.SUBRULE(this.listLit) },
      { ALT: () => this.SUBRULE(this.objectLit) },
    ]);
  });

  private varOrField = this.RULE("varOrField", () => {
    this.CONSUME(VarRefTok);
    this.MANY(() => {
      this.CONSUME(Dot);
      this.CONSUME(Identifier);
    });
  });

  // List literal — REQ-011 ac3 (item 6): trailing comma now accepted.
  private listLit = this.RULE("listLit", () => {
    this.CONSUME(LBracket);
    this.MANY(() => this.CONSUME(Newline));
    this.OPTION(() => {
      this.SUBRULE(this.primary);
      this.MANY2(() => {
        this.CONSUME(Comma);
        this.MANY3(() => this.CONSUME2(Newline));
        this.SUBRULE2(this.primary);
      });
      this.MANY4(() => this.CONSUME3(Newline));
      this.OPTION2(() => this.CONSUME2(Comma));
      this.MANY5(() => this.CONSUME4(Newline));
    });
    this.CONSUME(RBracket);
  });
}

const parserInstance = new MacroParser();

// ----- CST -> AST conversion -----

// Heuristic mapping from Chevrotain parser-error messages to a canonical
// reason code (REQ-018 / item 1). The reason set is small and the engine
// emits canonical strings.
function inferParseErrorReason(msg: string, nearToken?: string): ParseErrorReason {
  const m = msg.toLowerCase();
  if (m.includes("done")) return "missing_done";
  if (m.includes("then")) return "missing_then";
  if (m.includes("fi")) return "missing_fi";
  if (m.includes("expecting --> do")) return "missing_do";
  if (nearToken && BUILTIN_NAMES.has(nearToken)) return "builtin_name_shadowing";
  if (nearToken && RESERVED_KEYWORDS.has(nearToken)) return "reserved_keyword_assignment";
  return "unexpected_token";
}

export function parse(source: string): Program {
  const lexResult = macroLexer.tokenize(source);
  if (lexResult.errors.length > 0) {
    const errs: ParseErrorDetail[] = lexResult.errors.map((e) => ({
      reason: "lexer_error",
      at_line: e.line ?? 0,
      near_token: undefined,
      message: e.message,
    }));
    throw new ParseError(
      `Lexer errors:\n` +
        errs
          .map((e) => `  line ${e.at_line}: ${e.message}`)
          .join("\n"),
      errs,
    );
  }

  parserInstance.input = lexResult.tokens;
  const cst = parserInstance.program();

  if (parserInstance.errors.length > 0) {
    const errs: ParseErrorDetail[] = parserInstance.errors.map((e) => {
      const tok = e.token;
      const isEof =
        !tok ||
        tok.image === "" ||
        (tok as { tokenType?: { name?: string } }).tokenType?.name === "EOF";
      const line = Number.isFinite(tok?.startLine) ? (tok.startLine as number) : 0;
      const nearToken = tok?.image && !isEof ? tok.image : undefined;
      const reason = inferParseErrorReason(e.message, nearToken);
      return {
        reason,
        at_line: line,
        near_token: nearToken,
        message: e.message + (isEof ? " (at end of input)" : ""),
      };
    });
    const fmt = (e: ParseErrorDetail) =>
      e.at_line > 0
        ? `line ${e.at_line}${e.near_token ? ` near '${e.near_token}'` : ""}`
        : "end of input";
    throw new ParseError(
      `Parser errors:\n` + errs.map((e) => `  ${fmt(e)} [${e.reason}]: ${e.message}`).join("\n"),
      errs,
    );
  }

  const program = cstToAst(cst);
  // Post-parse static checks (run before evaluator):
  //   - Builtin-name shadowing (item 7 / REQ-010)
  //   - input_var literal-key rejection (item 11 / REQ-007 ac1)
  enforceStaticChecks(program);
  return program;
}

// ----- CST node accessors -----

type Children = Record<string, Array<CstNode | IToken> | undefined>;

function getRule(node: CstNode, name: string, idx = 0): CstNode | undefined {
  const arr = (node.children as Children)[name];
  if (!arr) return undefined;
  return arr[idx] as CstNode | undefined;
}
function getRules(node: CstNode, name: string): CstNode[] {
  const arr = (node.children as Children)[name];
  return (arr as CstNode[] | undefined) ?? [];
}
function getTok(node: CstNode, name: string, idx = 0): IToken | undefined {
  const arr = (node.children as Children)[name];
  if (!arr) return undefined;
  return arr[idx] as IToken | undefined;
}
function getToks(node: CstNode, name: string): IToken[] {
  const arr = (node.children as Children)[name];
  return (arr as IToken[] | undefined) ?? [];
}

function cstToAst(programCst: CstNode): Program {
  const statementsCst = getRules(programCst, "statement");
  const statements = statementsCst.map(convertStatement);
  return { kind: "Program", statements };
}

function convertStatement(node: CstNode): Statement {
  if (getRule(node, "forLoop")) return convertForLoop(getRule(node, "forLoop")!);
  if (getRule(node, "whileLoop")) return convertWhileLoop(getRule(node, "whileLoop")!);
  if (getRule(node, "ifStmt")) return convertIfStmt(getRule(node, "ifStmt")!);
  if (getRule(node, "continueStmt")) return convertContinueStmt(getRule(node, "continueStmt")!);
  if (getRule(node, "breakStmt")) return convertBreakStmt(getRule(node, "breakStmt")!);
  if (getRule(node, "binding")) return convertBinding(getRule(node, "binding")!);
  if (getRule(node, "toolCall")) return convertToolCall(getRule(node, "toolCall")!);
  if (getRule(node, "pipeline")) return convertPipeline(getRule(node, "pipeline")!);
  throw new Error("Unknown statement node");
}

// Tier 2 (REQ-104): convert the parser CST nodes for `continue` / `break`
// into AST nodes carrying the source line.
function convertContinueStmt(node: CstNode): ContinueStmt {
  const tok = getTok(node, "Continue")!;
  return { kind: "ContinueStmt", line: tok.startLine ?? 0 };
}
function convertBreakStmt(node: CstNode): BreakStmt {
  const tok = getTok(node, "Break")!;
  return { kind: "BreakStmt", line: tok.startLine ?? 0 };
}

function convertToolCall(node: CstNode): ToolCall {
  const serverTok = (node.children as Children).server?.[0] as IToken;
  const toolTok = (node.children as Children).tool?.[0] as IToken;
  if (!serverTok || !toolTok) {
    throw new Error("Tool call missing server or tool identifier");
  }
  const objCst = getRule(node, "objectLit");
  const varCst = getRule(node, "varOrField");
  let arg: ObjectLit | VarRef | undefined;
  if (objCst) {
    arg = convertObjectLit(objCst);
  } else if (varCst) {
    const v = convertVarOrField(varCst);
    if (v.kind !== "VarRef") {
      throw new Error(
        `Tool call argument must be an object literal or a bare $var (got field access)`,
      );
    }
    arg = v as VarRef;
  } else {
    arg = undefined;
  }
  return {
    kind: "ToolCall",
    server: serverTok.image,
    tool: toolTok.image,
    arg,
    line: serverTok.startLine ?? 0,
  };
}

function convertObjectLit(node: CstNode): ObjectLit {
  const entryCsts = getRules(node, "objectEntry");
  const entries: ObjectEntry[] = entryCsts.map(convertObjectEntry);
  return { kind: "ObjectLit", entries };
}

function convertObjectEntry(node: CstNode): ObjectEntry {
  const identTok = getTok(node, "Identifier");
  const dqTok = getTok(node, "DoubleQuotedString");
  const sqTok = getTok(node, "SingleQuotedString");
  let key: string;
  if (identTok) {
    key = identTok.image;
  } else if (dqTok) {
    key = unquoteDouble(dqTok.image);
  } else if (sqTok) {
    key = unquoteSingle(sqTok.image);
  } else {
    throw new Error("Object entry missing key");
  }
  const primaryCst = getRule(node, "primary")!;
  return { key, value: convertPrimary(primaryCst) };
}

function convertBinding(node: CstNode): Binding {
  const ident = getTok(node, "Identifier")!;
  const rhs = getRule(node, "rhsExpr")!;
  return {
    kind: "Binding",
    name: ident.image,
    value: convertRhsExpr(rhs),
    line: ident.startLine ?? 0,
  };
}

function convertRhsExpr(node: CstNode): Expr {
  const tc = getRule(node, "toolCall");
  if (tc) return convertToolCall(tc);
  const pipeline = getRule(node, "pipeline");
  if (pipeline) return convertPipeline(pipeline);
  const expr = getRule(node, "exprWithOps");
  if (expr) return convertExprWithOps(expr);
  throw new Error("Empty rhsExpr");
}

// Convert the OR-chain (lowest precedence): `andExpr (|| andExpr)*`.
function convertExprWithOps(node: CstNode): Expr {
  const operands = getRules(node, "andExpr");
  const ors = getToks(node, "OrOr");
  let left = convertAndExpr(operands[0]);
  for (let i = 0; i < ors.length; i++) {
    const right = convertAndExpr(operands[i + 1]);
    left = { kind: "BinaryOp", op: "||", left, right } as BinaryOp;
  }
  return left;
}

function convertAndExpr(node: CstNode): Expr {
  const operands = getRules(node, "compareExpr");
  const ands = getToks(node, "AndAnd");
  let left = convertCompareExpr(operands[0]);
  for (let i = 0; i < ands.length; i++) {
    const right = convertCompareExpr(operands[i + 1]);
    left = { kind: "BinaryOp", op: "&&", left, right } as BinaryOp;
  }
  return left;
}

function convertCompareExpr(node: CstNode): Expr {
  const operands = getRules(node, "rangeExpr");
  // Comparison operator tokens in interleaved order. Chevrotain stores each
  // CONSUME under its token name; merge by position via combined-and-sorted
  // approach.
  const opSpec: Array<{ name: string; op: BinaryOp["op"] }> = [
    { name: "EqEq", op: "==" },
    { name: "NotEq", op: "!=" },
    { name: "LtEq", op: "<=" },
    { name: "GtEq", op: ">=" },
    { name: "Lt", op: "<" },
    { name: "Gt", op: ">" },
  ];
  const allOpToks: Array<{ tok: IToken; op: BinaryOp["op"] }> = [];
  for (const { name, op } of opSpec) {
    const ts = getToks(node, name);
    for (const t of ts) allOpToks.push({ tok: t, op });
  }
  // Sort by start offset to interleave left-to-right.
  allOpToks.sort((a, b) => (a.tok.startOffset ?? 0) - (b.tok.startOffset ?? 0));
  let left = convertRangeExpr(operands[0]);
  for (let i = 0; i < allOpToks.length; i++) {
    const right = convertRangeExpr(operands[i + 1]);
    left = { kind: "BinaryOp", op: allOpToks[i].op, left, right } as BinaryOp;
  }
  return left;
}

function convertRangeExpr(node: CstNode): Expr {
  const primaries = getRules(node, "primary");
  const dot = getTok(node, "DotDot");
  const start = convertPrimary(primaries[0]);
  if (!dot || primaries.length < 2) return start;
  const end = convertPrimary(primaries[1]);
  return { kind: "RangeOp", start, end } as RangeOp;
}

function convertPipeline(node: CstNode): Pipeline {
  const callsCst = getRules(node, "call");
  const stages = callsCst.map(convertCall);
  return {
    kind: "Pipeline",
    stages,
    line: stages[0]?.line ?? 0,
  };
}

function convertCall(node: CstNode): Call {
  const ident = getTok(node, "Identifier")!;
  const argsCst = getRules(node, "arg");
  const args: Arg[] = [];
  for (const a of argsCst) {
    for (const converted of convertArgFlat(a)) args.push(converted);
  }
  return {
    kind: "Call",
    name: ident.image,
    args,
    line: ident.startLine ?? 0,
  };
}

function convertForLoop(node: CstNode): ForLoop {
  const forTok = getTok(node, "For")!;
  const ident = getTok(node, "Identifier")!;
  const iterableCst = getRule(node, "iterable")!;
  const blockCst = getRule(node, "block")!;
  return {
    kind: "ForLoop",
    varName: ident.image,
    iterable: convertIterable(iterableCst),
    body: convertBlock(blockCst),
    line: forTok.startLine ?? 0,
  };
}

function convertWhileLoop(node: CstNode): WhileLoop {
  const whileTok = getTok(node, "While")!;
  const condCst = getRule(node, "condition")!;
  const blockCst = getRule(node, "block")!;
  return {
    kind: "WhileLoop",
    cond: convertCondition(condCst),
    body: convertBlock(blockCst),
    line: whileTok.startLine ?? 0,
  };
}

function convertIfStmt(node: CstNode): IfStmt {
  const ifTok = getTok(node, "If")!;
  const condCst = getRule(node, "condition")!;
  const thenBlockCst = (node.children as Children).thenBlock?.[0] as CstNode | undefined;
  const elseBlockCst = (node.children as Children).elseBlock?.[0] as CstNode | undefined;
  return {
    kind: "IfStmt",
    cond: convertCondition(condCst),
    thenBody: thenBlockCst ? convertBlock(thenBlockCst) : [],
    elseBody: elseBlockCst ? convertBlock(elseBlockCst) : null,
    line: ifTok.startLine ?? 0,
  };
}

function convertBlock(node: CstNode): Statement[] {
  const stmts = getRules(node, "statement");
  return stmts.map(convertStatement);
}

function convertIterable(node: CstNode): Expr {
  const lst = getRule(node, "listLit");
  if (lst) return convertListLit(lst);
  const rop = getRule(node, "rangeOrPrimary");
  if (rop) return convertRangeOrPrimary(rop);
  throw new Error("Empty iterable");
}

function convertRangeOrPrimary(node: CstNode): Expr {
  const primaries = getRules(node, "primary");
  const dot = getTok(node, "DotDot");
  const start = convertPrimary(primaries[0]);
  if (!dot || primaries.length < 2) return start;
  const end = convertPrimary(primaries[1]);
  return { kind: "RangeOp", start, end } as RangeOp;
}

function convertCondition(node: CstNode): Expr {
  const exprCst = getRule(node, "exprWithOps")!;
  const inner = convertExprWithOps(exprCst);
  const bangTok = getTok(node, "Bang");
  if (bangTok) {
    const neg: Negation = { kind: "Negation", expr: inner };
    return neg;
  }
  return inner;
}

function convertArgFlat(node: CstNode): Arg[] {
  const longFlagTok = getTok(node, "LongFlag");
  if (longFlagTok) {
    const primaryCst = getRule(node, "primary")!;
    const value = convertPrimary(primaryCst);
    const named: NamedArg = {
      kind: "NamedArg",
      name: longFlagName(longFlagTok.image),
      value,
    };
    return [named];
  }
  const shortFlagTok = getTok(node, "ShortFlag");
  if (shortFlagTok) {
    const image = shortFlagTok.image;
    return shortFlagLetters(image).map((letter) => {
      const named: NamedArg = {
        kind: "NamedArg",
        name: letter,
        value: { kind: "BoolLit", value: true },
        rawShortFlag: image,
      };
      return named;
    });
  }
  const primaryCst = getRule(node, "primary")!;
  const value = convertPrimary(primaryCst);
  const pos: PositionalArg = { kind: "PositionalArg", value };
  return [pos];
}

function convertPrimary(node: CstNode): Expr {
  const dq = getTok(node, "DoubleQuotedString");
  if (dq) {
    const lit: StringLit = { kind: "StringLit", raw: unquoteDouble(dq.image), interpolated: true };
    return lit;
  }
  const sq = getTok(node, "SingleQuotedString");
  if (sq) {
    const lit: StringLit = { kind: "StringLit", raw: unquoteSingle(sq.image), interpolated: false };
    return lit;
  }
  const num = getTok(node, "NumberLit");
  if (num) {
    // REQ-011 ac1 — int OR float. parseFloat handles both safely.
    const n: NumLit = { kind: "NumLit", value: parseFloat(num.image) };
    return n;
  }
  const nul = getTok(node, "NullTok");
  if (nul) {
    const n: NullLit = { kind: "NullLit" };
    return n;
  }
  const t = getTok(node, "TrueTok");
  if (t) {
    const b: BoolLit = { kind: "BoolLit", value: true };
    return b;
  }
  const f = getTok(node, "FalseTok");
  if (f) {
    const b: BoolLit = { kind: "BoolLit", value: false };
    return b;
  }
  const tc = getRule(node, "toolCall");
  if (tc) return convertToolCall(tc);
  const v = getRule(node, "varOrField");
  if (v) return convertVarOrField(v);
  const lst = getRule(node, "listLit");
  if (lst) return convertListLit(lst);
  const obj = getRule(node, "objectLit");
  if (obj) return convertObjectLit(obj);
  throw new Error("Empty primary");
}

function convertVarOrField(node: CstNode): Expr {
  const tok = getTok(node, "VarRefTok")!;
  const varRef: VarRef = { kind: "VarRef", name: varRefName(tok.image) };
  const fieldToks = ((node.children as Children).Identifier as IToken[] | undefined) ?? [];
  let result: VarRef | FieldAccess = varRef;
  for (const ft of fieldToks) {
    result = { kind: "FieldAccess", target: result, field: ft.image };
  }
  return result;
}

function convertListLit(node: CstNode): ListLit {
  const items = getRules(node, "primary").map(convertPrimary);
  return { kind: "ListLit", items };
}

// ----- Static checks (run after AST conversion, before evaluation) -----

function enforceStaticChecks(program: Program): void {
  // Tier 2 (REQ-104): track loop-nesting depth so `continue` / `break`
  // outside any `for` / `while` body parse-fails. `if` does NOT count as a
  // loop for this purpose.
  let loopDepth = 0;

  // Walk every statement; check binding LHS names + input_var keys.
  function visit(stmts: Statement[]): void {
    for (const s of stmts) visitStmt(s);
  }
  function visitStmt(s: Statement): void {
    switch (s.kind) {
      case "Binding":
        if (RESERVED_KEYWORDS.has(s.name)) {
          // Note: `_self` lands in RESERVED_KEYWORDS for REQ-103. Surface
          // it with the more specific `assign_to_self` reason so callers
          // can produce the spec error message.
          const reason: ParseErrorReason = s.name === "_self"
            ? "assign_to_self"
            : "reserved_keyword_assignment";
          const message = s.name === "_self"
            ? `_self is read-only; assignment to '_self' is a parse-time error (REQ-103)`
            : `Cannot assign to reserved keyword '${s.name}'`;
          const err: ParseErrorDetail = {
            reason,
            at_line: s.line,
            near_token: s.name,
            message,
          };
          throw new ParseError(err.message, [err]);
        }
        if (BUILTIN_NAMES.has(s.name)) {
          const err: ParseErrorDetail = {
            reason: "builtin_name_shadowing",
            at_line: s.line,
            near_token: s.name,
            message: `Cannot shadow builtin '${s.name}'`,
          };
          throw new ParseError(err.message, [err]);
        }
        visitExpr(s.value);
        return;
      case "Pipeline":
        for (const stage of s.stages) visitCall(stage);
        return;
      case "ToolCall":
        if (s.arg && s.arg.kind === "ObjectLit") visitExpr(s.arg);
        return;
      case "ForLoop":
        visitExpr(s.iterable);
        loopDepth++;
        try {
          visit(s.body);
        } finally {
          loopDepth--;
        }
        return;
      case "WhileLoop":
        visitExpr(s.cond);
        loopDepth++;
        try {
          visit(s.body);
        } finally {
          loopDepth--;
        }
        return;
      case "IfStmt":
        visitExpr(s.cond);
        visit(s.thenBody);
        if (s.elseBody) visit(s.elseBody);
        return;
      case "ContinueStmt":
      case "BreakStmt": {
        if (loopDepth === 0) {
          const kw = s.kind === "ContinueStmt" ? "continue" : "break";
          const err: ParseErrorDetail = {
            reason: "loop_control_outside_loop",
            at_line: s.line,
            near_token: kw,
            message: `'${kw}' is only valid inside a for- or while-loop body (REQ-104)`,
          };
          throw new ParseError(err.message, [err]);
        }
        return;
      }
    }
  }
  function visitExpr(e: Expr): void {
    switch (e.kind) {
      case "ListLit":
        for (const it of e.items) visitExpr(it);
        return;
      case "ObjectLit":
        for (const entry of e.entries) visitExpr(entry.value);
        return;
      case "Pipeline":
        for (const stage of e.stages) visitCall(stage);
        return;
      case "ToolCall":
        if (e.arg && e.arg.kind === "ObjectLit") visitExpr(e.arg);
        return;
      case "Negation":
        visitExpr(e.expr);
        return;
      case "BinaryOp":
        visitExpr(e.left);
        visitExpr(e.right);
        return;
      case "RangeOp":
        visitExpr(e.start);
        visitExpr(e.end);
        return;
      default:
        return;
    }
  }
  function visitCall(c: Call): void {
    if (c.name === "input_var") {
      // Item 11 / REQ-007 ac1: first positional arg must be a string literal.
      const first = c.args.find((a) => a.kind === "PositionalArg");
      if (!first || first.kind !== "PositionalArg" || first.value.kind !== "StringLit") {
        const found = first?.value?.kind ?? "(missing)";
        const err: ParseErrorDetail = {
          reason: "input_var_key_must_be_literal",
          at_line: c.line,
          near_token: "input_var",
          message: `input_var key must be a string literal (got ${found})`,
        };
        throw new ParseError(err.message, [err]);
      }
    }
    for (const a of c.args) visitExpr(a.value);
  }
  visit(program.statements);
}
