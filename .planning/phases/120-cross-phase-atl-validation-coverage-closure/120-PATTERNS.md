# Phase 120: Cross-Phase ATL Validation & Coverage Closure - Pattern Map

**Mapped:** 2026-05-07
**Files analyzed:** 11 likely new/modified files or file groups
**Analogs found:** 11 / 11

## Downstream Read-First Rule

All implementation agents MUST read these product contract documents before editing tests, ledgers, helpers, or validation artifacts:

- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Agentic-LLM-Tool-Loop.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/Document Reference System.md`
- `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Agentic Tool Loop and Doc References/ATL Test Plan.md`

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `tests/e2e/call-model-agent-loop.e2e.test.ts` | test | request-response | `tests/e2e/call-model-agent-loop.e2e.test.ts` | exact |
| `tests/e2e/call-model-template-tools.e2e.test.ts` | test | request-response | `tests/e2e/call-model-template-tools.e2e.test.ts` | exact |
| `tests/scenarios/integration/tests/llm_template_reference_freshness.yml` | test | request-response | `tests/scenarios/integration/tests/llm_ref_reflects_current_write_state.yml` | exact |
| `tests/scenarios/integration/tests/llm_template_document_param_freshness.yml` | test | request-response | `tests/scenarios/integration/tests/llm_ref_reflects_current_write_state.yml`; `tests/e2e/call-model-template-tools.e2e.test.ts` | role-match |
| `tests/scenarios/integration/tests/llm_discovery_then_call.yml` | test | request-response | `tests/scenarios/integration/tests/llm_discovery_then_call.yml` | exact |
| `tests/scenarios/integration/tests/llm_mixed_reference_modes.yml` | test | request-response | `tests/scenarios/integration/tests/llm_reference_syntax_section.yml`; `tests/scenarios/integration/tests/llm_mixed_ref_and_id_placeholders.yml` | role-match |
| `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | docs/coverage | batch | `tests/scenarios/integration/INTEGRATION_COVERAGE.md` | exact |
| `tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py` or `test_call_model_agent_loop_budgets.py` extension | test | request-response / event-driven | `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py` | role-match |
| `tests/scenarios/framework/fqc_test_utils.py` | utility | event-driven | `tests/scenarios/framework/fqc_test_utils.py` | exact |
| `tests/scenarios/directed/DIRECTED_COVERAGE.md` | docs/coverage | batch | `tests/scenarios/directed/DIRECTED_COVERAGE.md` | exact |
| `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md` | docs/audit | batch | `.planning/phases/119-discovery-diagnostics-help-resolver/119-VALIDATION.md` | role-match |

## Pattern Assignments

### `tests/e2e/call-model-agent-loop.e2e.test.ts` (test, request-response)

**Analog:** `tests/e2e/call-model-agent-loop.e2e.test.ts`

**Imports and mock-provider pattern** (lines 1-8, 14-49):
```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

class ScriptedOpenAiProvider {
  readonly requests: Record<string, unknown>[] = [];
  // http.createServer captures request JSON and shifts scripted responses.
}
```

**Managed stdio MCP fixture** (lines 88-175):
```typescript
async function withManagedMcp<T>(provider: ScriptedOpenAiProvider, fn: (client: Client) => Promise<T>): Promise<T> {
  const tempDir = await mkdtemp(join(tmpdir(), 'fqc-agent-loop-e2e-'));
  const configPath = join(tempDir, 'flashquery.yml');
  const entryPoint = resolve('src/index.ts');
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['tsx', entryPoint, 'start', '--config', configPath],
    stderr: 'pipe',
    env: process.env as Record<string, string>,
    cwd: projectRoot,
  });
  try {
    await client.connect(transport);
    return await fn(client);
  } finally {
    await client.close().catch(() => undefined);
    await transport.close().catch(() => undefined);
    await rm(tempDir, { recursive: true, force: true });
  }
}
```

**Core ATL E2E assertion pattern** (lines 186-220, 260-285, 312-344):
```typescript
it('ATL-E2E-02 runs a native tool loop and returns final_response calls_log metadata', async () => {
  const envelope = await withManagedMcp(provider, (client) => callModel(client, {
    resolver: 'purpose',
    name: 'agentic',
    messages: [{ role: 'user', content: 'ATL-E2E-02 use search_documents then answer.' }],
    return_messages: true,
  }));
  expect(envelope).toMatchObject({
    response: 'native loop complete',
    metadata: { tools: { stop_reason: 'final_response', calls_log: expect.any(Array) } },
  });
  expect(provider.requests[1]).toMatchObject({
    messages: expect.arrayContaining([expect.objectContaining({ role: 'tool' })]),
  });
});
```

Use this file for any `ATL-E2E-01` / `ATL-E2E-08` additions that need deterministic provider failures, capability rejection, `return_messages`, Mode 1 envelope checks, or fallback/cost assertions.

### `tests/e2e/call-model-template-tools.e2e.test.ts` (test, request-response)

**Analog:** `tests/e2e/call-model-template-tools.e2e.test.ts`

**Template fixture and vault seeding pattern** (lines 104-194):
```typescript
async function writeDoc(vaultPath: string, relPath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  const path = join(vaultPath, relPath);
  await mkdir(dirname(path), { recursive: true });
  const yaml = Object.entries(frontmatter).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
  await writeFile(path, `---\n${yaml}\n---\n\n${body}`);
}

await writeDoc(vaultPath, 'Templates/Source-Skill.md', {
  fq_template: true,
  fq_expose_as_tool: true,
  fq_namespace: 'skill',
  fq_params: { topic: { type: 'string', required: true }, source: { type: 'document', required: true } },
}, 'Source skill says {{topic}} with {{source}}.');
```

**Template and mixed loop assertions** (lines 223-257, 325-345, 351-377):
```typescript
expect(provider.requests[0]).toMatchObject({
  tools: expect.arrayContaining([
    expect.objectContaining({ function: expect.objectContaining({ name: 'flashquery_skill_research_skill' }) }),
  ]),
});
expect(JSON.stringify(provider.requests[1])).toContain('Source skill says ATL-E2E-04 document');
expect(JSON.stringify(provider.requests[1])).toContain('Native document body.');

const kinds = callsLog.flatMap((entry) => entry.tool_calls ?? []).map((call) => call.kind);
expect(kinds).toEqual(expect.arrayContaining(['native', 'template']));
```

Use this analog for template-tool freshness, document-parameter hydration, mixed native/template loops, and recoverable template-tool error E2E work.

### `tests/scenarios/integration/tests/*.yml` (test, request-response)

**Analogs:** `llm_ref_reflects_current_write_state.yml`, `llm_discovery_then_call.yml`, `llm_reference_syntax_section.yml`, `llm_mixed_ref_and_id_placeholders.yml`

**YAML test header and deps pattern** (`llm_ref_reflects_current_write_state.yml` lines 1-10):
```yaml
name: llm_ref_reflects_current_write_state
description: >
  Reference resolution reads the document's current write state, not a stale
  cached snapshot.
coverage: [IX-10]
deps: [llm]
```

**Action, binding, update, and call_model assert pattern** (`llm_ref_reflects_current_write_state.yml` lines 11-46):
```yaml
- label: "Setup: write document with body A containing token ALPHA-TOKEN"
  action: vault.write
  name: state_doc
  path: "Test/ref-current-state.md"
  title: "Ref Current State"
  content: "The marker is ALPHA-TOKEN."

- label: "Update the document body to contain BETA-TOKEN instead"
  action: update_document
  args:
    identifier: "${state_doc.fq_id}"
    content: "The marker is BETA-TOKEN."

- label: "call_model {{ref:doc.md}} now sees body B"
  assert:
    op: call_model
    args:
      resolver: model
      name: fast
      messages:
        - role: user
          content: "{{ref:_integration/Test/ref-current-state.md}} What marker token is in the document?"
    expect_contains: "BETA-TOKEN"
```

**Discovery-to-call closure pattern** (`llm_discovery_then_call.yml` lines 10-38, 40-67):
```yaml
- label: "list_models returns the configured 'fast' model"
  assert:
    op: call_model
    args:
      resolver: list_models
    expect_contains: '"name":"fast"'

- label: "call_model with resolver=model and name=fast succeeds"
  assert:
    op: call_model
    args:
      resolver: model
      name: fast
      messages:
        - role: user
          content: "Reply with the single word: OK"
    expect_not_contains: '"isError":true'
```

**Reference section and negative assertion pattern** (`llm_reference_syntax_section.yml` lines 23-57):
```yaml
- label: "call_model with {{ref:path#Target Section}} sees only the target section"
  assert:
    op: call_model
    args:
      resolver: model
      name: fast
      messages:
        - role: user
          content: "{{ref:_integration/Test/ref-inject-section.md#Target Section}} What is the secret code?"
    expect_contains: "alpha-bravo-charlie"

- label: "Non-target trailer section is excluded"
  assert:
    op: call_model
    args: { ... }
    expect_not_contains: "SECT_TRAILER"
```

**YAML format rules to copy from README** (`tests/scenarios/integration/README.md` lines 116-129, 140-167, 199-246, 262-318):
```yaml
name: write_then_search
description: >
  Human-readable explanation of what this test verifies.
coverage: [IS-01, IS-02]
deps: [embeddings]

steps:
  - label: "Write a document"
    action: vault.write
    name: ocean_doc
    path: "nature/ocean.md"
```

Key constraints: action args are top-level except reserved names, assert args are nested under `assert.args`, `vault.write` paths are auto-prefixed with `_integration/`, `vault.write` binds `fqc_id/path/title/status`, and unmet `deps:` are SKIP not FAIL.

### `tests/scenarios/integration/INTEGRATION_COVERAGE.md` (docs/coverage, batch)

**Analog:** `tests/scenarios/integration/INTEGRATION_COVERAGE.md`

**Coverage row format** (lines 145-182):
```markdown
| ID     | Behavior | Covered By | Date Updated | Last Passing |
|--------|----------|------------|--------------|--------------|
| IL-21  | call_model with {{ref:...}} writes a fqc_llm_usage row ... | llm_ref_writes_usage_row | 2026-05-04 | 2026-05-04 |
| IL-35  | ATL-INT-04: Runtime-vs-YAML template binding precedence survives restart ... | llm-config-sync.test.ts | 2026-05-06 | 2026-05-06 |
```

For Phase 120, append or revise `IL-*` rows for final local mappings of `ATL-INT-01`, `ATL-INT-02`, `ATL-INT-03`, and `ATL-INT-05`. Preserve explicit layer exceptions like `IL-35` when no public YAML scenario surface exists.

### `tests/scenarios/directed/testcases/test_call_model_agent_loop_shutdown.py` (test, event-driven request-response)

**Analog:** `tests/scenarios/directed/testcases/test_call_model_agent_loop_budgets.py`

**Imports and identity pattern** (lines 1-23):
```python
#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import socket
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))
from fqc_client import FQCClient
from fqc_test_utils import FQCServer, TestRun

TEST_NAME = "test_call_model_agent_loop_budgets"
COVERAGE = ["ATL-DS-12", "VAL-117"]
```

**Mock provider pattern** (lines 32-98, 160-235):
```python
class SlowToolProvider:
    def __init__(self, delay_ms: int) -> None:
        self.requests: list[dict[str, Any]] = []
        self._delay_seconds = delay_ms / 1000.0
        self._server = ThreadingHTTPServer(("127.0.0.1", _free_port()), self._handler())
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)
        self.url = f"http://127.0.0.1:{self._server.server_port}"
```

**Managed server + public MCP assertion pattern** (lines 249-332, 383-414):
```python
run = TestRun(TEST_NAME)
with SlowToolProvider(delay_ms=800) as slow_provider:
    with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(slow_provider.url)) as server:
        client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
        timeout_result = client.call_tool(
            "call_model",
            resolver="purpose",
            name="agentic_budgets",
            messages=[{"role": "user", "content": "ATL-DS-12 wall-clock timeout"}],
            parameters={"max_iterations": 4, "timeout_ms": 400},
            trace_id="atl-ds-12-timeout",
        )
        timeout_envelope = json.loads(timeout_result.text) if timeout_result.ok else {}
        timeout_passed = timeout_result.ok and timeout_tools.get("stop_reason") == "timeout"
        run.step(label="ATL-DS-12 wall-clock timeout returns stop_reason: 'timeout'", passed=timeout_passed, ...)
```

**CLI pattern** (lines 419-431):
```python
def main() -> int:
    parser = argparse.ArgumentParser(description=TEST_NAME)
    parser.add_argument("--fqc-dir", default=None)
    parser.add_argument("--managed", action="store_true", required=True)
    args = parser.parse_args()
    run = run_test(args)
    for line in run.summary_lines():
        print(line, file=sys.stderr)
    return run.exit_code
```

Use L-90 as the source of truth for shutdown requirements, not an invented private assertion. `DIRECTED_COVERAGE.md` line 689 requires `stop_reason == "shutdown"`, calls_log length >= 1, completed-iteration usage preserved, and a non-blocking shutdown signal while the in-flight `call_tool` drains.

### `tests/scenarios/framework/fqc_test_utils.py` (utility, event-driven)

**Analog:** `tests/scenarios/framework/fqc_test_utils.py`

**Config and process state pattern** (lines 129-180, 217-276):
```python
class FQCServer:
    DEFAULT_READY_TIMEOUT = 60
    DEFAULT_SHUTDOWN_TIMEOUT = 35

    def __init__(..., extra_config: dict | None = None) -> None:
        self.port = port or _find_free_port(effective_range)
        self.auth_secret = auth_secret or f"test-secret-{uuid4().hex[:12]}"
        self.base_url = f"http://127.0.0.1:{self.port}"
        self._process: subprocess.Popen | None = None

    def _generate_config(self) -> str:
        config = { "mcp": { "transport": "streamable-http", "port": self.port, "auth_secret": self.auth_secret } }
        if self.extra_config:
            config = _deep_merge(config, self.extra_config)
```

**Existing blocking stop pattern** (lines 484-517):
```python
def stop(self) -> None:
    """Gracefully stop the server. Falls back to SIGKILL after timeout."""
    if self._process.poll() is None:
        self._process.send_signal(signal.SIGTERM)
        try:
            self._process.wait(timeout=self.DEFAULT_SHUTDOWN_TIMEOUT)
        except subprocess.TimeoutExpired:
            self._process.kill()
            self._process.wait(timeout=5)
```

If L-90 closure is implemented, add a helper adjacent to `stop()` that sends `SIGTERM` without waiting or cleanup, e.g. `signal_graceful_shutdown()`. Keep cleanup in `stop()` / `__exit__` so existing tests are unaffected.

### `tests/scenarios/directed/DIRECTED_COVERAGE.md` (docs/coverage, batch)

**Analog:** `tests/scenarios/directed/DIRECTED_COVERAGE.md`

**ATL directed rows and pending shutdown pattern** (lines 683-699):
```markdown
| L-87 | ATL-DS-12: Public Mode 2 directed guardrail coverage asserts `max_iterations`, `max_tokens`, `max_cost`, `timeout` ... | test_call_model_agent_loop_budgets; tests/unit/llm-agent-loop.test.ts; tests/e2e/call-model-agent-loop.e2e.test.ts | 2026-05-06 | 2026-05-06 |
| L-90 | **PENDING — ATL-DS-12 step 6 cooperative shutdown directed coverage.** Drives a Mode 2 loop into `stop_reason: 'shutdown'` through the public MCP boundary ... | (future) test_call_model_agent_loop_shutdown | — | — |
```

**Test mapping pattern** (lines 788-795, 801-823, 1472-1484):
```markdown
### test_call_model_agent_loop_native / budgets / usage — L-86, L-87, L-88, L-89
- L-87: ATL-DS-12 directed budget behavior covers max-token, max-cost, max-iteration...
- L-90: PENDING — ATL-DS-12 step 6 cooperative shutdown directed coverage...

### test_call_model_return_messages
Covers: L-73, L-74, L-75, ATL-DS-01
```

After passing directed work, update the row, the narrative mapping, and the `Covers:` section consistently. Do not mark L-90 green unless a public MCP boundary test actually signals the subprocess.

### `.planning/phases/120-cross-phase-atl-validation-coverage-closure/120-VALIDATION.md` (docs/audit, batch)

**Analog:** `.planning/phases/119-discovery-diagnostics-help-resolver/119-VALIDATION.md`; current Phase 120 scaffold

**Validation strategy pattern** (`119-VALIDATION.md` lines 16-25, 38-47):
```markdown
| **Framework** | Vitest + directed Python scenario runner |
| **Quick run command** | `npm test -- tests/unit/llm-tool.test.ts` |
| **Full suite command** | `npm run lint && npm test -- ... && npm run build` |

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
```

**Final gate evidence pattern** (`119-VALIDATION.md` lines 90-106):
````markdown
## Phase 119 Final Gate Evidence

**Completed:** 2026-05-07T00:16:51Z

**Command:**
```bash
npm run lint && npm test -- ... && npm run build
```

**Result:** PASS
- `npm run lint` passed with zero warnings.
- Focused unit gate passed: 3 files, 117 tests.
````

**Current Phase 120 scaffold to preserve** (`120-VALIDATION.md` lines 16-24, 37-44, 58-64):
```markdown
| **Framework** | Vitest for unit/integration/E2E; Python scenario runners for directed and YAML integration tests |
| 120-02-01 | 02 | 1 | VAL-120 | T-120-02 | YAML scenarios use public MCP behavior and managed cleanup | yaml integration | `python3 tests/scenarios/integration/run_integration.py --managed <atl-yaml-tests>` | missing W0 | pending |
| Phase-local evidence audit for Phases 112-119 | TEST-04 | Evidence lives across planning docs, summaries, verification reports, and coverage ledgers | Inspect `.planning/phases/112-*` through `.planning/phases/119-*` ... |
```

Final validation should record exact commands, pass/fail/skip status, and the Phase 113 artifact asymmetry rather than fabricating a missing `113-VERIFICATION.md`.

## Shared Patterns

### Public Surface Assertions
**Source:** `tests/scenarios/directed/WRITING_SCENARIOS.md` lines 7-17  
**Apply to:** Directed and YAML scenario additions
```markdown
Scenario tests ask: if a user or LLM does X through FlashQuery's public surface, does the system as a whole do the right thing?
Tests assert on tool responses, vault filesystem state, and the tool's own return values. They do not query the database directly, read internal logs, or poke at private fields.
Each test is self-contained.
```

### Integration Runner Safety
**Source:** `tests/scenarios/integration/README.md` lines 14-18, 30-42, 302-318  
**Apply to:** YAML integration plans and validation commands
```markdown
The integration test runner deletes every row in every `fqc_*` table before and after each test.
Only ever point these tests at a throwaway Supabase or PostgreSQL instance created specifically for testing.
For `--managed` mode, `dist/index.js` must exist. `run_integration.py` checks this automatically and rebuilds if the source is newer.
The `deps:` key declares runtime capabilities the test requires. If any dep is unavailable, the test is recorded as `SKIP` rather than `FAIL`.
```

### E2E Mock Provider
**Source:** `tests/e2e/call-model-agent-loop.e2e.test.ts` lines 14-49, 52-85  
**Apply to:** Provider compatibility, failure, fallback, and tool-call E2E tests
```typescript
class ScriptedOpenAiProvider {
  readonly requests: Record<string, unknown>[] = [];
  private script: MockResponse[];
  async start(): Promise<void> {
    this.server = http.createServer(async (req, res) => {
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      this.requests.push(JSON.parse(rawBody) as Record<string, unknown>);
      const next = this.script.shift() ?? finalTextResponse('fallback final', 1, 1);
    });
  }
}
```

### Scenario Framework Managed Server
**Source:** `tests/scenarios/framework/fqc_test_utils.py` lines 129-180, 484-517  
**Apply to:** Directed tests and any L-90 framework helper
```python
with FQCServer(fqc_dir=args.fqc_dir, extra_config=_config(provider.url)) as server:
    client = FQCClient(base_url=server.base_url, auth_secret=server.auth_secret)
```

### Coverage Ledger Updates
**Source:** `tests/scenarios/integration/INTEGRATION_COVERAGE.md` lines 145-182; `tests/scenarios/directed/DIRECTED_COVERAGE.md` lines 683-699  
**Apply to:** Final ATL-INT / ATL-DS traceability
```markdown
| ID | Behavior | Covered By | Date Updated | Last Passing |
```

Keep provisional ATL IDs inside behavior text or notes, but use local final IDs (`IL-*`, `L-*`) as the matrix keys.

## No Analog Found

No files are completely without analogs. The only partial gap is cooperative shutdown directed coverage (`L-90`), because the existing framework has a blocking `FQCServer.stop()` but no non-blocking `signal_graceful_shutdown()` helper.

## Metadata

**Analog search scope:** `tests/e2e`, `tests/scenarios`, `.planning/phases/112-*` through `.planning/phases/120-*`, `.agents/skills`  
**Files scanned:** 150+ scenario/E2E/planning files via `rg --files`, targeted `nl -ba`, and skill docs  
**Pattern extraction date:** 2026-05-07
