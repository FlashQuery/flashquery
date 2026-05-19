// Capture-pilots: one-shot golden snapshot capture for the 12 Phase-3
// pilot tests.
//
// For each pilot, the script:
//   1. Defines a macro source + input_vars + a tool surface (either the
//      default mock registry, or a hand-rolled `ServerEntry` set that
//      mirrors what the production FakeBroker will dispatch at runtime).
//   2. Calls `captureSnapshot()` (golden, v0.3.0) — that's the single
//      authoritative source per §5.6 of testgen embeddings.
//   3. Writes a JSON dump to stdout under the pilot's id, ready to be
//      hand-merged into the corresponding YAML's `golden_snapshot:`
//      block + `expect:` block.
//
// Per the brief: "use golden-bridge/snapshot.ts's captureForTestgen() to
// run the macro through the golden and get the structured outputs. Embed
// those into the YAML's golden_snapshot: block AND derive the expect:
// block from them." This script is the engine for that step.
//
// Run: `cd flashquery && npx tsx tests/macro-framework/golden-bridge/capture-pilots.ts`
//
// Tier 2 caveat: a few pilots exercise broker features (continue/break,
// _self, coercion paths) that the GOLDEN supports but the production
// engine does NOT support yet — those pilots fall back to production-
// compatible alternatives (see PILOT_NOTES below).

import { captureSnapshot } from '../macro-golden-model/src/snapshot.ts';
import { defaultToolRegistry } from '../macro-golden-model/src/mockfq.ts';
import type { CallToolResult } from '../macro-golden-model/src/broker.ts';
import type { ServerEntry, ToolRegistry, Value } from '../macro-golden-model/src/types.ts';

// ───── Inline brokered helpers for pilots' tool surfaces ─────

function readOnly(returns: Value): ServerEntry['tools'][string] {
  return () => returns;
}

function scriptedResponses(responses: CallToolResult[]): ServerEntry['tools'][string] {
  let i = 0;
  return () => {
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r as unknown as Value;
  };
}

function structuredEnvelope(value: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value as Value,
  };
}

function jsonTextEnvelope(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function rawTextEnvelope(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

// ───── Pilot definitions ─────

interface PilotDef {
  id: string;
  description: string;
  macro: string;
  inputVars?: Record<string, Value>;
  registry?: ToolRegistry;
}

const PILOTS: PilotDef[] = [
  // 1. MTF-G grammar — literals + interpolation. No tools.
  {
    id: '01-literal-and-interpolation',
    description: 'string/number/list/object literals + interpolation',
    macro: `
greeting = "hello"
target = "world"
msg = "$greeting, $target!"
items = [1, 2, 3]
obj = { msg: $msg, count: 3, items: $items }
exit $obj
`,
  },

  // 2. MTF-S walk-up scope (counter). No tools. Variable name `count`
  // shadows the count() builtin, so we use `n_iters` instead.
  {
    id: '02-walk-up-scope-counter',
    description: 'walk-up scope: counter pattern updates outer var',
    macro: `
total = 0
n_iters = 0
for i in 1..6 do
  total = add $total $i
  n_iters = add $n_iters 1
done
exit { total: $total, n_iters: $n_iters }
`,
  },

  // 3. MTF-C control flow: for-loop with mid-iteration fail.
  //    Production engine doesn't have continue/break (Tier 2), so we
  //    substitute the closest production-supported test: a for-loop with
  //    an if-fail abort to exercise for + if + fail interaction.
  {
    id: '03-for-with-if-fail',
    description: 'for-loop + if + fail mid-iteration (production-compatible substitute for continue/break)',
    macro: `
for n in 1..10 do
  if $n == 5 then
    fail "halt at 5"
  fi
done
echo "should not reach here"
`,
  },

  // 4. MTF-C while loop with fail. No tools.
  {
    id: '04-while-with-fail',
    description: 'while loop running until fail',
    macro: `
counter = 0
while $counter < 100 do
  counter = add $counter 1
  if $counter == 7 then
    fail "halt while at 7"
  fi
done
echo "unreachable"
`,
  },

  // 5. MTF-D dispatch chain across multiple brokered servers. Note
  //    `in` is a reserved keyword (used in `for ... in`); we use
  //    `payload` as the named-arg name.
  {
    id: '05-multi-server-dispatch-chain',
    description: 'chained tool dispatch across three brokered servers',
    macro: `
a = svc_a.step({ x: 10 })
b = svc_b.transform({ payload: $a })
c = svc_c.finish({ data: $b })
exit { trail: [$a, $b, $c] }
`,
    registry: {
      ...defaultToolRegistry,
      svc_a: {
        label: 'svc_a fake',
        tools: { step: readOnly({ stage: 'a', value: 10 } as Value) },
      },
      svc_b: {
        label: 'svc_b fake',
        tools: { transform: readOnly({ stage: 'b', value: 20 } as Value) },
      },
      svc_c: {
        label: 'svc_c fake',
        tools: { finish: readOnly({ stage: 'c', value: 30 } as Value) },
      },
    },
  },

  // 6. MTF-D brokered with ScriptedTool exercising three coercion paths.
  {
    id: '06-brokered-coercion-paths',
    description: 'one brokered tool whose 3 calls exercise coercion paths 2/3/4',
    macro: `
v1 = coerce_srv.shape({})
v2 = coerce_srv.shape({})
v3 = coerce_srv.shape({})
exit { struct: $v1, json: $v2, raw: $v3 }
`,
    registry: {
      ...defaultToolRegistry,
      coerce_srv: {
        label: 'scripted coercion server',
        tools: {
          shape: scriptedResponses([
            structuredEnvelope({ source: 'structured', n: 1 }),
            jsonTextEnvelope({ source: 'json', n: 2 }),
            rawTextEnvelope('plain raw text response 3'),
          ]),
        },
      },
    },
  },

  // 7. MTF-L dry-run inventory. We capture via the regular evaluator
  //    (golden's dry-run path), then the production runner uses runDryRun.
  //    For the snapshot we capture WITHOUT dryRun — but the test ASSERTS
  //    on the production engine's dry-run envelope. The golden_snapshot
  //    here is debug context; the live comparison is against the
  //    production engine's dry-run output, which we compute manually
  //    (deterministic from the macro source).
  {
    id: '07-dry-run-inventory',
    description: 'dry-run inventory: input_var contract, tool/server references',
    macro: `
topic = input_var "topic"
n_lim = input_var "n_lim" --default 10
docs = inventory_srv.list({ q: $topic, n: $n_lim })
for d in $docs do
  out = inventory_srv.process({ id: $d, topic: $topic })
done
exit { ok: true }
`,
    inputVars: { topic: 'demo', n_lim: 3 },
    registry: {
      ...defaultToolRegistry,
      inventory_srv: {
        label: 'inventory fake',
        tools: {
          list: readOnly(['a', 'b', 'c'] as Value),
          process: readOnly({ done: true } as Value),
        },
      },
    },
  },

  // 8. MTF-L second: trace_mode = summary.
  //    Golden captures with default (full) trace; the production runner
  //    drives in summary mode and the comparator verifies trace_has_no_args.
  //    The framework's tool-registry helper registers exactly one tool
  //    per archetype config, so this macro reuses a single tool name
  //    ("shape") across both calls (ScriptedTool indexes by callIndex).
  {
    id: '08-trace-summary-mode',
    description: 'production runs with trace_mode=summary; args/result absent from trace steps',
    macro: `
a = trace_srv.shape({ q: "hello" })
b = trace_srv.shape({ data: $a })
exit { final: $b }
`,
    registry: {
      ...defaultToolRegistry,
      trace_srv: {
        label: 'trace mode fake',
        tools: {
          shape: scriptedResponses([
            structuredEnvelope({ result: 'fetched' }),
            structuredEnvelope({ result: 'transformed' }),
          ]),
        },
      },
    },
  },

  // 9. MTF-E prescan unknown server. Pre-scan rejects with `unknown_server`.
  //    Golden capture: the prescan emits the same envelope shape.
  {
    id: '09-prescan-unknown-server',
    description: 'pre-scan rejects unknown server reference',
    macro: `
x = no_such_server.something({ q: "test" })
exit $x
`,
    registry: defaultToolRegistry,
  },

  // 10. INTENTIONAL MISMATCH. The macro produces sum=10; the test's
  //     embedded expect.return_result will say sum=999.
  {
    id: '_intentional-mismatch-fake-expected-result',
    description: 'macro runs cleanly; expect.return_result deliberately wrong (failure-triage witness)',
    macro: `
total = 0
for i in 1..5 do
  total = add $total $i
done
exit { sum: $total }
`,
  },

  // 11. MTF-I + expect_state_notes. _self is Tier 2 and not yet in
  //     production; we substitute by passing path/title via input_vars
  //     and asserting state_notes on the binding events.
  {
    id: '11-self-via-input-vars-with-state-notes',
    description: '_self workaround via input_vars + expect_state_notes integrity check',
    macro: `
path = input_var "self_path"
title = input_var "self_title"
fm_type = input_var "self_type"
self_view = { path: $path, title: $title, type: $fm_type }
exit { self: $self_view }
`,
    inputVars: {
      self_path: '/Macros/research-batch.md',
      self_title: 'Research Batch',
      self_type: 'macro',
    },
  },

  // 12. Elaborate beyond realistic: 3-deep nested for-loops with
  //     interleaved conditional fan-out. Produces 4*4*4 = 64 triples and
  //     a sum-of-indices for the "deliberately exhaustive" feel.
  {
    id: '12-elaborate-deep-nesting',
    description: '3-deep nested for-loops with running sum across 64 iterations',
    macro: `
acc = []
total_indices = 0
for i in 1..5 do
  for j in 1..5 do
    for k in 1..5 do
      acc = append $acc [$i, $j, $k]
      total_indices = add $total_indices $i $j $k
    done
  done
done
n_triples = count $acc
exit { n_triples: $n_triples, sum_indices: $total_indices }
`,
  },
];

// Note: pilot 12 uses array indexing `$acc[26]` — the language may not
// support indexing in expression position. If the parser rejects it, we
// adapt to compute via a builtin or include count only. Capture-time
// errors are emitted to stderr so we can adapt.

async function main(): Promise<void> {
  const out: Record<string, unknown> = {};
  for (const p of PILOTS) {
    try {
      const env = await captureSnapshot(
        p.macro,
        (p.inputVars ?? {}) as Record<string, Value>,
        {},
        { registry: p.registry ?? defaultToolRegistry },
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
  // Emit a single JSON document — easiest to feed back into per-YAML edits.
  process.stdout.write(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
