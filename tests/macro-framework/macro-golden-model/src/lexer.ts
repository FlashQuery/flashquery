import { createToken, Lexer } from "chevrotain";

// ----- Token definitions -----
// Chevrotain matches tokens in declaration order. Keywords must be
// declared before Identifier and use longer_alt: Identifier so that
// e.g. "force" (which starts with "for") is treated as an identifier.

export const Identifier = createToken({
  name: "Identifier",
  pattern: /[a-zA-Z_][a-zA-Z0-9_]*/,
});

export const For = createToken({
  name: "For",
  pattern: /for/,
  longer_alt: Identifier,
});

export const In = createToken({
  name: "In",
  pattern: /in/,
  longer_alt: Identifier,
});

export const Done = createToken({
  name: "Done",
  pattern: /done/,
  longer_alt: Identifier,
});

// `do` keyword. Required between for-loop / while-loop iterable and body
// (per REQ-016 / REQ-015). Added 2026-05-18 (golden model patch list item 17).
export const Do = createToken({
  name: "Do",
  pattern: /do/,
  longer_alt: Identifier,
});

// `while` keyword (per REQ-015). Added 2026-05-18 (golden model patch list
// item 17). Used in `while <condition> do <body> done`.
export const While = createToken({
  name: "While",
  pattern: /while/,
  longer_alt: Identifier,
});

export const If = createToken({
  name: "If",
  pattern: /if/,
  longer_alt: Identifier,
});

export const Then = createToken({
  name: "Then",
  pattern: /then/,
  longer_alt: Identifier,
});

export const Else = createToken({
  name: "Else",
  pattern: /else/,
  longer_alt: Identifier,
});

export const Fi = createToken({
  name: "Fi",
  pattern: /fi/,
  longer_alt: Identifier,
});

// `continue` and `break` — loop-control reserved keywords (REQ-104, Tier 2).
// Parse-time error if used outside a loop body.
export const Continue = createToken({
  name: "Continue",
  pattern: /continue/,
  longer_alt: Identifier,
});

export const Break = createToken({
  name: "Break",
  pattern: /break/,
  longer_alt: Identifier,
});

// `null` literal. Added 2026-05-12 for the OQ #23 `input_var` default-value
// grammar. Treated as a value expression alongside strings/numbers/lists.
// Booleans (true/false) remain deferred per §5 of the research doc.
export const NullTok = createToken({
  name: "NullTok",
  pattern: /null/,
  longer_alt: Identifier,
});

// Boolean literals (per REQ-010 / REQ-011). Added 2026-05-18.
export const TrueTok = createToken({
  name: "TrueTok",
  pattern: /true/,
  longer_alt: Identifier,
});
export const FalseTok = createToken({
  name: "FalseTok",
  pattern: /false/,
  longer_alt: Identifier,
});

// $name — variable reference. The leading $ is stripped at parse time.
export const VarRefTok = createToken({
  name: "VarRefTok",
  pattern: /\$[a-zA-Z_][a-zA-Z0-9_]*/,
});

// Long flag — takes a value: `--model "claude-haiku-4-5"`.
// (Long flags always consume the next primary as their value. To pass a
// long flag without a value, use the short form instead, or define a
// boolean variant.)
export const LongFlag = createToken({
  name: "LongFlag",
  pattern: /--[a-zA-Z_][a-zA-Z0-9_-]*/,
});

// Short flag — boolean only: `-i`, `-v`, or bundled like `-iv`.
// A bundled `-iv` is split into two boolean flags (`i: true`, `v: true`)
// during AST conversion, matching Bash's convention.
// The single-dash form requires at least one letter, which keeps it distinct
// from negative numbers (NumberLit matches -<digits>).
export const ShortFlag = createToken({
  name: "ShortFlag",
  pattern: /-[a-zA-Z][a-zA-Z0-9]*/,
});

// Numbers. REQ-011 ac1 / ac2 (patch list items 8 + 17): both ints and floats.
// The leading `-` is part of the literal. We MUST disambiguate from the `..`
// range operator (REQ-014) with one-character lookahead: `1..5` should
// tokenize as NumberLit(1), DotDot, NumberLit(5) — not NumberLit(1.), Dot,
// NumberLit(5). The regex below uses a negative lookahead for `..` after
// the integer portion to ensure the dot in `1..5` is not greedily eaten by
// the float branch.
export const NumberLit = createToken({
  name: "NumberLit",
  // Either: -?digit+ (?! \. (?!\.) ) — int, NOT followed by single dot
  //   OR    -?digit+ \. digit+      — float
  pattern: /-?(?:[0-9]+\.[0-9]+|[0-9]+(?!\.[0-9]))/,
});

// GG-009 (2026-05-20): malformed number literal — scientific notation (`1e5`)
// and other digit-followed-by-letter sequences. v0 grammar (REQ-011) does
// NOT support scientific notation; production rejects `1e5` as a
// `parse_error`. The golden previously split `1e5` into NumberLit(1) +
// Identifier(e5), surfacing a runtime "Unknown function: e5". This token
// captures any digit-then-letter run as a single malformed token. The
// parser declares it (via the static-check pass) as a parse_error with
// reason `invalid_literal`.
//
// Pattern: -?[0-9]+[a-zA-Z_][a-zA-Z0-9_]* — captures `1e5`, `1abc`, `0xff`
// (also malformed in v0), etc. Ordered BEFORE NumberLit and Identifier so
// it wins the longest-match tie-breaker for these specific sequences.
export const MalformedNumber = createToken({
  name: "MalformedNumber",
  pattern: /-?[0-9]+[a-zA-Z_][a-zA-Z0-9_]*/,
});

// Double-quoted string. Backslash escapes for \" and \\ are honored.
// $var interpolation is handled at evaluation time, not in the lexer.
// `\$` is preserved so that the interpolation pass can recognize the
// escape (REQ-022 ac4, item 9). Other recognized escapes: \n \t \r \" \\.
export const DoubleQuotedString = createToken({
  name: "DoubleQuotedString",
  pattern: /"(?:[^"\\]|\\.)*"/,
});

// Single-quoted string. Literal, no interpolation, no escapes.
export const SingleQuotedString = createToken({
  name: "SingleQuotedString",
  pattern: /'[^']*'/,
});

// Punctuation
export const Equals = createToken({ name: "Equals", pattern: /=/ });

// Comparison and boolean operators (REQ-012 / REQ-013, patch list item 17).
// Order: longer matches first so e.g. `==` wins over `=`, `<=` wins over `<`.
export const EqEq = createToken({ name: "EqEq", pattern: /==/ });
export const NotEq = createToken({ name: "NotEq", pattern: /!=/ });
export const LtEq = createToken({ name: "LtEq", pattern: /<=/ });
export const GtEq = createToken({ name: "GtEq", pattern: />=/ });
export const Lt = createToken({ name: "Lt", pattern: /</ });
export const Gt = createToken({ name: "Gt", pattern: />/ });
export const AndAnd = createToken({ name: "AndAnd", pattern: /&&/ });
export const OrOr = createToken({ name: "OrOr", pattern: /\|\|/ });

// `..` range operator (REQ-014, item 17). Must be declared BEFORE Dot.
export const DotDot = createToken({ name: "DotDot", pattern: /\.\./ });

export const Comma = createToken({ name: "Comma", pattern: /,/ });
export const Colon = createToken({ name: "Colon", pattern: /:/ });
export const Dot = createToken({ name: "Dot", pattern: /\./ });
export const LBracket = createToken({ name: "LBracket", pattern: /\[/ });
export const RBracket = createToken({ name: "RBracket", pattern: /\]/ });
export const LBrace = createToken({ name: "LBrace", pattern: /\{/ });
export const RBrace = createToken({ name: "RBrace", pattern: /\}/ });
export const LParen = createToken({ name: "LParen", pattern: /\(/ });
export const RParen = createToken({ name: "RParen", pattern: /\)/ });
export const Pipe = createToken({ name: "Pipe", pattern: /\|/ });
// `!` — logical-not prefix used inside conditions: `if ! cond then ...`.
// Single character; unambiguous so token order is flexible.
export const Bang = createToken({ name: "Bang", pattern: /!/ });

// Statement terminator. Significant.
export const Newline = createToken({
  name: "Newline",
  pattern: /\r?\n/,
  line_breaks: true,
});

// Line continuation: `\\` followed by newline. Skipped (not a token).
// IMPORTANT: this must be matched BEFORE Newline so the backslash-newline
// pair is consumed as a single skip rather than the newline being kept.
export const LineContinuation = createToken({
  name: "LineContinuation",
  pattern: /\\\r?\n/,
  group: Lexer.SKIPPED,
  line_breaks: true,
});

// Comment: # to end of line (newline NOT consumed — it terminates the statement).
export const Comment = createToken({
  name: "Comment",
  pattern: /#[^\r\n]*/,
  group: Lexer.SKIPPED,
});

// Spaces and tabs (newlines handled separately).
export const WhiteSpace = createToken({
  name: "WhiteSpace",
  pattern: /[ \t]+/,
  group: Lexer.SKIPPED,
});

// ----- Token order matters -----
// Keywords first (with longer_alt: Identifier) so they win over Identifier.
// LineContinuation before Newline. Comment before WhiteSpace doesn't matter
// (both skipped) but kept for readability. Multi-char operators before
// their single-char prefixes (== before =, && before |, .. before .).

export const allTokens = [
  WhiteSpace,
  LineContinuation,
  Comment,
  Newline,
  // Keywords
  For,
  In,
  Done,
  Do,
  While,
  If,
  Then,
  Else,
  Fi,
  Continue,
  Break,
  NullTok,
  TrueTok,
  FalseTok,
  // Variable references and flags (need to be before Identifier because
  // they have prefix characters $ and --/-)
  VarRefTok,
  LongFlag,
  ShortFlag,
  // Literals
  DoubleQuotedString,
  SingleQuotedString,
  // GG-009: MalformedNumber MUST come before NumberLit so the chevrotain
  // longest-match rule catches `1e5` / `1abc` etc. as a single bad token
  // rather than splitting them into NumberLit + Identifier.
  MalformedNumber,
  NumberLit,
  // Multi-char punctuation BEFORE their single-char prefixes
  EqEq,
  NotEq,
  LtEq,
  GtEq,
  AndAnd,
  OrOr,
  DotDot,
  // Single-char punctuation
  Equals,
  Lt,
  Gt,
  Comma,
  Colon,
  Dot,
  LBracket,
  RBracket,
  LBrace,
  RBrace,
  LParen,
  RParen,
  Pipe,
  Bang,
  // Identifier last
  Identifier,
];

export const macroLexer = new Lexer(allTokens, {
  // Throw on unrecognized characters with a useful error.
  errorMessageProvider: {
    buildUnexpectedCharactersMessage: (
      _fullText,
      _startOffset,
      _length,
      line,
      column,
    ) =>
      `Unexpected character at line ${line}, column ${column}. ` +
      `Macro language supports identifiers, $variables, --flags, "strings", 'strings', numbers, [list, literals], { key: value } object literals, and namespace.tool({...}) tool calls.`,
    buildUnableToPopLexerModeMessage: (token) =>
      `Lexer mode error at token "${token.image}".`,
  },
});

// Helper: strip the leading $ from a VarRefTok image.
export function varRefName(image: string): string {
  return image.startsWith("$") ? image.slice(1) : image;
}

// Helper: strip the leading -- from a long flag image.
export function longFlagName(image: string): string {
  return image.startsWith("--") ? image.slice(2) : image;
}

// Helper: split a short-flag image like `-iv` into individual letter flags.
// `-i` -> ["i"]; `-iv` -> ["i", "v"]; `-x9` -> ["x", "9"].
export function shortFlagLetters(image: string): string[] {
  const letters = image.startsWith("-") ? image.slice(1) : image;
  return letters.split("");
}

// Helper: strip surrounding quotes from a string literal image.
// For double-quoted, process \n \t \r \" \\ as named control chars (REQ-011 ac2,
// item 9). The `\$` escape is PRESERVED into the resulting string as `\$` so
// the interpolation pass can detect and suppress it (REQ-022 ac4).
export function unquoteDouble(image: string): string {
  const inner = image.slice(1, -1);
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === "\\" && i + 1 < inner.length) {
      const next = inner[i + 1];
      switch (next) {
        case "n":
          out += "\n";
          i += 2;
          break;
        case "t":
          out += "\t";
          i += 2;
          break;
        case "r":
          out += "\r";
          i += 2;
          break;
        case "\\":
          out += "\\";
          i += 2;
          break;
        case '"':
          out += '"';
          i += 2;
          break;
        case "$":
          // Preserve `\$` so interpolation can detect the suppression.
          out += "\\$";
          i += 2;
          break;
        default:
          // Unknown escape — pass through as the literal character (matches
          // common shell behavior of stripping the backslash).
          out += next;
          i += 2;
          break;
      }
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}
export function unquoteSingle(image: string): string {
  return image.slice(1, -1);
}
