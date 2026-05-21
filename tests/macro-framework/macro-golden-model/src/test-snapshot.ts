// Snapshot-capture meta-tests. Hand-curated macros that cover the major
// execution paths; each one runs through `captureSnapshot()` and prints a
// summary. The Phase-1 cases (simple loop, fail path, tool dispatch,
// pre-scan rejection) remain; v0.2.0 adds Tier 2 cases for `_self`,
// `isError`-coercion, and the `needs_user_input` rejection (it is not a
// macro builtin), plus a concurrency test that verifies per-invocation
// isolation under simultaneous captures.
//
// To run: `npx tsx src/test-snapshot.ts`

import { captureSnapshot } from "./snapshot.ts";
import { defaultToolRegistry } from "./mockfq.ts";
import type { SelfBinding } from "./evaluator.ts";
import { MACRO_ERROR_CODES } from "./envelope.ts";

const simpleLoop = `
# Simple for-loop with arithmetic — exercises binding, loop, ast notes.
total = 0
for i in 1..5 do
  total = add $total $i
done
exit { sum: $total }
`;

const failPath = `
# Fail path: trigger a guarded fail() — exercises permission, ast, task notes.
if ! pretend_search._exists() then
  fail "no broker available"
fi
echo "this never runs"
`;

const toolDispatch = `
# Tool dispatch: exercise multiple tool calls — coerce notes + side_effects.
fq.manage_directory({ action: "create", paths: ["Sandbox"] })
drafts = fq.search({ query: "tag:#draft" })
catalog = []
for d in $drafts do
  catalog = append $catalog { fq_id: $d.fq_id, path: $d.path }
done
saved = fq.write_document({
  mode: "create",
  path: "Sandbox/catalog.md",
  title: "Catalog",
  content: "test"
})
n = count $catalog
exit { count: $n, file: $saved }
`;

// ----- Tier 2 cases (v0.2.0) -----

// _self binding (REQ-103): a macro that accesses _self.* under source_ref
// loading. Snapshot envelope's `return` should include the bound fields.
const selfBindingMacro = `
# _self binding — read snapshot fields and exit with them.
exit {
  path: $_self.path,
  title: $_self.title,
  status: $_self.frontmatter.status,
  tags: $_self.tags
}
`;

const selfBindingSidecar: SelfBinding = {
  path: "Roadmap/Features/Demo.md",
  fq_id: "doc_demo",
  title: "Demo Document",
  tags: ["#demo", "#snapshot-test"],
  frontmatter: { status: "active", owner: "matt@example.com" },
};

// Coercion path isError (REQ-106 step 1 / REQ-107): brokered tool returns
// isError:true, macro frame fails-fast. Snapshot envelope's error block
// should be code "macro_aborted" with the formatted broker message;
// state_notes must include a coerce event with path "is_error".
const coerceIsErrorMacro = `
# Brokered tool that returns isError:true — fails fast.
result = coerce_demo.is_error()
echo "this should never run"
exit { unreachable: true }
`;

// needs_user_input is NOT a macro builtin. It was removed as a builtin
// during the macro testing framework's Tier 2 work: per MCP Broker
// REQ-060 / REQ-105, the fifth termination ("needs user input") is emitted
// by FQ-native tools or by the broker layer's TOFU drift — never by a
// macro-language builtin. Calling `needs_user_input` in macro source
// therefore halts the macro with a `tool_call_failed` envelope explaining
// that it is not a builtin. This macro exercises that rejection.
const needsInputMacro = `
needs_user_input \
  --question "Which workspace?" \
  --answer_shape "frontmatter.workspace" \
  --options ["personal", "team"]
echo "never runs"
`;

async function run(label: string, source: string, inputVars: Record<string, unknown> = {}, captureOpts: { selfBinding?: SelfBinding } = {}) {
  console.log(`\n========== ${label} ==========`);
  const envelope = await captureSnapshot(
    source,
    inputVars as Record<string, import("./types.ts").Value>,
    {},
    { registry: defaultToolRegistry },
    captureOpts,
  );
  console.log("ok:", envelope.error === undefined);
  if (envelope.error) console.log("error:", envelope.error);
  console.log("return:", JSON.stringify(envelope.return, null, 2));
  console.log("trace steps:", envelope.trace.length);
  console.log("trace kinds:", envelope.trace.map((s) => s.kind).join(", "));
  console.log("side_effects.vault_writes:", envelope.side_effects.vault_writes.length);
  console.log("side_effects.tool_calls:", envelope.side_effects.tool_calls.length);
  console.log("state_notes total:", envelope.state_notes.length);
  // Group state_notes by kind.
  const counts: Record<string, number> = {};
  for (const n of envelope.state_notes) counts[n.kind] = (counts[n.kind] ?? 0) + 1;
  console.log("state_notes by kind:", counts);
  console.log("permission_decisions:", envelope.permission_decisions.length);
  console.log("golden_version:", envelope.golden_version);
  console.log("golden_run_at:", envelope.golden_run_at);
  // Sample first few state_notes.
  console.log("first 5 state_notes:");
  for (const n of envelope.state_notes.slice(0, 5)) {
    console.log("  ", JSON.stringify(n));
  }
  // Sanity: every note must be JSON-serializable.
  try {
    JSON.stringify(envelope.state_notes);
    console.log("state_notes are JSON-serializable: yes");
  } catch (e) {
    console.log("state_notes JSON error:", (e as Error).message);
  }
  return envelope;
}

// Negative case: pre-scan rejection (REQ-028 ac3+ac4). Submits a macro
// that references an unknown server `nope.thing(...)` and verifies the
// pre-scan emits ONE envelope with the canonical shape, with NO
// statements having executed (no trace tool_calls, no side_effects).
const unknownServerMacro = `
# Should be rejected at pre-scan — \`nope\` is not a registered server.
echo "this never runs because pre-scan rejects the macro first"
nope.thing({ x: 1 })
`;

async function runUnknownServerCase() {
  console.log(`\n========== Pre-scan: unknown server (negative) ==========`);
  const envelope = await captureSnapshot(
    unknownServerMacro,
    {},
    {},
    { registry: defaultToolRegistry },
  );
  console.log("error code:", envelope.error?.code);
  console.log("error details:", JSON.stringify(envelope.error?.details, null, 2));
  const ok =
    envelope.error?.code === "unknown_server" &&
    Array.isArray((envelope.error?.details as Record<string, unknown> | undefined)?.unknown_servers) &&
    ((envelope.error?.details as Record<string, unknown> | undefined)?.unknown_servers as unknown[]).includes("nope") &&
    envelope.side_effects.tool_calls.length === 0 &&
    envelope.side_effects.vault_writes.length === 0 &&
    envelope.trace.filter((s) => s.kind === "tool_call").length === 0;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("Pre-scan negative test FAILED — see envelope above.");
    process.exitCode = 1;
  }
}

// Tier 2 invariant check: _self snapshot fields appear in return value
// and state_notes carry the binding events.
async function runSelfBindingCheck() {
  const env = await run("Tier 2: _self binding (source_ref)", selfBindingMacro, {}, { selfBinding: selfBindingSidecar });
  const ret = env.return as Record<string, unknown> | null;
  const ok =
    ret !== null &&
    ret.path === selfBindingSidecar.path &&
    ret.title === selfBindingSidecar.title &&
    ret.status === "active" &&
    env.golden_version === "0.3.0";
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("_self binding check FAILED — return did not contain the snapshot fields.");
    process.exitCode = 1;
  }
}

// Tier 2 invariant check: brokered isError fails-fast with the
// formatted message, and a coerce state_note with path "is_error"
// appears in the envelope.
async function runIsErrorCoercionCheck() {
  const env = await run("Tier 2: coercion isError fail-fast (REQ-106 step 1)", coerceIsErrorMacro);
  const hasIsErrorCoerce = env.state_notes.some(
    (n) => n.kind === "coerce" && (n as { path?: string }).path === "is_error",
  );
  // v0.3.0: brokered failures use `tool_call_failed` per REQ-054 (not
  // the v0.2.0 generic `macro_aborted`).
  const aborted = env.error?.code === "tool_call_failed";
  const ok = hasIsErrorCoerce && aborted && env.golden_version === "0.3.0";
  console.log("has is_error coerce note:", hasIsErrorCoerce);
  console.log("aborted:", aborted);
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("isError-coercion check FAILED.");
    process.exitCode = 1;
  }
}

// Tier 2 invariant check: `needs_user_input` is NOT a macro builtin, so
// calling it halts the macro with a `tool_call_failed` envelope. The fifth
// termination is a property of FQ-native tools / broker TOFU drift, not of
// a macro-language builtin (REQ-105 / MCP Broker REQ-060). The golden must
// reject the call rather than emit a `needs_user_input` outcome itself.
async function runNeedsUserInputCheck() {
  const env = await run("Tier 2: needs_user_input is not a macro builtin (REQ-105)", needsInputMacro);
  const code = env.error?.code;
  const message = env.error?.message ?? "";
  const ok =
    code === "tool_call_failed" &&
    /not a macro builtin/i.test(message) &&
    env.return === null &&
    env.golden_version === "0.3.0";
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("needs_user_input check FAILED.");
    process.exitCode = 1;
  }
}

// REQ-110: concurrent macro execution against shared brokered servers is
// safe. Two captureSnapshot() invocations running concurrently must NOT
// leak state — each gets its own ExecContext, its own state_notes, its
// own trace, its own side_effects. We verify by running two macros that
// produce DIFFERENT outputs simultaneously and asserting both envelopes
// match their respective inputs exactly.
async function runConcurrencyCheck() {
  console.log(`\n========== REQ-110: per-invocation isolation (concurrent captures) ==========`);
  const macroA = `
fq.manage_directory({ action: "create", paths: ["Sandbox/A"] })
fq.write_document({ mode: "create", path: "Sandbox/A/note.md", title: "A", content: "from-A" })
echo "A done"
exit { who: "A", marker: 111 }
`;
  const macroB = `
fq.manage_directory({ action: "create", paths: ["Sandbox/B"] })
fq.write_document({ mode: "create", path: "Sandbox/B/note.md", title: "B", content: "from-B" })
fq.write_document({ mode: "create", path: "Sandbox/B/note2.md", title: "B2", content: "from-B" })
echo "B done"
exit { who: "B", marker: 222 }
`;
  // Fire them simultaneously; await all together. Per-invocation
  // isolation is achieved if each envelope's return / side_effects /
  // trace contain only THAT macro's data.
  const [envA, envB] = await Promise.all([
    captureSnapshot(macroA, {}, {}, { registry: defaultToolRegistry }),
    captureSnapshot(macroB, {}, {}, { registry: defaultToolRegistry }),
  ]);
  const retA = envA.return as Record<string, unknown> | null;
  const retB = envB.return as Record<string, unknown> | null;
  const aClean = retA?.who === "A" && retA?.marker === 111 && envA.side_effects.tool_calls.length === 2;
  const bClean = retB?.who === "B" && retB?.marker === 222 && envB.side_effects.tool_calls.length === 3;
  const noCrossA = envA.side_effects.tool_calls.every((tc) => {
    const a = tc.arg as Record<string, unknown> | null;
    return JSON.stringify(a).includes("Sandbox/A") || JSON.stringify(a).includes("Sandbox");
  });
  const noCrossB = envB.side_effects.tool_calls.every((tc) => {
    const a = tc.arg as Record<string, unknown> | null;
    return JSON.stringify(a).includes("Sandbox/B") || JSON.stringify(a).includes("Sandbox");
  });
  // The critical assertion: A's tool_calls reference only A's paths, and
  // B's reference only B's. Cross-contamination would mean a shared
  // ExecContext leaked between invocations.
  const aOnlyMatchesA = envA.side_effects.tool_calls.every((tc) => {
    const s = JSON.stringify(tc.arg);
    return !s.includes("Sandbox/B");
  });
  const bOnlyMatchesB = envB.side_effects.tool_calls.every((tc) => {
    const s = JSON.stringify(tc.arg);
    return !s.includes("Sandbox/A");
  });
  console.log("A return:", retA, " side_effects:", envA.side_effects.tool_calls.length, " trace:", envA.trace.length);
  console.log("B return:", retB, " side_effects:", envB.side_effects.tool_calls.length, " trace:", envB.trace.length);
  console.log("A clean:", aClean, " B clean:", bClean, " A-only-A:", aOnlyMatchesA, " B-only-B:", bOnlyMatchesB);
  const ok = aClean && bClean && aOnlyMatchesA && bOnlyMatchesB && noCrossA && noCrossB;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("Concurrent-capture isolation FAILED — state leaked between invocations.");
    process.exitCode = 1;
  }
}

// ----- v0.3.0 verification cases (compliance audit gaps E.1 .. E.9) -----

// Gap 1 — REQ-014 ac1+ac4: `for i in 0..5` iterates 5 times (exclusive end)
// AND matches `range 5` iteration sequence exactly.
async function runRangeExclusiveCheck() {
  console.log(`\n========== Gap 1: REQ-014 ac1+ac4 range operator exclusive end ==========`);
  // Note: `for i in <pipeline> do` isn't valid grammar — the iterable
  // position requires a primary or range expression. The idiomatic
  // pattern is to bind the builtin's result first, then iterate the
  // variable (see example 19). REQ-014 ac4 equivalence is verified by
  // comparing the bound-list contents directly.
  const macro = `
collected_dotdot = []
for i in 0..5 do
  collected_dotdot = append $collected_dotdot $i
done

range_5 = range 5
collected_range = []
for i in $range_5 do
  collected_range = append $collected_range $i
done

n_dotdot = count $collected_dotdot
n_range = count $collected_range

exit {
  dotdot: $collected_dotdot,
  dotdot_count: $n_dotdot,
  range_builtin: $collected_range,
  range_builtin_count: $n_range
}
`;
  const env = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry });
  const ret = env.return as Record<string, unknown> | null;
  const dotdot = ret?.dotdot as unknown[] | undefined;
  const rangeArr = ret?.range_builtin as unknown[] | undefined;
  const dotdotOk = Array.isArray(dotdot) && dotdot.length === 5 && JSON.stringify(dotdot) === JSON.stringify([0, 1, 2, 3, 4]);
  const rangeOk = Array.isArray(rangeArr) && JSON.stringify(rangeArr) === JSON.stringify(dotdot);
  console.log("0..5 result:", JSON.stringify(dotdot), "expected [0,1,2,3,4]");
  console.log("range 5 result:", JSON.stringify(rangeArr));
  console.log("dotdot exclusive end OK:", dotdotOk, " ac4 equivalence OK:", rangeOk);
  const ok = dotdotOk && rangeOk && env.golden_version === "0.3.0";
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-014 ac1+ac4 check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 2 — REQ-005 ac1: `fqm name=foo` fence is recognized;
// `flashquery-macro name=foo` is NOT.
async function runFqmFenceCheck() {
  console.log(`\n========== Gap 2: REQ-005 ac1 fence info-string fqm ==========`);
  const docFqm = "Some text\n\n```fqm name=hello\nexit { greeting: \"hi\" }\n```\n";
  const envFqm = await captureSnapshot(docFqm, {}, {}, { registry: defaultToolRegistry }, { selector: "hello" });
  const fqmOk = envFqm.error === undefined && (envFqm.return as Record<string, unknown> | null)?.greeting === "hi";
  console.log("fqm fence recognized:", fqmOk);

  // Legacy `flashquery-macro` should NOT be recognized as a macro fence
  // — selectMacroSource falls through to bare-mode (whole doc as source),
  // which will then fail at parse OR runtime since the markdown narrative
  // isn't valid macro syntax. Either way, the macro doesn't successfully
  // execute the embedded fenced content.
  const docLegacy = "```flashquery-macro name=hello\nexit { greeting: \"hi\" }\n```\n";
  const envLegacy = await captureSnapshot(docLegacy, {}, {}, { registry: defaultToolRegistry });
  // The legacy fence should NOT produce the {greeting: "hi"} return
  // value that the fqm-recognized version did. Failure mode could be
  // parse_error or tool_call_failed; either confirms the fence wasn't
  // recognized as a macro block.
  const legacyDidNotExecuteEmbedded =
    envLegacy.error !== undefined ||
    (envLegacy.return as Record<string, unknown> | null)?.greeting !== "hi";
  console.log("flashquery-macro fence rejected (no embedded execution):", legacyDidNotExecuteEmbedded);
  const ok = fqmOk && legacyDidNotExecuteEmbedded;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-005 ac1 check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 3 — REQ-006 ac8: when a doc has unnamed blocks, `available_names`
// includes the literal "unnamed", and `unnamed_block_count: N` is
// present as a sibling when N > 1.
async function runUnnamedBlockEnvelopeCheck() {
  console.log(`\n========== Gap 3: REQ-006 ac8 available_names with unnamed blocks ==========`);
  const doc = `\`\`\`fqm name=named-one
exit { who: "named" }
\`\`\`

\`\`\`fqm
exit { who: "unnamed-1" }
\`\`\`

\`\`\`fqm
exit { who: "unnamed-2" }
\`\`\`
`;
  // Select a non-existent name to force the block_not_found envelope.
  const env = await captureSnapshot(doc, {}, {}, { registry: defaultToolRegistry }, { selector: "nope" });
  const details = env.error?.details as Record<string, unknown> | undefined;
  const availableNames = details?.available_names as unknown[] | undefined;
  const includesUnnamed = Array.isArray(availableNames) && availableNames.includes("unnamed");
  const unnamedCount = details?.unnamed_block_count;
  console.log("available_names:", JSON.stringify(availableNames));
  console.log("unnamed_block_count:", unnamedCount);
  const ok =
    env.error?.code === "parse_error" &&
    includesUnnamed &&
    unnamedCount === 2;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-006 ac8 check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 4 — REQ-012 ac4: `"a" < "b"` raises runtime error; `1 < 2` returns true.
async function runComparisonNumericCheck() {
  console.log(`\n========== Gap 4: REQ-012 ac4 comparison numeric-only ==========`);
  const macroBad = `
result = "a" < "b"
exit { result: $result }
`;
  const envBad = await captureSnapshot(macroBad, {}, {}, { registry: defaultToolRegistry });
  // GG-005: unexpected runtime errors emit `tool_call_failed` per REQ-054.
  const badOk = envBad.error?.code === "tool_call_failed";
  console.log("'a' < 'b' raised tool_call_failed:", badOk);

  const macroGood = `
result = 1 < 2
exit { result: $result }
`;
  const envGood = await captureSnapshot(macroGood, {}, {}, { registry: defaultToolRegistry });
  const goodOk = envGood.error === undefined && (envGood.return as Record<string, unknown> | null)?.result === true;
  console.log("1 < 2 returned true:", goodOk);
  const ok = badOk && goodOk;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-012 ac4 check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 5 — REQ-047 ac2/ac3: trace summary mode omits args/result;
// trace none mode omits the trace from the embedded result envelope.
async function runTraceModeCheck() {
  console.log(`\n========== Gap 5: REQ-047 trace verbosity modes ==========`);
  const macro = `
result = fq.search({ query: "tag:#draft" })
n = count $result
exit { count: $n }
`;
  const envFull = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry }, { traceMode: "full" });
  const envSummary = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry }, { traceMode: "summary" });
  const envNone = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry }, { traceMode: "none" });

  const fullToolStep = envFull.trace.find((s) => s.kind === "tool_call");
  const summaryToolStep = envSummary.trace.find((s) => s.kind === "tool_call");
  const fullHasArgs = fullToolStep && "args" in fullToolStep;
  const summaryHasNoArgs = summaryToolStep !== undefined && !("args" in summaryToolStep) && !("result" in summaryToolStep);
  const noneEmbedded = (envNone.result_envelope as Record<string, unknown>).trace === undefined;
  console.log("full mode tool_call step has args:", fullHasArgs);
  console.log("summary mode tool_call step omits args/result:", summaryHasNoArgs);
  console.log("none mode result_envelope.trace absent:", noneEmbedded);
  const ok = !!fullHasArgs && summaryHasNoArgs && noneEmbedded;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-047 trace mode check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 6 — REQ-048 ac3: progress silent mode produces no progress events.
async function runProgressSilentCheck() {
  console.log(`\n========== Gap 6: REQ-048 ac3 progress silent ==========`);
  const macro = `
status "starting"
status "midpoint" --progress 1 --total 2
status "ending" --progress 2 --total 2
exit { finished: true }
`;
  const envFull = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry }, { progressMode: "full" });
  const envSilent = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry }, { progressMode: "silent" });
  const fullProgressCount = envFull.trace.filter((s) => s.kind === "progress").length;
  const silentProgressCount = envSilent.trace.filter((s) => s.kind === "progress").length;
  console.log("full mode progress events:", fullProgressCount);
  console.log("silent mode progress events:", silentProgressCount);
  const ok = fullProgressCount >= 3 && silentProgressCount === 0;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-048 ac3 check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 7 — REQ-052/053/054: success envelope has parsed_ok+task_id+result;
// error envelope has parsed_ok+error+message; parse-error has parsed_ok:false;
// new error codes are present.
async function runEnvelopeShapeCheck() {
  console.log(`\n========== Gap 7: REQ-052/053/054 envelope shapes ==========`);
  // Success.
  const envSuccess = await captureSnapshot(`exit { ok: true }`, {}, {}, { registry: defaultToolRegistry });
  const succEnv = envSuccess.result_envelope as Record<string, unknown>;
  const succOk =
    succEnv.parsed_ok === true &&
    typeof succEnv.task_id === "string" &&
    "result" in succEnv &&
    !("error" in succEnv);
  console.log("success envelope:", { parsed_ok: succEnv.parsed_ok, has_task_id: typeof succEnv.task_id === "string", has_result: "result" in succEnv });

  // Runtime error.
  const envError = await captureSnapshot(`fail "intentional"`, {}, {}, { registry: defaultToolRegistry });
  const errEnv = envError.result_envelope as Record<string, unknown>;
  const errOk =
    errEnv.parsed_ok === true &&
    typeof errEnv.task_id === "string" &&
    typeof errEnv.error === "string" &&
    typeof errEnv.message === "string";
  console.log("runtime error envelope:", { parsed_ok: errEnv.parsed_ok, error: errEnv.error });

  // Parse error.
  const envParseErr = await captureSnapshot(`for x in $y do\n  echo "missing-done"\n`, {}, {}, { registry: defaultToolRegistry });
  const parseEnv = envParseErr.result_envelope as Record<string, unknown>;
  const parseOk =
    parseEnv.parsed_ok === false &&
    parseEnv.error === "parse_error";
  console.log("parse error envelope:", { parsed_ok: parseEnv.parsed_ok, error: parseEnv.error });

  // New error codes.
  const codesOk =
    "template_masquerade_tools_not_callable_from_macro" in MACRO_ERROR_CODES &&
    "timeout" in MACRO_ERROR_CODES &&
    "tool_call_failed" in MACRO_ERROR_CODES;
  console.log("REQ-054 new error codes present:", codesOk);

  // Dry-run envelope inventory.
  const envDry = await captureSnapshot(
    `
n = input_var "n" --default 1
fq.search({ query: "tag:#draft" })
exit { n: $n }
`,
    { n: 7 } as Record<string, import("./types.ts").Value>,
    {},
    { registry: defaultToolRegistry },
    { dryRun: true },
  );
  const dryEnv = envDry.result_envelope as Record<string, unknown>;
  const dryOk =
    dryEnv.parsed_ok === true &&
    dryEnv.result === null &&
    "input_var_contract" in dryEnv &&
    "tool_references" in dryEnv &&
    "server_references" in dryEnv;
  console.log("dry-run envelope:", { parsed_ok: dryEnv.parsed_ok, has_inventory: "input_var_contract" in dryEnv });

  const ok = succOk && errOk && parseOk && codesOk && dryOk;
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-052/053/054 envelope-shape check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 8 — REQ-082: `arg_summary` present in every SearchResult.
async function runArgSummaryCheck() {
  console.log(`\n========== Gap 8: REQ-082 SearchResult.arg_summary ==========`);
  const macro = `
hits = fq.search_tools({ query: "write document", limit: 3 })
summaries = []
for h in $hits do
  summaries = append $summaries $h.arg_summary
done
n = count $hits
exit { summaries: $summaries, count: $n }
`;
  const env = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry });
  const ret = env.return as Record<string, unknown> | null;
  const summaries = ret?.summaries as unknown[] | undefined;
  const ok =
    env.error === undefined &&
    Array.isArray(summaries) &&
    summaries.length > 0 &&
    summaries.every((s) => typeof s === "string" && s.length > 0);
  console.log("summaries:", JSON.stringify(summaries));
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-082 arg_summary check FAILED.");
    process.exitCode = 1;
  }
}

// Gap 9 — REQ-093: help-sentinel returns CallToolResult-shaped envelope.
async function runHelpSentinelShapeCheck() {
  console.log(`\n========== Gap 9: REQ-093 help-sentinel CallToolResult shape ==========`);
  const macro = `
help_response = fq.write_document({ help: true })
body = ""
for c in $help_response.content do
  if $body == "" then
    body = $c.text
  fi
done
content_size = count $help_response.content
exit { has_content: $content_size, body_preview: $body }
`;
  const env = await captureSnapshot(macro, {}, {}, { registry: defaultToolRegistry });
  const ret = env.return as Record<string, unknown> | null;
  const ok =
    env.error === undefined &&
    typeof ret?.has_content === "number" &&
    (ret.has_content as number) > 0 &&
    typeof ret?.body_preview === "string" &&
    (ret.body_preview as string).length > 0;
  console.log("return:", JSON.stringify(ret));
  console.log("verdict:", ok ? "PASS" : "FAIL");
  if (!ok) {
    console.error("REQ-093 help-sentinel shape check FAILED.");
    process.exitCode = 1;
  }
}

async function main() {
  await run("Simple loop (1..5 sum)", simpleLoop);
  await run("Fail path (missing broker)", failPath);
  await run("Tool dispatch (multi-tool)", toolDispatch);
  await runUnknownServerCase();
  // Tier 2 cases (v0.2.0).
  await runSelfBindingCheck();
  await runIsErrorCoercionCheck();
  await runNeedsUserInputCheck();
  // Concurrency invariant (REQ-110).
  await runConcurrencyCheck();
  // v0.3.0 compliance-audit verification cases.
  await runRangeExclusiveCheck();
  await runFqmFenceCheck();
  await runUnnamedBlockEnvelopeCheck();
  await runComparisonNumericCheck();
  await runTraceModeCheck();
  await runProgressSilentCheck();
  await runEnvelopeShapeCheck();
  await runArgSummaryCheck();
  await runHelpSentinelShapeCheck();
  console.log("\n========== done ==========");
}

main().catch((e) => {
  console.error("TEST FAILED:", e);
  process.exit(1);
});
