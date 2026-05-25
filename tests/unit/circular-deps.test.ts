import { beforeAll, describe, expect, it } from 'vitest';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

function runMadgeCircular(): SpawnSyncReturns<string> {
  return spawnSync(
    'npx',
    ['--yes', 'madge@8.0.0', 'src', '--extensions', 'ts', '--circular'],
    { cwd: process.cwd(), encoding: 'utf-8' }
  );
}

function madgeOutput(result: SpawnSyncReturns<string>): string {
  if (result.error) {
    throw result.error;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  expect(output).toContain('circular dependenc');
  expect(output).toContain('Processed ');
  return output;
}

function expectNoForbiddenFragment(output: string, label: string, fragments: string[]): void {
  const matchingLines = output
    .split(/\r?\n/)
    .filter((line) => fragments.every((fragment) => line.includes(fragment)));

  expect(
    matchingLines,
    `${label} forbidden circular dependency fragment still present:\n${matchingLines.join('\n') || output}`
  ).toEqual([]);
}

describe('Phase 149 targeted circular dependency gate', () => {
  let output: string;

  beforeAll(() => {
    output = madgeOutput(runMadgeCircular());
  }, 30_000);

  it('T-U-022 keeps REQ-010 document/plugin target cycles absent from madge output', () => {
    expectNoForbiddenFragment(output, 'REQ-010 document resolver to MCP document tools', [
      'mcp/utils/resolve-document.ts',
      'mcp/tools/documents.ts',
    ]);
    expectNoForbiddenFragment(output, 'REQ-010 scanner to MCP document tools', [
      'services/scanner.ts',
      'mcp/tools/documents.ts',
    ]);
    expectNoForbiddenFragment(output, 'REQ-010 plugin reconciliation to MCP document tools', [
      'services/plugin-reconciliation.ts',
      'mcp/tools/documents.ts',
    ]);
    expectNoForbiddenFragment(output, 'REQ-010 document/plugin named cluster', [
      'mcp/utils/document-output.ts',
      'mcp/utils/resolve-document.ts',
      'services/plugin-propagation.ts',
      'services/plugin-reconciliation.ts',
    ]);
    expectNoForbiddenFragment(output, 'REQ-010 document-output to document resolver', [
      'mcp/utils/document-output.ts',
      'mcp/utils/resolve-document.ts',
    ]);
  });

  it('T-U-024 keeps REQ-011 macro helper to evaluator target cycles absent from madge output', () => {
    const helperFiles = [
      'macro/builtins.ts',
      'macro/shell-verbs.ts',
      'macro/dispatcher.ts',
      'macro/registry.ts',
      'macro/budget.ts',
      'macro/coerce.ts',
      'macro/dry-run.ts',
      'macro/forbidden-flag-scan.ts',
      'macro/introspection.ts',
      'macro/path-wrapper.ts',
      'macro/preflight.ts',
      'macro/progress-emitter.ts',
      'macro/task-registry.ts',
    ];

    for (const helper of helperFiles) {
      expectNoForbiddenFragment(output, `REQ-011 ${helper} to evaluator`, [
        helper,
        'macro/evaluator.ts',
      ]);
    }
    expectNoForbiddenFragment(output, 'REQ-011 macro types to evaluator', [
      'macro/types.ts',
      'macro/evaluator.ts',
    ]);
  });
});
