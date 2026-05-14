import { describe, expect, it, vi } from 'vitest';
import { preScanToolReferences } from '../../src/macro/permission-prescan.js';
import type { ToolFn, ToolRegistry } from '../../src/macro/types.js';
import { parseProgram } from './macro-test-helpers.js';

function parseEnvelope(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]?.text ?? '{}') as Record<string, unknown>;
}

function registry(): ToolRegistry {
  const noop: ToolFn = vi.fn(async () => ({ ok: true }));
  return {
    fq: {
      label: 'FlashQuery',
      tools: {
        search: noop,
        call_model: noop,
      },
    },
    templates: {
      label: 'Template Tools',
      tools: {
        flashquery_template_brief: noop,
      },
    },
  };
}

describe('macro hard exclusions', () => {
  it('T-U-165 reports fq.call_macro as unknown_tool for every macro caller', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_macro({ source: "exit 1" })'),
      registry: registry(),
      allowlist: new Set(['fq.search']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'unknown_tool',
      details: {
        server: 'fq',
        tool: 'call_macro',
      },
    });
  });

  it('T-U-166 reports template masquerade references with template_masquerade_tools_not_callable_from_macro', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit templates.flashquery_template_brief({ topic: "dispatch" })'),
      registry: registry(),
      allowlist: new Set(['templates.flashquery_template_brief']),
      templateToolNames: new Set(['templates.flashquery_template_brief']),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'template_masquerade_tools_not_callable_from_macro',
      details: {
        server: 'templates',
        tool: 'flashquery_template_brief',
      },
    });
  });

  it('T-U-167 allows host fq.call_model when resolveHostToolExposure exposes it', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_model({ resolver: "purpose", name: "research" })'),
      registry: registry(),
      allowlist: new Set(['fq.call_model']),
      callerContext: { origin: 'host' },
    });

    expect(result).toBeUndefined();
  });

  it('T-U-168 rejects delegated fq.call_model with recursive_model_excluded_from_delegated_macros', () => {
    const result = preScanToolReferences({
      program: parseProgram('exit fq.call_model({ resolver: "purpose", name: "research" })'),
      registry: registry(),
      allowlist: new Set(['fq.search']),
      callerContext: { origin: 'delegated', purposeName: 'research' },
      hardExcludedReasons: new Map([
        ['fq.call_model', 'recursive_model_excluded_from_delegated_macros'],
      ]),
    });

    expect(parseEnvelope(result)).toMatchObject({
      error: 'forbidden_tools',
      details: {
        forbidden: ['fq.call_model'],
        reason: 'recursive_model_excluded_from_delegated_macros',
      },
    });
  });
});
