import { describe, expect, it } from 'vitest';
import { parseMacroSource } from '../../src/macro/parser.js';
import {
  AndAnd,
  BangEq,
  Do,
  Done,
  DoubleQuotedString,
  Else,
  EqEq,
  Fi,
  For,
  GreaterEq,
  GreaterThan,
  Identifier,
  If,
  In,
  LessEq,
  LessThan,
  NullTok,
  NumberLit,
  OrOr,
  Range,
  SingleQuotedString,
  Then,
  While,
  macroLexer,
  unquoteDouble,
  unquoteSingle,
  validateDoubleQuotedEscapes,
} from '../../src/macro/tokens.js';

function tokenNames(source: string): string[] {
  const result = macroLexer.tokenize(source);
  expect(result.errors).toEqual([]);
  return result.tokens.map((token) => token.tokenType.name);
}

describe('macro lexer', () => {
  it('T-U-019 lexes all ten v0 reserved keywords as keyword tokens', () => {
    expect(tokenNames('for in do done if then else fi while null')).toEqual([
      For.name,
      In.name,
      Do.name,
      Done.name,
      If.name,
      Then.name,
      Else.name,
      Fi.name,
      While.name,
      NullTok.name,
    ]);
  });

  it('T-U-020 lexes keyword prefixes as identifiers via longer_alt', () => {
    expect(tokenNames('forecasted')).toEqual([Identifier.name]);
  });

  it('T-U-024 lexes signed integers as a single NumberLit', () => {
    const result = macroLexer.tokenize('-5');
    expect(result.errors).toEqual([]);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.tokenType).toBe(NumberLit);
  });

  it('T-U-025 lexes signed decimal floats as a single NumberLit', () => {
    const result = macroLexer.tokenize('-3.14');
    expect(result.errors).toEqual([]);
    expect(result.tokens).toHaveLength(1);
    expect(result.tokens[0]?.tokenType).toBe(NumberLit);
  });

  it('T-U-026 does not accept exponent, hex, or octal as a single number literal', () => {
    for (const literal of ['1e5', '0xFF', '0o7']) {
      const result = parseMacroSource(`x = ${literal}`);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.error).toBe('parse_error');
      expect(['unexpected_token', 'invalid_literal']).toContain(result.error.details.reason);
    }
  });

  it('T-U-027 accepts the complete double-quoted escape table', () => {
    const source = String.raw`"a\n\t\"\$\\\r"`;
    const result = macroLexer.tokenize(source);
    expect(result.errors).toEqual([]);
    expect(result.tokens[0]?.tokenType).toBe(DoubleQuotedString);
    expect(validateDoubleQuotedEscapes(source)).toBe(true);
    expect(unquoteDouble(source)).toBe('a\n\t"$\\\r');
  });

  it('T-U-028 rejects unknown double-quoted escapes as invalid literals', () => {
    const result = macroLexer.tokenize(String.raw`"bad\q"`);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(validateDoubleQuotedEscapes(String.raw`"bad\q"`)).toBe(false);
  });

  it('T-U-029 keeps single-quoted strings fully literal', () => {
    const source = String.raw`'$name\n'`;
    const result = macroLexer.tokenize(source);
    expect(result.errors).toEqual([]);
    expect(result.tokens[0]?.tokenType).toBe(SingleQuotedString);
    expect(unquoteSingle(source)).toBe(String.raw`$name\n`);
  });

  it('T-U-034 lexes comparison and boolean operators as distinct tokens', () => {
    expect(tokenNames('== != < > <= >= && ||')).toEqual([
      EqEq.name,
      BangEq.name,
      LessThan.name,
      GreaterThan.name,
      LessEq.name,
      GreaterEq.name,
      AndAnd.name,
      OrOr.name,
    ]);
  });

  it('T-U-043 lexes 0..10 as integer range integer', () => {
    const result = macroLexer.tokenize('0..10');
    expect(result.errors).toEqual([]);
    expect(result.tokens.map((token) => token.tokenType.name)).toEqual([
      NumberLit.name,
      Range.name,
      NumberLit.name,
    ]);
    expect(result.tokens.map((token) => token.image)).toEqual(['0', '..', '10']);
  });
});
