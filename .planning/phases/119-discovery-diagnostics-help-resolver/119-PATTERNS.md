# Phase 119: Discovery Diagnostics & Help Resolver - Pattern Map

**Mapped:** 2026-05-06
**Files analyzed:** 12
**Analogs found:** 12 / 12

## Mandatory Downstream Reading

Downstream planning and implementation agents MUST read these three external docs before planning or implementing:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mcp/tools/llm.ts` | MCP tool/controller | request-response | `src/mcp/tools/llm.ts` discovery branch | exact |
| `src/llm/discovery-content.ts` | utility/service | transform | `src/mcp/tools/llm.ts` inline `modelToResponse` / `purposeToResponse` | exact |
| `src/llm/help-content.ts` | utility | transform | `src/mcp/tools/llm.ts` raw discovery JSON response | role-match |
| `src/llm/capabilities.ts` | utility | transform | `src/llm/capabilities.ts` diagnostics helpers | exact |
| `src/llm/template-tools.ts` | service/utility | file-I/O + transform | `src/llm/template-tools.ts` diagnostics assembly | exact |
| `src/llm/tool-registry.ts` | service/utility | transform | `src/llm/tool-registry.ts` native/template diagnostics merge | exact |
| `tests/unit/llm-tool.test.ts` | test | request-response | existing discovery and ATL-U-15 blocks in same file | exact |
| `tests/unit/llm-template-tools.test.ts` | test | file-I/O + transform | invalid/collision diagnostics tests | role-match |
| `tests/unit/llm-tool-registry.test.ts` | test | transform | native diagnostics and combined registry tests | role-match |
| `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` | test | request-response | `test_discovery_resolvers.py`, `test_call_model_template_discovery.py` | exact |
| `tests/scenarios/directed/testcases/test_discovery_resolvers.py` | test | request-response | same file | exact |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | documentation/test metadata | batch/transform | Phase 118 coverage entry | exact |

## Pattern Assignments

### `src/mcp/tools/llm.ts` (MCP tool/controller, request-response)

**Analog:** `src/mcp/tools/llm.ts`

**Imports pattern** (lines 20-40):
```typescript
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { assertResponseFormatAllowedWithTools, modelCapabilitiesWithDefaults } from '../../llm/capabilities.js';
import { assembleNativeToolRegistry, mergeModelVisibleToolRegistries } from '../../llm/tool-registry.js';
import { assembleTemplateToolRegistry, type TemplateToolDiagnostics } from '../../llm/template-tools.js';
```

**Registration and resolver enum pattern** (lines 291-332):
```typescript
export function registerLlmTools(server: McpServer, config: FlashQueryConfig): void {
  const nativeToolCatalog = getNativeToolCatalog(server);

  server.registerTool(
    'call_model',
    {
      description:
        "Call any configured LLM model directly (resolver='model') or via a named purpose with fallback chain (resolver='purpose'). " +
        "Discovery resolvers (resolver='list_models'/'list_purposes'/'search') return configuration data with no LLM call — name and messages are not required for these. ",
      inputSchema: {
        resolver: z.enum(['model', 'purpose', 'list_models', 'list_purposes', 'search']).describe(
          "'model' to call a specific model alias directly; 'purpose' to walk a named purpose's fallback chain. " +
          "'list_models' / 'list_purposes' / 'search' return configuration data without making an LLM call (no messages required)."
        ),
        name: z.string().optional().describe(
          'Model alias (when resolver=model) or purpose name (when resolver=purpose). ' +
          'Ignored for discovery resolvers (list_models/list_purposes/search).'
        ),
        messages: z.array(callModelMessageSchema).optional(),
      },
    },
```

**Discovery short-circuit pattern** (lines 358-368, 455-479, 482-517):
```typescript
// Must run BEFORE Step 1.5 (reference resolution) — discovery has no messages
// and parseReferences(undefined) would crash. These resolvers read config only,
// make no LLM call, and return JSON directly (NOT CallModelEnvelope).
if (
  params.resolver === 'list_models' ||
  params.resolver === 'list_purposes' ||
  params.resolver === 'search'
) {
  if (params.resolver === 'list_models') {
    const models = cfgModels.map(modelToResponse);
    return { content: [{ type: 'text' as const, text: JSON.stringify({ models }) }] };
  }

  if (params.resolver === 'list_purposes') {
    const purposes = await Promise.all(cfgPurposes.map((purpose) =>
      purposeToResponse(purpose, runtimeTemplateBindingsResult.bindings)
    ));
    return { content: [{ type: 'text' as const, text: JSON.stringify({ purposes }) }] };
  }

  return {
    content: [{ type: 'text' as const, text: JSON.stringify({
      query: queryRaw,
      results: { purposes: matchedPurposes, models: matchedModels },
    }) }],
  };
}
```

**Model/purpose guard pattern after discovery** (lines 520-536):
```typescript
if (params.resolver === 'model' || params.resolver === 'purpose') {
  if (typeof params.name !== 'string' || params.name.length === 0) {
    return {
      content: [{ type: 'text' as const, text: "name is required for resolver='model' or resolver='purpose'" }],
      isError: true,
    };
  }
  if (!params.messages || params.messages.length === 0) {
    return {
      content: [{ type: 'text' as const, text: "messages is required (non-empty array) for resolver='model' or resolver='purpose'" }],
      isError: true,
    };
  }
}
```

**Apply to Phase 119:** Add `help` to the resolver enum, description text, ignored-field descriptions, and the discovery short-circuit. Keep `help` before `name`/`messages`, reference parsing, provider calls, trace snapshots, and usage writes. Prefer delegating raw response shape to `src/llm/help-content.ts` and discovery shape to `src/llm/discovery-content.ts`.

---

### `src/llm/discovery-content.ts` (utility/service, transform)

**Analog:** `src/mcp/tools/llm.ts` inline discovery builders.

**Model projection pattern** (lines 388-408):
```typescript
const modelToResponse = (m: typeof cfgModels[number]): Record<string, unknown> => {
  const entry: Record<string, unknown> = {
    name: m.name,
    type: m.type,
    provider: m.providerName,
    model_id: m.model,
    input_cost_per_million: m.costPerMillion.input,
    output_cost_per_million: m.costPerMillion.output,
  };
  if (m.description !== undefined) entry['description'] = m.description;
  if (m.contextWindow !== undefined) entry['context_window'] = m.contextWindow;
  if (m.tags !== undefined) entry['tags'] = m.tags;
  if (m.capabilities !== undefined) entry['capabilities'] = m.capabilities;
  const prov = providersByName.get(m.providerName);
  if (prov?.local === true) entry['local'] = true;
  else if (prov?.type === 'ollama') entry['local'] = true;
  return entry;
};
```

**Purpose projection pattern** (lines 429-452):
```typescript
const purposeToResponse = async (
  p: typeof cfgPurposes[number],
  runtimeTemplateBindings: RuntimeTemplateBinding[]
): Promise<Record<string, unknown>> => {
  const primaryName = p.models[0];
  const primary = primaryName ? modelsByName.get(primaryName) : undefined;
  const templateRegistry = await assembleTemplateToolRegistry({
    config,
    purposeName: p.name,
    runtimeBindings: runtimeTemplateBindings,
    strictTools: strictToolsForPurpose(p),
  });
  const entry: Record<string, unknown> = {
    name: p.name,
    description: p.description,
    models: p.models,
    input_cost_per_million: primary?.costPerMillion.input ?? 0,
    output_cost_per_million: primary?.costPerMillion.output ?? 0,
    template_tools: templateRegistry.diagnostics.template_tools,
    template_tool_conflicts: templateRegistry.diagnostics.template_tool_conflicts,
    dangling_template_paths: templateRegistry.diagnostics.dangling_template_paths,
  };
  if (p.defaults !== undefined) entry['defaults'] = p.defaults;
  return entry;
};
```

**Apply to Phase 119:** Extract builders without changing raw output conventions. Add native tool diagnostics, template warnings, capability diagnostics, resolver/help search terms, and stable empty arrays additively. Preserve explicit `!== undefined` optional field logic.

---

### `src/llm/help-content.ts` (utility, transform)

**Analog:** raw discovery JSON shape in `src/mcp/tools/llm.ts`.

**Raw JSON MCP response pattern** (lines 455-457, 1001-1004):
```typescript
return { content: [{ type: 'text' as const, text: JSON.stringify({ models }) }] };

// Note: success returns omit `isError` entirely (not false) — matches files.ts pattern.
return {
  content: [{ type: 'text' as const, text: JSON.stringify(envelope) }],
};
```

**Apply to Phase 119:** Build a pure `buildCallModelHelpContent()` style helper returning an object whose top-level insertion order is exactly `summary`, `reference_syntax`, `template_bindings`, `modes`, `envelope`, `errors`, `discovery`, `examples`. Do not return a `CallModelEnvelope`. Do not include `messages` or honor `return_messages`.

---

### `src/llm/capabilities.ts` (utility, transform)

**Analog:** `src/llm/capabilities.ts`

**Capability type/defaulting pattern** (lines 3-38):
```typescript
export type StructuredModelCapabilities = {
  tool_calling?: boolean;
  usage_on_tool_calls?: boolean;
  strict_tools?: boolean;
  parallel_tool_calls?: boolean;
  structured_outputs_with_tools?: boolean;
};

export function modelCapabilitiesWithDefaults(
  model: Pick<LlmModel, 'capabilities'>,
  provider: LlmProvider
): StructuredModelCapabilities {
  const declared = model.capabilities ?? {};
  if (provider.name === 'openai' && provider.type === 'openai-compatible') {
    return { ...ALL_TRUE_CAPABILITIES, ...declared };
  }
  return { ...declared };
}
```

**Unknown-vs-false diagnostic pattern** (lines 48-59, 80-90):
```typescript
function diagnosticForCapability(
  capability: keyof StructuredModelCapabilities,
  value: boolean | undefined,
  modelName: string
): string | null {
  if (value === true) return null;
  const state = value === false ? 'declared unsupported' : 'unknown declaration';
  const remediation = value === undefined
    ? ` — declare 'capabilities.${capability}: true|false' on this model`
    : '';
  return `${state}: model '${modelName}' lacks ${capability}${remediation}`;
}

for (const required of ['tool_calling', 'usage_on_tool_calls'] as const) {
  const diagnostic = diagnosticForCapability(required, caps[required], model.name);
  if (diagnostic) diagnostics.push(diagnostic);
}
```

**Apply to Phase 119:** If capability diagnostics need structured public fields, either export a helper around this exact semantic or keep strings identical. Distinguish `false` as `declared unsupported` and `undefined` as `unknown declaration` with remediation.

---

### `src/llm/template-tools.ts` (service/utility, file-I/O + transform)

**Analog:** `src/llm/template-tools.ts`

**Diagnostics shape and empty-array contract** (lines 37-55, 168-174):
```typescript
export interface TemplateToolDiagnostics {
  template_tools: Array<{ name: string; template_path: string; description: string; parameters: Record<string, unknown> }>;
  template_tool_warnings: Array<{ template_path: string; code: string; message: string; source?: string }>;
  dangling_template_paths: Array<{ template_path: string; source?: string }>;
  template_tool_conflicts: Array<{
    name: string;
    template_paths: string[];
    sources: Array<{ kind: 'template' | 'native'; template_path?: string; name?: string }>;
  }>;
}

function emptyDiagnostics(): TemplateToolDiagnostics {
  return {
    template_tools: [],
    template_tool_warnings: [],
    dangling_template_paths: [],
    template_tool_conflicts: [],
  };
}
```

**Conflict/warning/tool push patterns** (lines 378-390, 414-431, 472-477):
```typescript
diagnostics.template_tool_conflicts.push({
  name,
  template_paths: Array.from(new Set(templatePaths)),
  sources,
});

diagnostics.template_tool_warnings.push({
  template_path: binding.templatePath,
  code: 'dangling_template_path',
  message: `Template binding '${binding.templatePath}' is dangling`,
  source: binding.source,
});

diagnostics.template_tools.push({
  name: tool.name,
  template_path: tool.templatePath,
  description: tool.description,
  parameters: tool.parameters,
});
```

**Apply to Phase 119:** `list_purposes` should surface these arrays directly and keep empty arrays present. Do not duplicate template scanning; call `assembleTemplateToolRegistry`.

---

### `src/llm/tool-registry.ts` (service/utility, transform)

**Analog:** `src/llm/tool-registry.ts`

**Native diagnostics and hard exclusions** (lines 117-125, tests lines 280-298):
```typescript
export const HARD_EXCLUDED_NATIVE_TOOLS = [
  'call_model',
  'register_plugin',
  'unregister_plugin',
  'get_plugin_info',
] as const;

const HARD_EXCLUDED_REASON = 'Tool is not safe for delegated model-visible native access.';
```

```typescript
expect(result.diagnostics.hardExcluded).toEqual([
  { tool: 'call_model', reason: 'Tool is not safe for delegated model-visible native access.' },
  { tool: 'register_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
  { tool: 'unregister_plugin', reason: 'Tool is not safe for delegated model-visible native access.' },
  { tool: 'get_plugin_info', reason: 'Tool is not safe for delegated model-visible native access.' },
]);
```

**Merged collision diagnostics pattern** (lines 366-393):
```typescript
const allCollisions = [
  ...templateDiagnosticsConflicts,
  ...collisions.filter((collision) =>
    !templateDiagnosticsConflicts.some((existing) => existing.name === collision.name)
  ),
];

return {
  nativeToolNames: native.nativeToolNames,
  templateToolNames,
  ...(providerTools.length > 0 ? { providerTools } : {}),
  diagnostics: {
    ...diagnostics,
    template_tool_conflicts: allCollisions,
  },
  collisions: allCollisions,
};
```

**Apply to Phase 119:** For `list_purposes`, expose usable native tool names and public diagnostics from `assembleNativeToolRegistry`, then merge with template diagnostics using existing registry helpers.

---

### `tests/unit/llm-tool.test.ts` (test, request-response)

**Analog:** existing discovery and ATL-U-15 blocks in `tests/unit/llm-tool.test.ts`.

**Handler capture pattern** (lines 290-301):
```typescript
function captureCallModelHandler(config: typeof TEST_CONFIG): HandlerFn {
  const handlers = new Map<string, HandlerFn>();
  const fakeServer = {
    registerTool: vi.fn((name: string, _spec: unknown, handler: HandlerFn) => {
      handlers.set(name, handler);
    }),
  };
  registerLlmTools(fakeServer as any, config);
  const handler = handlers.get('call_model');
  if (!handler) throw new Error('call_model handler not registered');
  return handler;
}
```

**Discovery ignores reference/template params pattern** (lines 416-444):
```typescript
for (const resolver of ['list_models', 'list_purposes'] as const) {
  const res = await handler({
    resolver,
    messages: [{ role: 'user', content: '{{ref:Templates/greeting.md}}' }],
    template_params: { 'Templates/greeting.md': { name: 'Ada' } },
  });
  expect(res.isError).toBeUndefined();
}

const search = await handler({
  resolver: 'search',
  parameters: { query: 'fast' },
  messages: [{ role: 'user', content: '{{ref:@background}}' }],
  template_params: { background: { _items: ['Research/a.md'], _separator: '\n\n' } },
});
expect(search.isError).toBeUndefined();
expect(parseReferences).not.toHaveBeenCalled();
```

**Discovery ignores `return_messages` pattern** (lines 1074-1099):
```typescript
const models = JSON.parse((await handler({ resolver: 'list_models', return_messages: true })).content[0].text) as Record<string, unknown>;
const purposes = JSON.parse((await handler({ resolver: 'list_purposes', return_messages: true })).content[0].text) as Record<string, unknown>;
const search = JSON.parse((await handler({
  resolver: 'search',
  parameters: { query: 'general' },
  return_messages: true,
})).content[0].text) as Record<string, unknown>;

expect(models.models).toBeDefined();
expect(models.messages).toBeUndefined();
expect(purposes.purposes).toBeDefined();
expect(purposes.messages).toBeUndefined();
expect(search.results).toBeDefined();
expect(search.messages).toBeUndefined();
```

**Core discovery contract pattern** (lines 1834-1851, 1985-2017, 2100-2141):
```typescript
const res = await handler({ resolver: 'list_models' });
const body = JSON.parse(res.content[0].text) as any;
expect(Array.isArray(body.models)).toBe(true);
expect(body.models[0]).toMatchObject({
  name: 'fast',
  provider: 'openai',
  model_id: 'gpt-4o-mini',
  input_cost_per_million: 0.15,
  output_cost_per_million: 0.6,
});

const searchRes = await handler({
  resolver: 'search',
  parameters: { query: 'fast' },
  name: 'fast',
  messages: [{ role: 'user', content: 'should be ignored' }],
});
expect(searchRes.isError).toBeUndefined();
```

**Template diagnostics discovery pattern** (lines 2322-2381, 2485-2517):
```typescript
const result = await handler({ resolver: 'list_purposes' });
const payload = JSON.parse(result.content[0].text);

expect(payload.purposes[0]).toMatchObject({
  name: 'reviewer',
  template_tools: expect.arrayContaining([
    expect.objectContaining({
      name: 'flashquery_skill_research_skill',
      template_path: 'Templates/Research-Skill.md',
      description: expect.any(String),
      parameters: expect.any(Object),
    }),
  ]),
  template_tool_conflicts: expect.any(Array),
});
```

**Apply to Phase 119:** Add RED tests here for `resolver: "help"`, stable help key order, raw JSON/no envelope, resolver-list drift, discovery ignoring `messages`/`return_messages`, list_models capability diagnostics, list_purposes native/template diagnostics, and search terms including `tool_calling`, `usage_on_tool_calls`, `template_tools`, `template_tool_conflicts`, `dangling_template_paths`, and `help`.

---

### `tests/unit/llm-template-tools.test.ts` (test, file-I/O + transform)

**Analog:** invalid diagnostics and collision tests.

**Invalid/warning diagnostics pattern** (lines 72-122):
```typescript
const registry = await assembleTemplateToolRegistry({
  config: {
    instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    templates: { defaultAccess: 'permissive' },
    llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
  },
  purposeName: 'researcher',
});

expect(registry.providerTools ?? []).toEqual([]);
expect(JSON.stringify(registry.diagnostics)).toContain('Skill');
```

**Collision diagnostics pattern** (lines 208-240):
```typescript
const registry = await assembleTemplateToolRegistry({
  config: {
    instance: { id: 'unit', vault: { path: vaultPath, markdownExtensions: ['.md'] } },
    templates: { defaultAccess: 'permissive' },
    llm: { purposes: [{ name: 'researcher', description: 'Researcher', models: ['fast'] }] },
  },
  purposeName: 'researcher',
  nativeToolNames: ['flashquery_skill_research_skill'],
});

expect(registry.diagnostics).toMatchObject({
  template_tool_conflicts: [
    {
      name: 'flashquery_skill_research_skill',
      template_paths: expect.arrayContaining(['Templates/Research Skill.md', 'Other/Research-Skill.md']),
    },
  ],
});
```

**Apply to Phase 119:** Extend only if discovery helper extraction changes diagnostics contracts. Keep tests focused on helper source behavior, not MCP response shape.

---

### `tests/unit/llm-tool-registry.test.ts` (test, transform)

**Analog:** native diagnostics and combined registry tests.

**Native diagnostic array pattern** (lines 226-238):
```typescript
const result = assembleNativeToolRegistry(makeConfig(['tier:read-only']), 'research', CATALOG);

expect(result.nativeToolNames).toEqual(READ_ONLY_TOOLS);
expect(result.providerTools?.map((tool) => tool.function.name)).toEqual(READ_ONLY_TOOLS);
expect(result.diagnostics).toEqual({
  expandedTiers: [{ tier: 'tier:read-only', tools: READ_ONLY_TOOLS }],
  explicitTools: [],
  excluded: [],
  hardExcluded: [],
  unknown: [],
});
```

**Combined registry collision pattern** (lines 572-606):
```typescript
const native = assembleNativeToolRegistry(makeConfig(['get_document']), 'research', CATALOG);
const merged = module.mergeModelVisibleToolRegistries({
  native,
  template: {
    providerTools: [
      { type: 'function', function: { name: 'flashquery_skill_research_skill', description: 'Research', parameters: { type: 'object', properties: {} } } },
      { type: 'function', function: { name: 'get_document', description: 'Conflicting template', parameters: { type: 'object', properties: {} } } },
    ],
    templateTools: [
      { name: 'flashquery_skill_research_skill', template_path: 'Templates/Research-Skill.md' },
      { name: 'get_document', template_path: 'Templates/Get Document.md' },
    ],
  },
});

expect(merged.collisions).toEqual([
  expect.objectContaining({
    name: 'get_document',
    template_paths: ['Templates/Get Document.md'],
  }),
]);
```

**Apply to Phase 119:** Extend only if native public diagnostics require renamed or normalized fields. Otherwise consume these diagnostics from `llm-tool.test.ts`.

---

### `tests/scenarios/directed/testcases/test_call_model_help_resolver.py` (test, request-response)

**Analogs:** `test_discovery_resolvers.py`, `test_call_model_template_discovery.py`, `test_call_model_agent_loop_capabilities.py`.

**Directed test skeleton pattern** (`test_discovery_resolvers.py` lines 1-22, 164-177):
```python
#!/usr/bin/env python3
"""
Test: discovery resolver positive scenarios (configured-but-empty + no-args).
Coverage: L-39f, L-39g, L-39h
Modes: --managed
Usage: python test_discovery_resolvers.py --managed
Exit codes: 0 PASS, 2 FAIL, 3 DIRTY
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_test_utils import TestRun, FQCServer
from fqc_client import FQCClient

TEST_NAME = "test_discovery_resolvers"
COVERAGE = ["L-39f", "L-39g", "L-39h", "L-39h_purposes"]

def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--managed", action="store_true", required=True)
    parser.add_argument("--fqc-dir", default=None)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code
```

**Public MCP assertion pattern** (`test_discovery_resolvers.py` lines 66-117):
```python
def _check_models_empty(client: FQCClient) -> tuple[bool, str]:
    r = client.call_tool("call_model", resolver="list_models")
    if not r.ok:
        return False, f"isError true; expected success. text={r.text[:200]}"
    try:
        body = json.loads(r.text)
    except Exception as e:
        return False, f"JSON parse error: {e}"
    ok = body.get("models") == []
    return ok, f"body={body!r}"
```

**Mock-provider no-call pattern** (`test_call_model_template_discovery.py` lines 27-63, 96-150):
```python
class MockProvider:
    def __init__(self) -> None:
        self.requests: list[dict[str, Any]] = []
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.url = f"http://127.0.0.1:{self._server.server_port}"

with MockProvider() as provider:
    with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url), ready_timeout=120) as server:
        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
        result = client.call_tool("call_model", resolver="list_purposes")
        payload = json.loads(result.text or "{}") if result.ok else {}
        run.step(
            "ATL-DS-07 list_purposes exposes template_tools name/template_path/description/parameters",
            passed,
            json.dumps({"purpose": purpose, "provider_requests": provider.requests}, sort_keys=True)[:3000],
            tool_result=result,
        )
```

**Capability diagnostic text pattern** (`test_call_model_agent_loop_capabilities.py` lines 83-104, 110-149):
```python
passed = (
    "server unexpectedly started" not in captured_error
    and expected_capability in captured_error
    and expected_state in captured_error
    and (expected_remediation is None or expected_remediation in captured_error)
)
run.step(label=label, passed=passed, detail=captured_error[-1200:])
```

**Apply to Phase 119:** New scenario should call `call_model` with only `resolver="help"` and assert raw JSON, stable top-level keys, no envelope keys, and no provider requests. It should also call `help` with ignored `name`, `messages`, and `return_messages` to prove discovery semantics. Use deterministic config with a mock provider if asserting zero provider calls.

---

### `tests/scenarios/directed/testcases/test_discovery_resolvers.py` (test, request-response)

**Analog:** same file.

**No-args resolver pattern** (lines 90-117, 142-156):
```python
def _check_no_args_list_purposes(client: FQCClient) -> tuple[bool, str]:
    r = client.call_tool("call_model", resolver="list_purposes")
    if not r.ok:
        return False, f"isError true. text={r.text[:200]}"
    body = json.loads(r.text)
    purposes = body.get("purposes")
    ok = isinstance(purposes, list) and len(purposes) >= 1
    return ok, f"body={body!r}"

ok, detail = _check_no_args_list_purposes(client)
run.step(label="L-39h_purposes: no-args list_purposes returns populated list (Phase 4 Gap 9)",
         passed=ok, detail=detail)
```

**Apply to Phase 119:** Add public coverage for enriched `list_models`, `list_purposes`, and `search` only if the new help scenario does not cover those. Keep helper functions returning `(bool, detail)` and use `run.step(..., tool_result=result)` when useful.

---

### `tests/scenarios/directed/DIRECTED_COVERAGE.md` (documentation/test metadata, batch/transform)

**Analog:** Phase 118 coverage entry.

**Coverage mapping pattern** (lines 796-805):
```markdown
### Phase 118 template discovery and masquerade dispatch — L-91, L-92, L-93, L-94, L-95

**Behaviors covered**
- L-91: ATL-DS-07 public template discovery and purpose listing diagnostics.
- L-92: ATL-DS-08 collision diagnostics and pre-provider `call_model` blocking.
- L-93: ATL-DS-10 template-tool loop with string/document params and recoverable `template_missing_required_param`.
- L-94: ATL-DS-11 mixed native/template loop with native/template calls-log kinds.
- L-95: VAL-118 final green validation gate across unit, integration, E2E, directed, lint, and build checks.
```

**Test mapping pattern** (lines 1459-1460):
```markdown
### test_call_model_agent_loop_capabilities
Covers: L-84, ATL-DS-14, VAL-115
```

**Apply to Phase 119:** Add Phase 119 behaviors after implementation passes. Include `ATL-DS-15` and `VAL-119` references from the ATL Test Plan, plus any new L-* rows the planner creates for `DISC-01` through `DISC-04`.

## Shared Patterns

### MCP Tool Response Shape
**Source:** `src/mcp/tools/llm.ts` lines 455-457, 1001-1004
**Apply to:** `src/mcp/tools/llm.ts`, `src/llm/discovery-content.ts`, `src/llm/help-content.ts`

Successful MCP tool responses return text content and omit `isError`. Errors return the same content shape plus `isError: true`.

### Discovery Before Execution
**Source:** `src/mcp/tools/llm.ts` lines 358-368, 520-536
**Apply to:** all discovery/help resolver work

Discovery/help must run before model/purpose required-field checks, reference parsing, trace snapshots, LLM provider calls, and usage writes.

### Empty Diagnostic Arrays
**Source:** `src/llm/template-tools.ts` lines 168-174; `tests/unit/llm-tool-registry.test.ts` lines 232-238
**Apply to:** `list_purposes`, native tool diagnostics, template diagnostics

Arrays that define a diagnostics contract are present even when empty.

### Unknown vs False Capabilities
**Source:** `src/llm/capabilities.ts` lines 48-59; `test_call_model_agent_loop_capabilities.py` lines 110-149
**Apply to:** `list_models` diagnostics and Mode 2 admission help text

`false` means declared unsupported; `undefined` means unknown declaration and must include remediation such as `capabilities.tool_calling: true|false`.

### Directed Scenario Convention
**Source:** `tests/scenarios/directed/testcases/test_discovery_resolvers.py` lines 1-22, 164-177
**Apply to:** `test_call_model_help_resolver.py`

Use `--managed`, framework import path `parent.parent.parent / "framework"`, `TestRun`, `FQCServer`, `FQCClient`, and `run.summary_lines()`.

## No Analog Found

None. All planned files have exact or role-match analogs in current source and tests.

## Metadata

**Analog search scope:** `src/llm`, `src/mcp/tools`, `tests/unit`, `tests/scenarios/directed/testcases`, `tests/scenarios/directed/DIRECTED_COVERAGE.md`
**Files scanned:** 13 focused files plus project instructions and local skill indexes
**Pattern extraction date:** 2026-05-06
