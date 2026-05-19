// Tier 2 pilot snapshot capture (golden v0.3.0).
//
// Runs each Tier 2 pilot through the golden model to capture the
// authoritative state_notes / return / error envelope. Output is a JSON
// blob keyed by pilot id; the authoring step embeds those values into
// each YAML's `golden_snapshot:` + `expect:` blocks.
//
// Run: `npx tsx tests/macro-framework/golden-bridge/capture-tier2.ts`

import { captureSnapshot } from '../macro-golden-model/src/snapshot.ts';
import { defaultToolRegistry } from '../macro-golden-model/src/mockfq.ts';
import type { CallToolResult } from '../macro-golden-model/src/broker.ts';
import type { ServerEntry, ToolRegistry, Value } from '../macro-golden-model/src/types.ts';
import type { SelfBinding } from '../macro-golden-model/src/evaluator.ts';

function readOnly(returns: Value): ServerEntry['tools'][string] {
  return () => returns;
}

function isErrorEnvelope(message: string): CallToolResult {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

// (needsInputEnvelope helper removed 2026-05-19 along with the retired
// brokered-tool-returns-event capture path; see Pilot 29.)

function helpEnvelope(body: string): CallToolResult {
  return { content: [{ type: 'text', text: body }] };
}

interface PilotDef {
  id: string;
  description: string;
  macro: string;
  inputVars?: Record<string, Value>;
  registry?: ToolRegistry;
  selfBinding?: SelfBinding;
}

const PILOTS: PilotDef[] = [
  // 26 — for-loop with `continue` skipping odd numbers; collects evens.
  {
    id: '26-continue-skip-odds',
    description: 'for-loop with continue skipping odd values; sum of evens 2+4+6+8+10',
    macro: `
total = 0
for i in 1..11 do
  rem = mod $i 2
  if $rem == 1 then
    continue
  fi
  total = add $total $i
done
exit { sum_evens: $total }
`,
  },

  // 27 — while-loop with `break` on threshold.
  {
    id: '27-break-on-threshold',
    description: 'while-loop with break on threshold; stops counter at 7',
    macro: `
counter = 0
while $counter < 100 do
  counter = add $counter 1
  if $counter == 7 then
    break
  fi
done
exit { final: $counter }
`,
  },

  // 26b — break/continue OUTSIDE any loop. Parse-time rejection per
  // REQ-104 ac (loop_control_outside_loop).
  {
    id: '26b-continue-outside-loop',
    description: 'bare `continue` at top level → loop_control_outside_loop',
    macro: `
x = 1
continue
exit { reached: false }
`,
  },

  // 28 — _self.path / _self.title / _self.frontmatter.* / _self.fq_id access.
  {
    id: '28-self-binding-real',
    description: '_self binding: path/title/frontmatter/tags/fq_id accessible via source_ref',
    macro: `
p = $_self.path
t = $_self.title
ft = $_self.frontmatter.type
ident = $_self.fq_id
exit { path: $p, title: $t, type: $ft, fq_id: $ident }
`,
    selfBinding: {
      path: '/Macros/research-batch.md',
      frontmatter: { type: 'macro', priority: 1 },
      title: 'Research Batch',
      tags: ['research', 'batch'],
      fq_id: 'fq:doc:research-batch:abc123',
    },
  },

  // 29 — RETIRED 2026-05-19. The previous shape used a brokered tool
  // returning `event: needs_user_input` in its CallToolResult, which
  // contradicts MCP Broker REQ-060 ("Brokered tools CANNOT trigger
  // needs_user_input in v1"). The spec-valid route is TOFU drift
  // emitted by the broker layer during dispatch — exercised by Pilot 29
  // (`cases/errors/29-needs-user-input-via-broker.yml`) via the
  // `NeedsInputViaTofuDrift` archetype. That archetype throws a
  // SchemaDriftNeedsUserInputError at dispatch time and does not need
  // a golden-side snapshot here — the structured comparator drives
  // pass/fail off `expect.outcome: needs_user_input`. Capture entry
  // omitted intentionally.

  // 30 — brokered tool returns isError:true; engine fail-fasts.
  {
    id: '30-brokered-iserror-failfast',
    description: 'brokered tool returns isError:true → fail-fast surfaces as tool_call_failed',
    macro: `
x = bad_srv.boom({})
exit $x
`,
    registry: {
      ...defaultToolRegistry,
      bad_srv: {
        label: 'failing scripted server',
        tools: {
          boom: () => isErrorEnvelope('upstream said no') as unknown as Value,
        },
      },
    },
  },

  // 31 — fq.search_tools native invocation. The golden's defaultToolRegistry
  // includes a mocked fq surface; we depend on the production runner to
  // dispatch the native handler. The golden's snapshot here is for
  // expectation guidance; production may diverge on result shape.
  {
    id: '31-search-tools',
    description: 'fq.search_tools invocation with a query; verifies result shape (REQ-082..087)',
    macro: `
hits = fq.search_tools({ query: "document", limit: 3 })
n = count $hits
exit { count: $n }
`,
  },

  // 32 — REPURPOSED 2026-05-19. The previous shape tried to verify
  // Broker REQ-093/098 (`help: true` sentinel) by calling a brokered
  // tool with `{ help: true }` from a macro. REQ-098 scopes that
  // behavior to "a delegated or host model" — the macro frame is not in
  // scope. Verification of REQ-093/098 belongs at the broker layer.
  // Pilot 32 now asserts Macro Lang §3.3 boolean-literal rejection
  // (`MTF-G-009`), which doesn't need a Tier-2 capture entry —
  // production rejects at evaluation time and the YAML expects the
  // canonical rejection envelope. Capture entry omitted intentionally.
];

// `helpEnvelope` retained for any future broker-layer tests that may
// want to compose a help-body CallToolResult; not used in the Tier 2
// pilots after the 2026-05-19 corrections.
void helpEnvelope;

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const p of PILOTS) {
    try {
      const env = await captureSnapshot(
        p.macro,
        (p.inputVars ?? {}) as Record<string, Value>,
        {},
        { registry: p.registry ?? defaultToolRegistry },
        p.selfBinding ? { selfBinding: p.selfBinding } : {},
      );
      out[p.id] = {
        description: p.description,
        return: env.return,
        result_envelope: env.result_envelope,
        side_effects: env.side_effects,
        warnings: env.warnings,
        state_notes_count: env.state_notes.length,
        state_notes: env.state_notes,
        trace_kinds: env.trace.map((s) => s.kind),
        golden_version: env.golden_version,
        error: env.error,
      };
    } catch (e) {
      out[p.id] = {
        description: p.description,
        capture_error: e instanceof Error ? e.message : String(e),
      };
    }
  }
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
