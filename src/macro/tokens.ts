import { createToken, Lexer } from 'chevrotain';

export const Identifier = createToken({
  name: 'Identifier',
  pattern: /[A-Za-z_][A-Za-z0-9_]*/,
});

export const WhiteSpace = createToken({
  name: 'WhiteSpace',
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
});

export const LineContinuation = createToken({
  name: 'LineContinuation',
  pattern: /\\\r?\n/,
  group: Lexer.SKIPPED,
  line_breaks: true,
});

export const Comment = createToken({
  name: 'Comment',
  pattern: /#[^\r\n]*/,
  group: Lexer.SKIPPED,
});

export const Newline = createToken({
  name: 'Newline',
  pattern: /\r?\n/,
  line_breaks: true,
});

export const For = createToken({ name: 'For', pattern: /for/, longer_alt: Identifier });
export const In = createToken({ name: 'In', pattern: /in/, longer_alt: Identifier });
export const Do = createToken({ name: 'Do', pattern: /do/, longer_alt: Identifier });
export const Done = createToken({ name: 'Done', pattern: /done/, longer_alt: Identifier });
export const If = createToken({ name: 'If', pattern: /if/, longer_alt: Identifier });
export const Then = createToken({ name: 'Then', pattern: /then/, longer_alt: Identifier });
export const Else = createToken({ name: 'Else', pattern: /else/, longer_alt: Identifier });
export const Fi = createToken({ name: 'Fi', pattern: /fi/, longer_alt: Identifier });
export const While = createToken({ name: 'While', pattern: /while/, longer_alt: Identifier });
export const NullTok = createToken({ name: 'NullTok', pattern: /null/, longer_alt: Identifier });

export const EqEq = createToken({ name: 'EqEq', pattern: /==/ });
export const BangEq = createToken({ name: 'BangEq', pattern: /!=/ });
export const LessEq = createToken({ name: 'LessEq', pattern: /<=/ });
export const GreaterEq = createToken({ name: 'GreaterEq', pattern: />=/ });
export const AndAnd = createToken({ name: 'AndAnd', pattern: /&&/ });
export const OrOr = createToken({ name: 'OrOr', pattern: /\|\|/ });
export const Range = createToken({ name: 'Range', pattern: /\.\./ });
export const LessThan = createToken({ name: 'LessThan', pattern: /</ });
export const GreaterThan = createToken({ name: 'GreaterThan', pattern: />/ });
export const Bang = createToken({ name: 'Bang', pattern: /!/ });
export const Pipe = createToken({ name: 'Pipe', pattern: /\|/ });

export const VarRefTok = createToken({
  name: 'VarRefTok',
  pattern: /\$[A-Za-z_][A-Za-z0-9_]*/,
});

export const LongFlag = createToken({
  name: 'LongFlag',
  pattern: /--[A-Za-z_][A-Za-z0-9_-]*/,
});

export const ShortFlag = createToken({
  name: 'ShortFlag',
  pattern: /-[A-Za-z][A-Za-z0-9]*/,
});

export const NumberLit = createToken({
  name: 'NumberLit',
  pattern: /-?(?:[0-9]+\.[0-9]+|[0-9]+)/,
});

export const DoubleQuotedString = createToken({
  name: 'DoubleQuotedString',
  pattern: /"(?:[^"\\\r\n]|\\[ntr"\\$])*"/,
});

export const SingleQuotedString = createToken({
  name: 'SingleQuotedString',
  pattern: /'[^'\r\n]*'/,
});

export const Equals = createToken({ name: 'Equals', pattern: /=/ });
export const Comma = createToken({ name: 'Comma', pattern: /,/ });
export const Colon = createToken({ name: 'Colon', pattern: /:/ });
export const Dot = createToken({ name: 'Dot', pattern: /\./ });
export const LBracket = createToken({ name: 'LBracket', pattern: /\[/ });
export const RBracket = createToken({ name: 'RBracket', pattern: /\]/ });
export const LBrace = createToken({ name: 'LBrace', pattern: /\{/ });
export const RBrace = createToken({ name: 'RBrace', pattern: /\}/ });
export const LParen = createToken({ name: 'LParen', pattern: /\(/ });
export const RParen = createToken({ name: 'RParen', pattern: /\)/ });

export const RESERVED_KEYWORDS = [
  'for',
  'in',
  'do',
  'done',
  'if',
  'then',
  'else',
  'fi',
  'while',
  'null',
] as const;

export const BUILTIN_NAMES = [
  'echo',
  'status',
  'task_id',
  'list_tasks',
  'count',
  'unique',
  'append',
  'concat',
  'add',
  'sub',
  'mul',
  'div',
  'mod',
  'sleep',
  'slow_op',
  'fail',
  'exit',
  'input_var',
  'range',
  'grep',
  'find',
  'sed',
  'cat',
  'wc',
  'head',
  'tail',
  'ls',
] as const;

export const allTokens = [
  WhiteSpace,
  LineContinuation,
  Comment,
  Newline,
  For,
  In,
  Done,
  Do,
  If,
  Then,
  Else,
  Fi,
  While,
  NullTok,
  EqEq,
  BangEq,
  LessEq,
  GreaterEq,
  AndAnd,
  OrOr,
  Range,
  LessThan,
  GreaterThan,
  Bang,
  Pipe,
  VarRefTok,
  LongFlag,
  ShortFlag,
  DoubleQuotedString,
  SingleQuotedString,
  NumberLit,
  Equals,
  Comma,
  Colon,
  Dot,
  LBracket,
  RBracket,
  LBrace,
  RBrace,
  LParen,
  RParen,
  Identifier,
];

export const macroLexer = new Lexer(allTokens, {
  errorMessageProvider: {
    buildUnexpectedCharactersMessage: (_fullText, _startOffset, _length, line, column) =>
      `Unexpected character at line ${line}, column ${column}.`,
    buildUnableToPopLexerModeMessage: (token) => `Lexer mode error at token "${token.image}".`,
  },
});

export function varRefName(image: string): string {
  return image.startsWith('$') ? image.slice(1) : image;
}

export function longFlagName(image: string): string {
  return image.startsWith('--') ? image.slice(2) : image;
}

export function shortFlagLetters(image: string): string[] {
  return (image.startsWith('-') ? image.slice(1) : image).split('');
}

export function validateDoubleQuotedEscapes(image: string): boolean {
  return /^"(?:[^"\\\r\n]|\\[ntr"\\$])*"$/.test(image);
}

export function unquoteDouble(image: string): string {
  const inner = image.slice(1, -1);
  return inner.replace(/\\([ntr"\\$])/g, (_match: string, escaped: string) => {
    switch (escaped) {
      case 'n':
        return '\n';
      case 't':
        return '\t';
      case 'r':
        return '\r';
      default:
        return escaped;
    }
  });
}

export function unquoteSingle(image: string): string {
  return image.slice(1, -1);
}
