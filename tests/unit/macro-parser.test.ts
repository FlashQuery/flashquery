import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { MacroParseErrorReason } from '../../src/macro/errors.js';
import { parseMacroSource } from '../../src/macro/parser.js';
import { BUILTIN_NAMES } from '../../src/macro/tokens.js';
import type {
  BinaryExpr,
  Binding,
  Call,
  IfStmt,
  Pipeline,
  ToolCall,
  ToolExistsCall,
} from '../../src/macro/types.js';

function parse(source: string) {
  const result = parseMacroSource(source, 'fixture.fqm');
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.program;
}

function parseError(source: string) {
  const result = parseMacroSource(source, 'fixture.fqm');
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected parse error');
  expect(result.error.error).toBe('parse_error');
  return result.error;
}

function collectToolExistsCalls(value: unknown): ToolExistsCall[] {
  if (!value || typeof value !== 'object') {
    return [];
  }

  if ((value as { kind?: unknown }).kind === 'ToolExistsCall') {
    return [value as ToolExistsCall];
  }

  const calls: ToolExistsCall[] = [];
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      calls.push(...child.flatMap((item) => collectToolExistsCalls(item)));
    } else {
      calls.push(...collectToolExistsCalls(child));
    }
  }
  return calls;
}

const V0_PARSE_REASONS = [
  'unexpected_token',
  'missing_do',
  'missing_done',
  'missing_then',
  'missing_fi',
  'malformed_fence_attributes',
  'reserved_keyword_assignment',
  'builtin_name_shadowing',
  'invalid_literal',
  'input_var_key_must_be_literal',
] as const satisfies readonly MacroParseErrorReason[];

function describeParseReason(reason: MacroParseErrorReason): string {
  switch (reason) {
    case 'unexpected_token':
      return 'unexpected token';
    case 'missing_do':
      return 'missing do';
    case 'missing_done':
      return 'missing done';
    case 'missing_then':
      return 'missing then';
    case 'missing_fi':
      return 'missing fi';
    case 'malformed_fence_attributes':
      return 'malformed fence attributes';
    case 'reserved_keyword_assignment':
      return 'reserved keyword assignment';
    case 'builtin_name_shadowing':
      return 'builtin name shadowing';
    case 'invalid_literal':
      return 'invalid literal';
    case 'input_var_key_must_be_literal':
      return 'input_var key must be literal';
    default: {
      const exhaustive: never = reason;
      return exhaustive;
    }
  }
}

describe('macro parser', () => {
  it('T-U-021 rejects reserved keyword assignment', () => {
    expect(parseError('for = 5').details).toMatchObject({
      reason: 'reserved_keyword_assignment',
      at_line: 1,
      near_token: 'for',
    });
  });

  it('T-U-022 rejects builtin name shadowing', () => {
    expect(parseError('echo = "hello"').details).toMatchObject({
      reason: 'builtin_name_shadowing',
      at_line: 1,
      near_token: 'echo',
    });
  });

  it('T-U-023 rejects variable shadowing for every builtin name', () => {
    for (const name of BUILTIN_NAMES) {
      expect(parseError(`${name} = 1`).details).toMatchObject({
        reason: 'builtin_name_shadowing',
        near_token: name,
      });
    }
  });

  it('T-U-030 parses empty and trailing-comma lists', () => {
    const statements = parse('a = []\nb = [1,]\nc = [1, 2, 3,]').statements as Binding[];
    expect(statements[0]?.value).toMatchObject({ kind: 'ListLit', items: [] });
    expect((statements[1]?.value as { items: unknown[] }).items).toHaveLength(1);
    expect((statements[2]?.value as { items: unknown[] }).items).toHaveLength(3);
  });

  it('T-U-031 parses empty and trailing-comma objects', () => {
    const statements = parse('a = {}\nb = {k: 1,}').statements as Binding[];
    expect(statements[0]?.value).toMatchObject({ kind: 'ObjectLit', entries: [] });
    expect(statements[1]?.value).toMatchObject({ kind: 'ObjectLit' });
  });

  it('T-U-032 parses null as a first-class value', () => {
    const [binding] = parse('x = null').statements as Binding[];
    expect(binding?.value).toEqual({ kind: 'NullLit' });
  });

  it('T-U-033 ignores comments and parses the next statement', () => {
    expect(parse('# comment\na = 1').statements).toHaveLength(1);
  });

  it('T-U-042 parses boolean precedence as a || (b && c)', () => {
    const [binding] = parse('x = $a || $b && $c').statements as Binding[];
    const root = binding?.value as BinaryExpr;
    expect(root.op).toBe('||');
    expect((root.right as BinaryExpr).op).toBe('&&');
  });

  it('T-U-052 rejects Pascal-style for loops with near_token info', () => {
    expect(parseError('for i = 1 to 10').details.near_token).toBe('=');
  });

  it('T-U-053 parses while loops', () => {
    const [loop] = parse('while $cond do\necho "x"\ndone').statements;
    expect(loop).toMatchObject({ kind: 'WhileLoop' });
  });

  it('T-U-054 parses for loops requiring do', () => {
    const [loop] = parse('for X in $list do\necho $X\ndone').statements;
    expect(loop).toMatchObject({ kind: 'ForLoop', varName: 'X' });
  });

  it('T-U-055 returns missing_do for old for-loop syntax', () => {
    expect(parseError('for X in $list\necho $X\ndone').details.reason).toBe('missing_do');
  });

  it('T-U-056 returns missing_do for old while-loop syntax', () => {
    expect(parseError('while $cond\necho "x"\ndone').details.reason).toBe('missing_do');
  });

  it('T-U-040 rejects continue outside a loop at parse time', () => {
    expect(parseError('continue').details).toMatchObject({
      reason: 'loop_control_outside_loop',
      at_line: 1,
      near_token: 'continue',
    });
  });

  it('T-U-041 rejects break outside a loop at parse time', () => {
    expect(parseError('break').details).toMatchObject({
      reason: 'loop_control_outside_loop',
      at_line: 1,
      near_token: 'break',
    });
  });

  it('parses continue and break inside loop bodies', () => {
    const [forLoop, whileLoop] = parse(`
      for item in [1,2] do
        continue
        break
      done
      while $keep_going do
        continue
        break
      done
    `).statements;

    expect(forLoop).toMatchObject({
      kind: 'ForLoop',
      body: [{ kind: 'ContinueStmt' }, { kind: 'BreakStmt' }],
    });
    expect(whileLoop).toMatchObject({
      kind: 'WhileLoop',
      body: [{ kind: 'ContinueStmt' }, { kind: 'BreakStmt' }],
    });
  });

  it('parses loop control inside nested if bodies within loops', () => {
    const [forLoop] = parse(`
      for item in [1,2] do
        if $item == 1 then
          continue
        else
          break
        fi
      done
    `).statements;

    expect(forLoop).toMatchObject({
      kind: 'ForLoop',
      body: [
        {
          kind: 'IfStmt',
          thenBody: [{ kind: 'ContinueStmt' }],
          elseBody: [{ kind: 'BreakStmt' }],
        },
      ],
    });
  });

  it('T-U-059 parses normal tool calls as statements and assignment RHS', () => {
    const [statement, binding] = parse(
      'fq.search({query: "x"})\nresult = fq.search({query: "x"})'
    ).statements;
    expect(statement).toMatchObject({ kind: 'ToolCall', server: 'fq', tool: 'search' });
    expect((binding as Binding).value).toMatchObject({
      kind: 'ToolCall',
      server: 'fq',
      tool: 'search',
    });
  });

  it('T-U-060 parses variables and field access inside object literal args', () => {
    const [binding] = parse('result = fq.write_document({path: $doc.path, tags: [$tag,]})')
      .statements as Binding[];
    const call = binding?.value as ToolCall;
    expect(call.arg).toMatchObject({ kind: 'ObjectLit' });
  });

  it('T-U-061 parses _exists namespace introspection in conditions', () => {
    const [statement] = parse('if fq._exists() then\necho "ok"\nfi').statements as IfStmt[];
    expect(statement.condition).toEqual({
      kind: 'ToolExistsCall',
      server: 'fq',
      method: '_exists',
      line: 1,
    });

    const [brokered] = parse('if brave_search._exists() then\necho "ok"\nfi')
      .statements as IfStmt[];
    expect(brokered.condition).toEqual({
      kind: 'ToolExistsCall',
      server: 'brave_search',
      method: '_exists',
      line: 1,
    });
  });

  it('T-U-062 rejects dotted server names while parsing underscore namespace methods', () => {
    expect(parseError('a.b.tool({})').details.reason).toBe('unexpected_token');
    expect(parseError('fq.x._exists()').details.reason).toBe('unexpected_token');

    const [statement] = parse('if fq._missing() then\necho "ok"\nfi').statements as IfStmt[];
    expect(statement.condition).toEqual({
      kind: 'ToolExistsCall',
      server: 'fq',
      method: '_missing',
      line: 1,
    });
  });

  it('T-U-063 returns structured parse_error envelopes', () => {
    const error = parseError('x = [1,');
    expect(error).toMatchObject({ error: 'parse_error', details: { reason: 'unexpected_token' } });
  });

  it('T-U-064 reports 1-indexed line numbers', () => {
    expect(parseError('x = 1\ny = [').details.at_line).toBe(2);
  });

  it('T-U-065 includes near_token for offending tokens', () => {
    expect(parseError('x = [1 2]').details.near_token).toBe('2');
  });

  it('T-U-066 uses stable snake_case reason values', () => {
    for (const reason of V0_PARSE_REASONS) {
      expect(reason).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(describeParseReason(reason)).not.toBe('');
    }
  });

  it('parses comparison operators into BinaryExpr nodes', () => {
    const [binding] = parse('x = $a <= 5').statements as Binding[];
    expect(binding?.value).toMatchObject({ kind: 'BinaryExpr', op: '<=' });
  });

  it('parses range expressions as RangeExpr nodes', () => {
    const [binding] = parse('x = 0..10').statements as Binding[];
    expect(binding?.value).toMatchObject({ kind: 'RangeExpr' });
  });

  it('parses range 5 and range $start $end builtin calls', () => {
    const statements = parse('a = range 5\nb = range $start $end').statements as Binding[];
    expect((statements[0]?.value as Call).name).toBe('range');
    expect((statements[1]?.value as Call).args).toHaveLength(2);
  });

  it('parses for i in range 5 do as a call iterable', () => {
    const [loop] = parse('for i in range 5 do\necho $i\ndone').statements;
    expect(loop).toMatchObject({ kind: 'ForLoop', iterable: { kind: 'Call', name: 'range' } });
  });

  it('parses pipelines as Pipeline statements', () => {
    const [pipeline] = parse('echo "x" | count').statements as Pipeline[];
    expect(pipeline.kind).toBe('Pipeline');
    expect(pipeline.stages).toHaveLength(2);
  });

  it('parses all 17 migrated POC examples from tests/fixtures/macro/examples', () => {
    const fixtureDir = join(process.cwd(), 'tests/fixtures/macro/examples');
    const files = readdirSync(fixtureDir)
      .filter((file) => file.endsWith('.fqm'))
      .sort();

    expect(files).toHaveLength(17);
    for (const file of files) {
      const source = readFileSync(join(fixtureDir, file), 'utf8');
      const result = parseMacroSource(source, file);
      expect(result.ok, `${file}: ${JSON.stringify(result)}`).toBe(true);
    }
  });

  it('parses migrated POC _exists fixtures as ToolExistsCall nodes', () => {
    const fixtureDir = join(process.cwd(), 'tests/fixtures/macro/examples');
    const expectedServersByFile = new Map([
      ['09-research-pattern.fqm', ['brave_search', 'web_fetch']],
      ['10-adaptive-research.fqm', ['brave_search']],
      ['11-fail-missing-server.fqm', ['pretend_search']],
    ]);

    for (const [file, expectedServers] of expectedServersByFile) {
      const source = readFileSync(join(fixtureDir, file), 'utf8');
      const result = parseMacroSource(source, file);
      expect(result.ok, `${file}: ${JSON.stringify(result)}`).toBe(true);
      if (!result.ok) continue;

      expect(collectToolExistsCalls(result.program).map((call) => call.server)).toEqual(
        expectedServers
      );
    }
  });
});
