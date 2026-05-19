import type { IToken, TokenType } from 'chevrotain';
import { tokenMatcher } from 'chevrotain';
import {
  AndAnd,
  Bang,
  BangEq,
  BUILTIN_NAMES,
  Colon,
  Comma,
  Do,
  Done,
  Dot,
  DoubleQuotedString,
  Else,
  EqEq,
  Equals,
  Fi,
  For,
  GreaterEq,
  GreaterThan,
  Identifier,
  If,
  In,
  LBrace,
  LBracket,
  LParen,
  LessEq,
  LessThan,
  LongFlag,
  Newline,
  NullTok,
  NumberLit,
  OrOr,
  Pipe,
  RESERVED_KEYWORDS,
  Range,
  RBrace,
  RBracket,
  RParen,
  ShortFlag,
  SingleQuotedString,
  Then,
  VarRefTok,
  While,
  longFlagName,
  macroLexer,
  shortFlagLetters,
  unquoteDouble,
  unquoteSingle,
  validateDoubleQuotedEscapes,
  varRefName,
} from './tokens.js';
import { macroParseError } from './errors.js';
import type {
  Arg,
  BinaryExpr,
  Binding,
  Call,
  Expr,
  FieldAccess,
  ForLoop,
  IfStmt,
  ListLit,
  MacroParseResult,
  NamedArg,
  NullLit,
  NumLit,
  ObjectEntry,
  ObjectLit,
  Pipeline,
  PositionalArg,
  Program,
  RangeExpr,
  Statement,
  StringLit,
  ToolCall,
  ToolExistsCall,
  UnaryExpr,
  VarRef,
  WhileLoop,
} from './types.js';

type ParseReason =
  | 'unexpected_token'
  | 'missing_do'
  | 'missing_done'
  | 'missing_then'
  | 'missing_fi'
  | 'reserved_keyword_assignment'
  | 'builtin_name_shadowing'
  | 'invalid_literal'
  | 'input_var_key_must_be_literal'
  | 'readonly_self_assignment';

class MacroSyntaxFailure extends Error {
  constructor(
    public readonly reason: ParseReason,
    public readonly token: IToken | undefined,
    public readonly message: string
  ) {
    super(message);
    this.name = 'MacroSyntaxFailure';
  }
}

export function parseMacroSource(source: string, identifier?: string): MacroParseResult {
  const lexResult = macroLexer.tokenize(source);
  if (lexResult.errors.length > 0) {
    const first = lexResult.errors[0];
    return {
      ok: false,
      error: macroParseError(
        {
          reason: 'invalid_literal',
          at_line: first?.line ?? 1,
          near_token: source.slice(first?.offset ?? 0, (first?.offset ?? 0) + (first?.length ?? 1)),
        },
        first?.message ?? 'Macro source contains an invalid literal.',
        identifier
      ),
    };
  }

  const parser = new TokenStreamParser(lexResult.tokens);
  const parsed = parser.parseProgram();
  if (!parsed.ok) {
    return {
      ok: false,
      error: macroParseError(
        {
          reason: parsed.failure.reason as never,
          at_line: parsed.failure.token?.startLine ?? 1,
          near_token: parsed.failure.token?.image,
        },
        parsed.failure.message,
        identifier
      ),
    };
  }

  return { ok: true, program: parsed.program };
}

class TokenStreamParser {
  private index = 0;

  constructor(private readonly tokens: IToken[]) {}

  parseProgram(): { ok: true; program: Program } | { ok: false; failure: MacroSyntaxFailure } {
    try {
      const statements = this.parseStatements([]);
      this.skipNewlines();
      if (!this.isAtEnd()) {
        this.fail(
          'unexpected_token',
          this.peek(),
          `Unexpected token "${this.peek()?.image ?? ''}".`
        );
      }
      return { ok: true, program: { kind: 'Program', statements } };
    } catch (error) {
      return { ok: false, failure: error as MacroSyntaxFailure };
    }
  }

  private parseStatements(terminators: TokenType[]): Statement[] {
    const statements: Statement[] = [];
    this.skipNewlines();
    while (!this.isAtEnd() && !this.matchesAny(this.peek(), terminators)) {
      statements.push(this.parseStatement());
      if (this.matches(Newline)) {
        this.skipNewlines();
      } else if (!this.isAtEnd() && !this.matchesAny(this.peek(), terminators)) {
        this.fail('unexpected_token', this.peek(), 'Expected a newline between macro statements.');
      }
    }
    return statements;
  }

  private parseStatement(): Statement {
    const token = this.peek();
    if (this.looksLikeSelfAssignment()) {
      this.fail(
        'readonly_self_assignment',
        token,
        '_self is read-only; update the source document through a tool call instead.'
      );
    }
    if (this.isReservedAssignment()) {
      this.fail(
        'reserved_keyword_assignment',
        token,
        `Cannot assign to reserved keyword "${token?.image}".`
      );
    }
    if (this.matches(For)) return this.parseForLoop();
    if (this.matches(While)) return this.parseWhileLoop();
    if (this.matches(If)) return this.parseIfStmt();
    if (this.matches(Identifier) && this.matchesAt(1, Equals)) return this.parseBinding();
    if (this.looksLikeToolCall()) return this.parseToolLike();
    return this.parsePipeline();
  }

  private parseBinding(): Binding {
    const name = this.consume(Identifier, 'Expected binding name.');
    if (BUILTIN_NAMES.includes(name.image as (typeof BUILTIN_NAMES)[number])) {
      this.fail('builtin_name_shadowing', name, `Cannot assign to builtin name "${name.image}".`);
    }
    this.consume(Equals, 'Expected "=" after binding name.');
    return {
      kind: 'Binding',
      name: name.image,
      value: this.parseRhsExpression(),
      line: name.startLine ?? 1,
    };
  }

  private parseRhsExpression(): Expr {
    if (this.matches(Identifier) && !this.looksLikeToolCall()) {
      return this.parseCallOrPipeline();
    }
    return this.parseExpression();
  }

  private parseForLoop(): ForLoop {
    const start = this.consume(For, 'Expected "for".');
    const variable = this.consume(Identifier, 'Expected loop variable.');
    if (this.matches(Equals)) {
      this.fail('unexpected_token', this.peek(), 'Pascal-style for loops are not supported.');
    }
    this.consume(In, 'Expected "in" after loop variable.');
    const iterable = this.parseExpression();
    if (!this.matches(Do))
      this.fail('missing_do', this.peek(), 'Expected "do" before for-loop body.');
    this.consume(Do, 'Expected "do" before for-loop body.');
    this.requireStatementBoundary('Expected newline after "do".');
    const body = this.parseStatements([Done]);
    if (!this.matches(Done))
      this.fail('missing_done', this.peekPrevious(), 'Expected "done" after for-loop body.');
    this.consume(Done, 'Expected "done" after for-loop body.');
    return { kind: 'ForLoop', varName: variable.image, iterable, body, line: start.startLine ?? 1 };
  }

  private parseWhileLoop(): WhileLoop {
    const start = this.consume(While, 'Expected "while".');
    const condition = this.parseExpression();
    if (!this.matches(Do))
      this.fail('missing_do', this.peek(), 'Expected "do" before while-loop body.');
    this.consume(Do, 'Expected "do" before while-loop body.');
    this.requireStatementBoundary('Expected newline after "do".');
    const body = this.parseStatements([Done]);
    if (!this.matches(Done))
      this.fail('missing_done', this.peekPrevious(), 'Expected "done" after while-loop body.');
    this.consume(Done, 'Expected "done" after while-loop body.');
    return { kind: 'WhileLoop', condition, body, line: start.startLine ?? 1 };
  }

  private parseIfStmt(): IfStmt {
    const start = this.consume(If, 'Expected "if".');
    const condition = this.parseExpression();
    if (!this.matches(Then))
      this.fail('missing_then', this.peek(), 'Expected "then" after if condition.');
    this.consume(Then, 'Expected "then" after if condition.');
    this.requireStatementBoundary('Expected newline after "then".');
    const thenBody = this.parseStatements([Else, Fi]);
    let elseBody: Statement[] | null = null;
    if (this.matches(Else)) {
      this.consume(Else, 'Expected "else".');
      this.requireStatementBoundary('Expected newline after "else".');
      elseBody = this.parseStatements([Fi]);
    }
    if (!this.matches(Fi))
      this.fail('missing_fi', this.peekPrevious(), 'Expected "fi" after if statement.');
    this.consume(Fi, 'Expected "fi" after if statement.');
    return { kind: 'IfStmt', condition, thenBody, elseBody, line: start.startLine ?? 1 };
  }

  private parseExpression(): Expr {
    return this.parseOr();
  }

  private parseOr(): Expr {
    let expr = this.parseAnd();
    while (this.matches(OrOr)) {
      const op = this.advance();
      expr = this.binary(expr, op.image as BinaryExpr['op'], this.parseAnd());
    }
    return expr;
  }

  private parseAnd(): Expr {
    let expr = this.parseComparison();
    while (this.matches(AndAnd)) {
      const op = this.advance();
      expr = this.binary(expr, op.image as BinaryExpr['op'], this.parseComparison());
    }
    return expr;
  }

  private parseComparison(): Expr {
    let expr = this.parseRange();
    while (this.matchesAny(this.peek(), [EqEq, BangEq, LessThan, GreaterThan, LessEq, GreaterEq])) {
      const op = this.advance();
      expr = this.binary(expr, op.image as BinaryExpr['op'], this.parseRange());
    }
    return expr;
  }

  private parseRange(): Expr {
    let expr = this.parseUnary();
    while (this.matches(Range)) {
      this.advance();
      expr = { kind: 'RangeExpr', start: expr, end: this.parseUnary() } satisfies RangeExpr;
    }
    return expr;
  }

  private parseUnary(): Expr {
    if (this.matches(Bang)) {
      this.advance();
      return { kind: 'UnaryExpr', op: '!', expr: this.parseUnary() } satisfies UnaryExpr;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    if (this.matches(Identifier) && this.peek()?.image === '_self') return this.parseBareSelfOrField();
    if (this.looksLikeToolCall()) return this.parseToolLike();
    if (this.matches(Identifier)) return this.parseCall();
    if (this.matches(DoubleQuotedString)) {
      const token = this.advance();
      if (!validateDoubleQuotedEscapes(token.image)) {
        this.fail('invalid_literal', token, 'Double-quoted string contains an unsupported escape.');
      }
      return {
        kind: 'StringLit',
        raw: unquoteDoubleForInterpolatedString(token.image),
        interpolated: true,
      } satisfies StringLit;
    }
    if (this.matches(SingleQuotedString)) {
      const token = this.advance();
      return {
        kind: 'StringLit',
        raw: unquoteSingle(token.image),
        interpolated: false,
      } satisfies StringLit;
    }
    if (this.matches(NumberLit)) {
      const token = this.advance();
      return { kind: 'NumLit', value: Number(token.image) } satisfies NumLit;
    }
    if (this.matches(NullTok)) {
      this.advance();
      return { kind: 'NullLit' } satisfies NullLit;
    }
    if (this.matches(VarRefTok)) return this.parseVarOrField();
    if (this.matches(LBracket)) return this.parseListLit();
    if (this.matches(LBrace)) return this.parseObjectLit();
    this.fail('unexpected_token', this.peek(), `Unexpected token "${this.peek()?.image ?? ''}".`);
  }

  private parsePipeline(): Pipeline {
    const first = this.parseCall();
    const stages = [first];
    while (this.matches(Pipe)) {
      this.advance();
      stages.push(this.parseCall());
    }
    return { kind: 'Pipeline', stages, line: first.line };
  }

  private parseCallOrPipeline(): Call | Pipeline {
    const first = this.parseCall();
    if (!this.matches(Pipe)) {
      return first;
    }
    const stages = [first];
    while (this.matches(Pipe)) {
      this.advance();
      stages.push(this.parseCall());
    }
    return { kind: 'Pipeline', stages, line: first.line };
  }

  private parseCall(): Call {
    const name = this.consume(Identifier, 'Expected call name.');
    const args: Arg[] = [];
    while (this.canStartArgument()) {
      if (this.matches(LongFlag)) {
        const flag = this.advance();
        args.push({
          kind: 'NamedArg',
          name: longFlagName(flag.image),
          value: this.parseExpression(),
        } satisfies NamedArg);
      } else if (this.matches(ShortFlag)) {
        const flag = this.advance();
        for (const letter of shortFlagLetters(flag.image)) {
          args.push({
            kind: 'NamedArg',
            name: letter,
            value: { kind: 'NumLit', value: 1 },
            rawShortFlag: flag.image,
          } satisfies NamedArg);
        }
      } else {
        args.push({ kind: 'PositionalArg', value: this.parseExpression() } satisfies PositionalArg);
      }
    }
    return { kind: 'Call', name: name.image, args, line: name.startLine ?? 1 };
  }

  private parseToolLike(): ToolCall | ToolExistsCall {
    const server = this.consume(Identifier, 'Expected server name.');
    this.consume(Dot, 'Expected "." after server name.');
    const tool = this.consume(Identifier, 'Expected tool name.');

    if (tool.image.startsWith('_')) {
      this.consume(LParen, `Expected "(" after ${tool.image}.`);
      this.consume(RParen, `Expected ")" after ${tool.image}.`);
      return {
        kind: 'ToolExistsCall',
        server: server.image,
        method: tool.image,
        line: server.startLine ?? 1,
      };
    }

    if (this.matches(Dot)) {
      this.fail('unexpected_token', this.peek(), 'Dotted server names are not supported.');
    }

    this.consume(LParen, 'Expected "(" after tool name.');
    let arg: ObjectLit | VarRef | FieldAccess | undefined;
    if (!this.matches(RParen)) {
      if (this.matches(LBrace)) {
        arg = this.parseObjectLit();
      } else if (this.matches(VarRefTok)) {
        arg = this.parseVarOrField();
      } else {
        this.fail(
          'unexpected_token',
          this.peek(),
          'Tool call argument must be an object or variable reference.'
        );
      }
    }
    this.consume(RParen, 'Expected ")" after tool call.');
    return {
      kind: 'ToolCall',
      server: server.image,
      tool: tool.image,
      arg,
      line: server.startLine ?? 1,
    };
  }

  private parseObjectLit(): ObjectLit {
    this.consume(LBrace, 'Expected "{".');
    this.skipNewlines();
    const entries: ObjectEntry[] = [];
    while (!this.matches(RBrace) && !this.isAtEnd()) {
      const keyToken = this.advance();
      if (
        !this.matchesToken(keyToken, Identifier) &&
        !this.matchesToken(keyToken, DoubleQuotedString) &&
        !this.matchesToken(keyToken, SingleQuotedString)
      ) {
        this.fail('unexpected_token', keyToken, 'Expected object key.');
      }
      const key = this.matchesToken(keyToken, Identifier)
        ? keyToken.image
        : this.matchesToken(keyToken, DoubleQuotedString)
          ? unquoteDouble(keyToken.image)
          : unquoteSingle(keyToken.image);
      this.consume(Colon, 'Expected ":" after object key.');
      entries.push({ key, value: this.parseExpression() });
      this.skipNewlines();
      if (!this.matches(Comma)) break;
      this.advance();
      this.skipNewlines();
    }
    this.consume(RBrace, 'Expected "}" after object literal.');
    return { kind: 'ObjectLit', entries };
  }

  private parseListLit(): ListLit {
    this.consume(LBracket, 'Expected "[".');
    this.skipNewlines();
    const items: Expr[] = [];
    while (!this.matches(RBracket) && !this.isAtEnd()) {
      items.push(this.parseExpression());
      this.skipNewlines();
      if (!this.matches(Comma)) break;
      this.advance();
      this.skipNewlines();
    }
    this.consume(RBracket, 'Expected "]" after list literal.');
    return { kind: 'ListLit', items };
  }

  private parseVarOrField(): VarRef | FieldAccess {
    const variable = this.consume(VarRefTok, 'Expected variable reference.');
    let expr: VarRef | FieldAccess = { kind: 'VarRef', name: varRefName(variable.image) };
    while (this.matches(Dot)) {
      this.advance();
      const field = this.consume(Identifier, 'Expected field name.');
      expr = { kind: 'FieldAccess', target: expr, field: field.image };
    }
    return expr;
  }

  private parseBareSelfOrField(): VarRef | FieldAccess {
    const variable = this.consume(Identifier, 'Expected _self reference.');
    let expr: VarRef | FieldAccess = { kind: 'VarRef', name: variable.image };
    while (this.matches(Dot)) {
      this.advance();
      const field = this.consume(Identifier, 'Expected field name.');
      expr = { kind: 'FieldAccess', target: expr, field: field.image };
    }
    return expr;
  }

  private binary(left: Expr, op: BinaryExpr['op'], right: Expr): BinaryExpr {
    return { kind: 'BinaryExpr', op, left, right };
  }

  private canStartArgument(): boolean {
    if (
      this.matchesAny(this.peek(), [
        Newline,
        Pipe,
        Done,
        Else,
        Fi,
        Do,
        Then,
        RBrace,
        RBracket,
        RParen,
        Comma,
      ])
    ) {
      return false;
    }
    return this.canStartExpression() || this.matches(LongFlag) || this.matches(ShortFlag);
  }

  private canStartExpression(): boolean {
    return this.matchesAny(this.peek(), [
      Identifier,
      DoubleQuotedString,
      SingleQuotedString,
      NumberLit,
      NullTok,
      VarRefTok,
      LBracket,
      LBrace,
      Bang,
    ]);
  }

  private looksLikeToolCall(): boolean {
    return this.matches(Identifier) && this.matchesAt(1, Dot) && this.matchesAt(2, Identifier);
  }

  private looksLikeSelfAssignment(): boolean {
    if (!this.matches(Identifier) || this.peek()?.image !== '_self' || !this.matchesAt(1, Dot)) {
      return false;
    }
    let offset = 2;
    while (
      this.matchesToken(this.tokens[this.index + offset], Identifier) &&
      this.matchesToken(this.tokens[this.index + offset + 1], Dot)
    ) {
      offset += 2;
    }
    return (
      this.matchesToken(this.tokens[this.index + offset], Identifier) &&
      this.matchesToken(this.tokens[this.index + offset + 1], Equals)
    );
  }

  private isReservedAssignment(): boolean {
    const token = this.peek();
    return (
      token !== undefined &&
      RESERVED_KEYWORDS.includes(token.image as (typeof RESERVED_KEYWORDS)[number]) &&
      this.matchesAt(1, Equals)
    );
  }

  private requireStatementBoundary(message: string): void {
    if (!this.matches(Newline)) this.fail('unexpected_token', this.peek(), message);
    this.skipNewlines();
  }

  private skipNewlines(): void {
    while (this.matches(Newline)) this.advance();
  }

  private consume(tokenType: TokenType, message: string): IToken {
    if (this.matches(tokenType)) return this.advance();
    this.fail('unexpected_token', this.peek() ?? this.peekPrevious(), message);
  }

  private advance(): IToken {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  private peek(): IToken | undefined {
    return this.tokens[this.index];
  }

  private peekPrevious(): IToken | undefined {
    return this.tokens[this.index - 1] ?? this.tokens[this.index];
  }

  private matches(tokenType: TokenType): boolean {
    return this.matchesToken(this.peek(), tokenType);
  }

  private matchesAt(offset: number, tokenType: TokenType): boolean {
    return this.matchesToken(this.tokens[this.index + offset], tokenType);
  }

  private matchesAny(token: IToken | undefined, tokenTypes: TokenType[]): boolean {
    return tokenTypes.some((tokenType) => this.matchesToken(token, tokenType));
  }

  private matchesToken(token: IToken | undefined, tokenType: TokenType): boolean {
    return token !== undefined && tokenMatcher(token, tokenType);
  }

  private isAtEnd(): boolean {
    return this.index >= this.tokens.length;
  }

  private fail(reason: ParseReason, token: IToken | undefined, message: string): never {
    throw new MacroSyntaxFailure(reason, token, message);
  }
}

function unquoteDoubleForInterpolatedString(image: string): string {
  const inner = image.slice(1, -1);
  return inner.replace(/\\([ntr"\\$])/g, (_match: string, escaped: string) => {
    switch (escaped) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      case '$':
        return '\uE000';
      default:
        return escaped;
    }
  });
}
