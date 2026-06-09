---
name: flashquery-macro-author
description: Use when the user wants a FlashQuery macro authored from a natural-language description, or an existing macro checked against stated intent — e.g. "write me a macro that ...", "author/generate a macro", "create a rundoc macro", "I need a macro that ...", "verify/review this macro", "does this macro do what I asked?". Also invoked by flashquery-macro-testgen to synthesize macro source. Produces macro source only — not test YAML or execution.
---

# FlashQuery Macro Author (`flashquery-macro-author`)

Translates between English descriptions of intent and FlashQuery macro source. Built to be reusable in two contexts:

1. **Production / end-user authoring.** A user wants a macro that does X — invoke the generate workflow, get a runnable macro back.
2. **Test pilot authoring.** A coverage cell needs exercise — `flashquery-macro-testgen` invokes this skill for the macro source, then wraps it with a tool surface, expectations, and golden snapshot.

The two workflows (generate, verify) share one specification reference (`macro-spec.md` in this folder) so the same dictionary maps both directions.

## When to use

- The user describes a behavior they want a macro to perform, and asks for the macro source.
- The user has a macro and wants to check it against their stated intent.
- The user wants to refine a macro and asks whether the refinement still matches the intent.
- A sister skill (e.g., `flashquery-macro-testgen`) needs macro source synthesized from a coverage-cell description.

## What this skill does NOT do

- It does **not** EXECUTE the macro (no side effects on any document). Real execution is a separate concern (host MCP `fq.call_macro` in production; `flashquery-macro-run` for the test suite). The optional engine **dry-run** stage (below) calls `call_macro({ dry_run: true })`, which validates without executing — that is validation, not a run.
- It does **not** capture golden snapshots or produce test YAMLs. That's `flashquery-macro-testgen`.
- It does **not** modify the macro language specification. If the description requires a construct that doesn't exist, the skill refuses with a clear "the macro language does not support X" message rather than inventing syntax.

## Two workflows

### Workflow 1 — generate

**Input contract:**

- `description` (required, string) — natural-language statement of what the macro should do.
- `verify` (optional, bool, default **true**) — run the verify workflow on the produced macro.
- `auto_correct` (optional, bool, default **true**) — when `verify: true`, controls whether verify intervenes. When `true`, verify applies mechanical fixes in-place and the auto-correction loop fires on algorithmic misses. When `false` (**calibration mode**), verify runs but does NOT intervene: the macro is returned AS GENERATED, mechanical fixes are reported as `would_have_been_fixed` (not applied), and no retries fire. Calibration mode is for skill development — see "Three flow modes" below.
- `max_retries` (optional, int, default **2**) — maximum number of regeneration attempts after a verify miss. Ignored when `auto_correct: false`.
- `context` (optional, object) — additional context the caller can supply: `tool_surface` (server.tool names the caller expects to be available), `frontmatter_shape` (fields the macro can read via `_self.frontmatter.*`), `input_vars` (names + types of `input_var` keys), `success_contract` (an explicit success criterion overriding the implicit one extracted from the description). All optional; the skill infers what it can from the description alone if absent.
- `engine_validate` (optional, enum `"auto" | "on" | "off"`, default **"auto"**) — controls the engine dry-run stage (see "Engine dry-run validation" below). `"auto"` runs the dry-run when a live `fq` MCP surface is available to the orchestrator and skips it (with a warning) when not; `"on"` requires it; `"off"` disables it (pure static flow — used by `flashquery-macro-testgen` and other headless callers). Ignored in zero-shot mode.
- `user_preview` (optional, bool, default **false**) — when true (or when the user's request asks to see/approve the macro), the skill presents the final macro for human confirmation AFTER the rewrite loop converges and BEFORE returning it as final (see "Optional: user preview before finalizing" below).

#### Three flow modes

| Mode | `verify` | `auto_correct` | Behavior | When to use |
|---|---|---|---|---|
| **Zero-shot** | `false` | n/a | Generate only. Fastest. No verification overhead. No dry-run. | Performance-sensitive one-shot generation when the user accepts uninspected output. |
| **Validated** | `true` | `true` (default) | Generate → verify (static) → engine dry-run (if available) → apply mechanical fixes → loop on algorithmic misses AND engine failures up to `max_retries` → return final result. | **Default for end-user authoring.** Best UX. The user receives a macro vetted by both the static pass and the real engine. |
| **Calibration** | `true` | `false` | Generate → verify → engine dry-run (if available, report only) → return RAW macro + complete diagnostic report. No fixes applied, no retries. | Skill development. We want to see exactly what the generation step produced — including whether the raw output parses in the real engine — to identify recurring gaps. |

Why calibration mode matters: if verify silently auto-fixes the same kind of issue every run (e.g., always casing `True` → `true`), we never see that the gen prompt keeps making that mistake. Calibration mode surfaces the misses-that-would-have-been-fixed so we can update the spec to prevent them at generation time.

**Process:**

1. Read `macro-spec.md` (this folder) to ground the generation in current production semantics. Consult §12 for native `fq.*` tool names and argument shapes; never invent a native tool name or argument key that is not listed in §12 or explicitly supplied by the caller's `context.tool_surface`.
2. Parse the description for: (a) the load-bearing behavior, (b) the implicit success contract, (c) tools/frontmatter/inputs referenced.
2.5. **Pre-generation feasibility check** (see "Pre-generation feasibility check" section below). Run two narrow checks against the description BEFORE generating any macro source — spec-feasibility and surface availability. If either flags a concern, return a structured pre-check response (with reasoning + a suggested restatement) WITHOUT generating. If both clean, proceed to step 3. Behavioral descriptions where a translation pattern exists DO NOT trigger the check — the skill picks the pattern and proceeds.
3. Synthesize macro source using idiomatic post-REQ-112 patterns (lowercase booleans, flat if-scope, missing-field-null guards, leading-underscore introspection with VarRef when appropriate). For native `fq.*` calls, use only §12 tool names and argument keys unless `context.tool_surface` explicitly adds more. For **surgical, line-level document edits prefer `sed -i`** (§1.6/§9.8) — it edits the body in place and leaves frontmatter untouched by default; use the native `fq.*` tools for section/whole-document edits. `echo` is value-producing — use `echo $var` (optionally `| sed`) to emit/transform a bound value (§1.6). Content shell verbs (`cat`/`grep`/`sed`/`wc`/`head`/`tail`) default to `--scope "body"`; pass `--scope "both"` only when the raw file (incl. frontmatter) is needed. Do not produce constructs the spec doesn't support.
4. If `verify === true`:
   - **Validated mode** (`auto_correct: true`): invoke the verify workflow with `(description, macro_source, apply_fixes: true)`, then run the **engine dry-run stage** (step 4.5) when active.
     - If static verify passes AND the engine dry-run passes (or is skipped): converged — proceed to step 4.6.
     - If static verify returns `pass: false` OR the engine dry-run reports a blocking failure, and `retries_left > 0`: feed BOTH the verify report's `algorithmic_misses`/`suggested_change` AND the engine failure (error code, message, offending token) back into the generation prompt; regenerate; loop.
     - If `retries_left === 0` and still failing: escalate (see Escalation below).
   - **Calibration mode** (`auto_correct: false`): invoke the verify workflow with `(description, macro_source, apply_fixes: false)`, run the engine dry-run stage (step 4.5) when active for diagnostics ONLY, and return the result without re-generation regardless of pass/fail status. The `dry_run_report` is included so the maintainer can see whether the RAW generation parses in the real engine.
4.5. **Engine dry-run stage** (see "Engine dry-run validation" below). When `engine_validate` is active and a live `fq` MCP surface is available, call `fq.call_macro({ source: <macro>, input_vars: <sample inputs>, dry_run: true })`. Interpret the report per that section. In validated mode an engine failure is a blocking miss that drives the loop; in calibration mode it is report-only.
4.6. **Optional user preview** (see "Optional: user preview before finalizing" below). If `user_preview` is set (or the user asked to review/approve the macro), present the converged macro + a one-line dry-run summary and wait for confirmation before treating it as final.
5. Return the generation result (including `dry_run_report` when the dry-run ran).

**Output shape — validated mode (success path):**

```json
{
  "mode": "validated",
  "pre_check": { "feasible": true },
  "macro": "<macro source string, post-fix>",
  "verify_report": { ... },
  "dry_run_report": {
    "ran": true,
    "parsed_ok": true,
    "tool_references": ["fq.replace_doc_section", "fq.write_document"],
    "server_references": ["fq"],
    "input_var_contract": { "required": [], "optional": [] }
  },
  "attempts": 1,
  "fixed_issues": [],
  "warnings": []
}
```

`dry_run_report` is `{ "ran": false, "reason": "no live fq surface" | "engine_validate: off" }` when the dry-run did not run, and carries the engine's error envelope under `error` when a dry-run failure drove a regeneration.

When the pre-check fires (description names an unsupported construct or missing surface), the response is different — see "Pre-generation feasibility check" below for the full shape with `concerns`, `reasoning`, and `suggested_restatement`. In that case `macro` is `null` and `attempts` is `0` (no generation was performed).

The `attempts` field counts generations including the original (so 1 = first-try success, 2 = one retry, 3 = two retries).

**Output shape — calibration mode:**

```json
{
  "mode": "calibration",
  "macro_as_generated": "<raw output of gen, NO fixes applied>",
  "would_have_been_fixed": [
    { "issue": "...", "would_correct_to": "...", "rationale": "..." }
  ],
  "algorithmic_misses": [
    { "kind": "...", "expected": "...", "actual": "...", "suggested_change": "...", "notes": "..." }
  ],
  "warnings": [
    { "kind": "...", "suggestion": "...", "notes": "..." }
  ],
  "dry_run_report": {
    "ran": true,
    "parsed_ok": false,
    "error": { "error": "parse_error", "message": "...", "details": { "token": "...", "line": 4 } }
  },
  "skill_improvement_signal": "<one-line: which kind of misses recurred? where in macro-spec.md to update?>",
  "attempts": 1
}
```

In calibration the `dry_run_report` is report-only — a `parsed_ok: false` here is a strong skill-improvement signal (the RAW generation does not parse in the real engine), but it does NOT trigger regeneration. `skill_improvement_signal` is the load-bearing field for calibration. After 1+ calibration runs reveal the same pattern of misses, the signal tells the maintainer exactly which section of `macro-spec.md` (or which exemplar pattern) needs strengthening. Over time the signal trends from substantive ("gen keeps using integer sentinels instead of bools") to empty (gen is producing clean idiomatic output) — that's the skill converging.

**Output shape — zero-shot mode:**

```json
{
  "mode": "zero-shot",
  "macro": "<macro source string, no verification performed>"
}
```

#### Output contract — where the macro lives (no guesswork for the consumer)

The generated macro source is ALWAYS returned as one discrete, complete string in a single known field — never interleaved with prose. By mode:

| Mode / outcome | Field carrying the macro source |
|---|---|
| validated / zero-shot | `macro` |
| calibration | `macro_as_generated` |
| escalation (retries exhausted) | `last_attempt_macro` |
| pre-check blocked generation | `macro: null` (no source produced) |

That string is the **verbatim, ready-to-run macro source** — the consumer passes it directly as `fq.call_macro`'s `source` argument with no trimming, re-indentation, or surrounding text. It is the ONLY field that carries executable macro source; nothing else in the output is the macro.

For unambiguous extraction by eye or by a downstream agent, ALSO render the same source once in a fenced code block tagged `fqm` immediately before the JSON result object. The fence makes the start/end boundaries visually unmistakable; the JSON field remains canonical. The two MUST be byte-identical — if they ever diverge, trust the JSON field. (When the skill is driven programmatically, the JSON field alone is sufficient and unambiguous; the fence is the human/agent convenience.)

### Workflow 2 — verify

**Input contract:**

- `description` (required, string) — the intent statement to verify against.
- `macro` (required, string) — the macro source to inspect.
- `context` (optional, object) — same shape as generate's `context`.
- `apply_fixes` (optional, bool, default **true**) — if true, mechanical issues are corrected in-place and the corrected macro returned (`fixed_issues` field carries the log). If false (**calibration mode caller**), mechanical issues are surfaced as `would_have_been_fixed` without modification — the returned macro is byte-identical to the input. This is the toggle generate's `auto_correct: false` mode propagates.

**Process:**

1. Read `macro-spec.md` to ground the inspection in current production semantics.
2. **Syntactic / mechanical check.** Walk the macro against the grammar described in `macro-spec.md`. For each issue found:
   - If a deterministic mechanical fix exists (exactly one valid correction — see "Fix authority" below): apply it (when `apply_fixes`), record under `fixed_issues`.
   - If the issue is ambiguous or non-mechanical: record under `algorithmic_misses` or `warnings` per the severity rule.
3. **Behavioral intent check.** Walk the macro's structure against the description's stated behavior. Does the control flow drive through the behavior the description names? Do the tools / fields / inputs referenced match what the description implies? Each mismatch lands in `algorithmic_misses`. Native `fq.*` calls must match §12 tool names and argument keys unless the caller's `context.tool_surface` explicitly adds more; unknown native tools or native argument keys are `algorithmic_misses` with `kind: "unregistered_tool_reference"`.
4. **Success-contract check.** Does the macro's output (exit value, side effects) reflect the success criterion stated or implied in the description?
5. Return the verify report.

**Output shape (`apply_fixes: true`):**

```json
{
  "pass": true | false,
  "macro": "<macro source, post-fix>",
  "fixed_issues": [
    { "issue": "<one-line description>", "original": "<token/snippet>", "corrected": "<token/snippet>", "rationale": "<why this fix is deterministic>" }
  ],
  "algorithmic_misses": [
    { "kind": "<wrong_control_flow | wrong_tool | missing_branch | wrong_field_read | success_contract_mismatch | unregistered_tool_reference | other>", "expected": "<what the description implied>", "actual": "<what the macro does>", "suggested_change": "<concrete fix proposal>", "notes": "<rationale>" }
  ],
  "warnings": [
    { "kind": "<suboptimal_pattern | style_naming | framework_limitation | other>", "suggestion": "<concrete improvement>", "notes": "<rationale>" }
  ]
}
```

**Output shape (`apply_fixes: false`):**

Same as above EXCEPT:
- `macro` is byte-identical to the input (no fixes applied).
- `fixed_issues` is renamed to `would_have_been_fixed` to reflect that the corrections were identified but NOT applied.
- A new optional field `skill_improvement_signal` may be populated when the report reveals patterns the gen prompt should learn — e.g., recurring keyword-casing fixes, recurring builtin shadows.

`pass: true` requires `algorithmic_misses` is empty in both modes. `fixed_issues` / `would_have_been_fixed` and `warnings` are independent of pass status — they're informational signal.

## Severity taxonomy

| Category | Trigger | Action |
|---|---|---|
| **Mechanical** | Syntactic / lexical issue with exactly one deterministic correction. Examples: missing `fi` / `done` / `}`; `True` instead of `true`; builtin name shadowed by a variable assignment; trailing comma; reserved-keyword-as-variable. | **Auto-fix** in verify (when `apply_fixes`). Log under `fixed_issues`. Does NOT trigger regeneration. Does NOT consume a retry. |
| **Algorithmic miss** | The macro structurally won't produce what the description asks for. Examples: wrong control flow (`for` when description said `while`); calls wrong tool; missing required branch; reads wrong variable; success contract mismatch. | Surface in `algorithmic_misses`. Triggers regeneration (in the generate workflow with `verify: true`). Consumes a retry. |
| **Suboptimal pattern** | Macro works correctly but a better idiom exists. Examples: pre-declared sentinel that REQ-112b makes unnecessary; integer-as-sentinel where boolean would be clearer; verbose where concise would work. | Surface in `warnings`. No loop. No fix. Pass through. |
| **Style / naming** | Cosmetic preferences. Examples: variable naming, comment density, layout. | Surface in `warnings`. No loop. No fix. Pass through. |

## Fix authority (in verify, when `apply_fixes: true`)

Verify can mechanically correct macro source under these rules. The rules exist to prevent verify from drifting into "another generator that guesses at semantics":

- **Can** change tokens (add/remove/replace) — e.g., insert a missing `fi`.
- **Can** rename variables to avoid builtin shadowing — e.g., `status` → `phase`.
- **Can** correct casing of keywords — `True` → `true`, `Null` → `null`.
- **Can** balance unbalanced braces, brackets, parens by inserting the missing terminator if the location is unambiguous.
- **Cannot** restructure control flow — e.g., reorder statements, wrap statements in a new `if` or `for`.
- **Cannot** add or remove statements — only modify tokens within existing statements.
- **Cannot** swap one keyword for another — `while` ↔ `for`, `then` ↔ `do`, etc.
- **Cannot** add new logic — calling a different tool, accessing a different field, returning a different value.

**Deterministic-fix-only rule.** A mechanical fix is applied ONLY when there is exactly one valid correction. Ambiguous cases (e.g., a misspelled variable name where multiple identifiers in scope could be the intended target) escalate to `algorithmic_misses` rather than being silently corrected. Verify is not allowed to guess.

If you can't tell what the fix should be without rereading the description's intent, that's not a mechanical issue — that's an algorithmic miss.

## Pre-generation feasibility check

Runs as Step 2.5 of the generate workflow — BEFORE any macro source is synthesized. The point is to catch unrepresentable requests at the cheapest possible stage (a short prompt-side check) rather than burning a macro generation and catching it in verify, or worse, generating fictional syntax that looks plausible but doesn't parse.

### Scope — what the check is and isn't

**The check is narrow on purpose.** It runs ONLY against two concrete categories:

| Check | Catches | Examples |
|---|---|---|
| **Spec-feasibility** | Description names a construct the macro language doesn't have. Read against §10 of `macro-spec.md` ("Things the macro language does NOT have") plus the rare behavioral cases that are unrepresentable in any pattern. | "Use try/catch to handle errors." (no try/catch); "Index this list by position via `$list[0]`." (no list indexing); "Have this macro call itself recursively." (INV-08 forbids `call_macro` from inside a macro — unrepresentable in any pattern). |
| **Surface availability** | Description names a specific tool/builtin/symbol that doesn't exist in the language's surface. | "Call the `lower` builtin." (no `lower`; closest is `sed` shell verb); "Use `--flag=value` argument syntax." (only `--flag value` is in the grammar); "Read frontmatter via `_self.frontmatter[key]`." (object key access is `.key` only). |

**The check does NOT flag:**

- **Behavioral descriptions where a translation pattern exists.** The skill's job is to translate English intent into representable macro patterns. "Capture errors from a brokered tool and keep processing" is BEHAVIORAL — REQ-107 fail-fast rules out the isError implementation path, but the return-value-envelope idiom (§10 of `macro-spec.md`) achieves the same behavior. The skill picks the pattern silently and proceeds. NOT a pre-check failure.
- **Ambiguous-but-translatable descriptions.** "Handle the case where the document is missing" → could be REQ-112d missing-field-null guards, or `if doc._exists() then ... fi`, or a `fail` path. Multiple patterns work; the skill picks one. NOT a pre-check failure.
- **Speculative semantic concerns.** "Don't process too many items" → the skill defers the decision to the caller's frontmatter / input_vars contract. NOT a pre-check failure.

The bar is: a behavioral request gets translated, a prescriptive request that names a missing surface gets flagged, and a behavioral request that's genuinely unrepresentable gets flagged (rare — usually the missing-surface check catches these too, since the construct that would express the impossible behavior doesn't exist).

### Output when the check fires

When either check fires, return a structured pre-check response WITHOUT generating. The response must include solid reasoning AND a suggested restatement so the caller can refine their prompt rather than guess at what went wrong.

```json
{
  "mode": "validated" | "calibration" | "zero-shot",
  "pre_check": {
    "feasible": false,
    "concerns": [
      {
        "category": "spec_feasibility" | "surface_availability",
        "issue": "<one-line summary of what's wrong>",
        "spec_ref": "<macro-spec.md §X | REQ-NNN | INV-NN>",
        "reasoning": "<solid explanation with spec text quoted or paraphrased — the caller should understand WHY this isn't representable, not just that it isn't>",
        "suggested_restatement": "<a refined version of the original description the caller could try — phrased as a behavioral intent the language can satisfy>",
        "rationale_for_restatement": "<why the restatement maps to a supported pattern, citing the idiom from macro-spec.md>"
      }
    ]
  },
  "macro": null,
  "attempts": 0
}
```

**The suggested_restatement is load-bearing.** Returning "your request can't be fulfilled" without proposing what would work makes the skill an obstacle. Returning a refined description the caller can copy-paste-and-tweak makes the skill genuinely helpful — the caller learns what the language can express AND gets a working starting point.

### Examples

**Example 1 — prescriptive request flagged by surface_availability:**

```
Description: "Use the `lower` builtin to lowercase the title and use `replace` to swap spaces for hyphens."
```

```json
{
  "pre_check": {
    "feasible": false,
    "concerns": [{
      "category": "surface_availability",
      "issue": "The macro language has no `lower` or `replace` builtins.",
      "spec_ref": "§1.4 of macro-spec.md (Builtin names) + §10 (Things the macro language does NOT have)",
      "reasoning": "The full list of recognized builtins is: echo, status, task_id, list_tasks, count, unique, append, concat, add/sub/mul/div/mod, sleep/slow_op, fail, exit, input_var, range, grep/find/sed/cat/wc/head/tail/ls. There is no string-case operator and no regex/replace primitive. String text manipulation happens via the `sed` shell verb operating on files in the vault — heavy for a single string transformation.",
      "suggested_restatement": "Build a normalized summary object that includes the raw title and a separate `slug` field. If the slug needs case/space normalization, write the title to a vault file, run `sed` over it, and read the result back. Alternatively, if the title is already in a normalized form upstream (e.g., frontmatter author convention), just pass it through.",
      "rationale_for_restatement": "The suggested restatement either acknowledges the limitation (defer the transformation upstream) or uses the only available text-manipulation path (sed on vault files). Both are documented in §10 and §1.4 of macro-spec.md."
    }]
  }
}
```

**Example 2 — prescriptive request flagged by spec_feasibility:**

```
Description: "Use try/catch around the brokered tool call so the macro can continue on errors."
```

```json
{
  "pre_check": {
    "feasible": false,
    "concerns": [{
      "category": "spec_feasibility",
      "issue": "The macro language has no try/catch construct.",
      "spec_ref": "§10 of macro-spec.md (Things the macro language does NOT have) + REQ-107 (Fail-fast on errors)",
      "reasoning": "The macro language is small and shell-flavored — no exception-handling construct exists. Error handling happens through one of two production-compatible patterns: (a) the brokered tool returns a structured envelope like `{ ok: bool, ... }` and the macro reads `.ok` to branch (return-value-envelope pattern, §10); or (b) the macro halts immediately on any tool error (REQ-107 fail-fast — the macro engine catches `isError: true` and converts it to a `tool_call_failed` exit envelope).",
      "suggested_restatement": "If the brokered tool can return a structured result like `{ ok: true, value: ... }` or `{ ok: false, reason: ... }` rather than using the SDK's isError flag, the macro can branch on `.ok` and continue. Otherwise, the macro will halt on the first error and the caller will see the `tool_call_failed` envelope — which may already be the right behavior for your use case.",
      "rationale_for_restatement": "Maps to the return-value-envelope idiom in §10 of macro-spec.md, which is the only production-compatible way to do conditional flow on tool outcomes inside a single macro."
    }]
  }
}
```

**Example 3 — behavioral request, NOT flagged (skill translates silently):**

```
Description: "For each paper, call summary_srv.summarize. Some calls may fail — capture the failures into a separate list and keep going."
```

Pre-check passes. The phrase "may fail" is behavioral. The skill picks the return-value-envelope pattern (tool returns `{ ok: bool, ... }`), branches on `.ok`, accumulates into `summaries` and `failures` lists, and proceeds to generation. No concern surfaced — translation is the skill's job.

This was Run #5's actual behavior. The pre-check is not meant to catch this kind of request.

### Mode-specific behavior

| Mode | Pre-check action when concerns surface |
|---|---|
| **Zero-shot** | Return the pre-check response without generating. Same shape as above. |
| **Validated** | Return the pre-check response without generating. Caller refines description and re-invokes. No auto-correction loop fires because there's no generated macro to correct. |
| **Calibration** | Return the pre-check response AND proceed to generation anyway. The generated macro is surfaced as `macro_as_generated_post_concern`, so we can manually evaluate whether the concern was valid and whether the gen step did something reasonable despite the concern. This is the only mode that runs gen-despite-concern; it exists because calibration is for finding gaps in the skill (including the pre-check itself). |

### Calibration-mode pre-check schema

```json
{
  "mode": "calibration",
  "pre_check": { "feasible": false, "concerns": [ ... ] },
  "macro_as_generated_post_concern": "<what gen produced despite the concern — for manual evaluation>",
  "verify_report": { ... },
  "skill_improvement_signal": "<one-line: was the pre-check correct? did gen produce something usable anyway?>"
}
```

### Maintenance

When `macro-spec.md` §10 (unsupported constructs) or §1.4 (builtin names) changes, both checks track automatically — they're spec-grounded. No SKILL.md edit needed for spec evolution.

## Auto-correction loop (generate workflow)

When `verify: true` (default), the generate workflow runs:

```
attempts = 1
macro = generate(description, context)

while True:
  report = verify(description, macro, context, apply_fixes=true)          # static, LLM-judged
  dry    = engine_active ? dry_run(macro, sample_input_vars) : skipped    # deterministic, engine-judged

  blocking = report.algorithmic_misses + engine_failures(dry)            # engine_failures(skipped) == []; absent-input invalid_input is NOT a failure
  if blocking is empty:
    if user_preview: macro = present_for_confirmation(macro, report, dry) # may loop on user feedback
    return { macro: report.macro, verify_report: report, dry_run_report: dry, attempts, ... }

  if retries_left == 0:
    return escalation(description, attempt_history)   # history includes dry_run reports

  attempts += 1
  macro = regenerate(description, context, prior_attempt=macro,
                     verify_findings=report.algorithmic_misses,
                     engine_findings=engine_failures(dry))   # error code + message + offending token
```

**Retry budget**: 2 by default. Worst case is 3 generations: original + correction 1 + correction 2.

**What the regenerate prompt gets**: the original description, the prior macro attempt, the static `algorithmic_misses` with `suggested_change` fields, AND any engine dry-run failure (the engine's error code, message, and offending token/line). Engine feedback is high-signal because it's the real parser/preflight/permission pre-scan talking — target it precisely (e.g. a `parse_error` near a token means that exact construct is wrong).

**What does NOT trigger regeneration**: mechanical fixes (verify already corrected those in-place), warnings (informational only), and a dry-run `invalid_input` that only reflects ABSENT sample input_vars rather than a macro defect (see "Engine dry-run validation"). Static `algorithmic_misses` and genuine engine failures (parse / preflight / permission) drive the loop.

## Engine dry-run validation

The static verify workflow is LLM judgment against `macro-spec.md`. The engine dry-run stage adds a **deterministic, engine-backed check** by calling the real `call_macro` in dry-run mode — it validates without executing any statement or dispatching any tool (zero side effects on the target document).

**Invocation:** `fq.call_macro({ source: <macro>, input_vars: <sample inputs>, dry_run: true })`. The macro source is whatever the current attempt produced; `source_ref` is not used (the skill works with inline source).

**Precondition / availability.** This stage needs a live `fq` MCP surface exposed to the orchestrator running the skill. The skill prompt cannot call the tool itself — the orchestrator does, on the skill's behalf, and feeds the report back. Behavior by `engine_validate`:
- `"auto"` (default): run it if the `fq` surface is present; otherwise skip and add a `warning` (`{ kind: "framework_limitation", suggestion: "engine dry-run skipped — no live fq surface" }`). The static flow still applies.
- `"on"`: run it; if no `fq` surface is available, surface a warning that engine validation could not be performed (do not silently pass).
- `"off"`: never run it. This is the mode `flashquery-macro-testgen` and other headless callers use — there the macro framework harness is the validator, not dry-run.

**What it deterministically checks** (from the dry-run report):
1. **Parse** — `parsed_ok`. A `parse_error` is the highest-value catch: the LLM static pass can misjudge grammar (e.g. a pipeline used as a comparison operand, a reserved keyword as a bare object key), but the real parser cannot.
2. **Preflight** — structural rules (e.g. `exit` arity, input-var contract collection).
3. **Input-var contract** — required `input_var` keys present in the supplied sample inputs.
4. **Permission pre-scan (REQ-028)** — every `<server>.<tool>(...)` dispatch reference is registered/permitted; unknown servers/tools are rejected with `unknown_server` / `unknown_tool`.

It also returns `tool_references` / `server_references` (the exact set the macro would touch) and the resolved `input_var_contract` — fold these into `verify_report` as engine-confirmed facts.

**How failures map into the loop (validated mode):** a dry-run error becomes a blocking miss with `kind` one of `engine_parse_error | engine_preflight_error | engine_permission_error`, carrying the engine's `message` and offending `token`/`line` as the `suggested_change` seed. It consumes a retry exactly like an `algorithmic_miss` and is fed to `regenerate`. It is **higher authority** than a static miss — when the static pass and the engine disagree, the engine wins.

**Sample input_vars.** Supply `context.input_vars` when present. If the macro declares required `input_var` keys but no sample values are available, synthesize type-appropriate placeholders so parse/preflight/permission validation can still run, and treat a resulting `invalid_input` (missing-input) as **non-blocking** — it reflects absent test data, not a macro defect. Parse/preflight/permission errors remain blocking.

**Limits (be honest about them):**
- **Static-only.** It does NOT execute statements, so runtime failures are not caught: field access through `null`, unknown-variable reads, a `replace_doc_section` heading that doesn't exist, a tool returning `isError`, type mismatches. A clean dry-run proves "this parses and is permitted to call these tools," not "this will succeed." Behavioral verify still matters.
- **`_exists()` is not pre-scanned** (the §11.1 limitation). A server referenced ONLY via `target._exists()` passes dry-run and fails at runtime. Dispatch refs are covered; introspection probes are not.

## Optional: user preview before finalizing

When `user_preview` is set, or when the user's request asks to see/approve the macro before it is used ("show me the macro first", "let me review it before you save it", "I want to confirm what it'll do"), present the macro to the user AFTER the rewrite loop converges and BEFORE returning it as final:

1. Display the final macro source (fenced) and a one-line validation summary. When the dry-run ran: `parsed_ok: true · touches: fq.replace_doc_section, fq.write_document · requires inputs: none`. When the dry-run was skipped (`dry_run_report.ran === false`): say so explicitly — e.g. `engine dry-run: not run (no live fq surface) — validated by static review only` — do not imply engine confirmation that didn't happen.
2. State plainly what the macro WILL do to the target (the document/section writes, tag changes, moves) so the user can judge intent — and note that nothing has been performed yet (the dry-run, if it ran, executed nothing).
3. Wait for the user:
   - **Approve** → return the macro as final.
   - **Request changes** → treat the user's feedback as a refinement of the `description` and re-enter the generate loop (this is a fresh authoring pass, not a dry-run retry).
   - **Reject** → return without a finalized macro; offer the last attempt as a starting point.

This is the human gate: the dry-run (when it ran) proves the macro parses and is side-effect-free; the preview lets the user confirm it's what they actually want before anything is written or executed. Default off — only engages on `user_preview` or an explicit user request.

## Escalation (when max_retries exhausted)

After `max_retries + 1` failed generations, return an escalation report instead of a macro:

```json
{
  "escalated": true,
  "attempts": 3,
  "history": [
    { "attempt": 1, "macro": "...", "verify_report": { ... }, "dry_run_report": { ... } },
    { "attempt": 2, "macro": "...", "verify_report": { ... }, "dry_run_report": { ... } },
    { "attempt": 3, "macro": "...", "verify_report": { ... }, "dry_run_report": { ... } }
  ],
  "convergent_misses": [
    "<pattern that recurred across attempts — static misses AND/OR repeated engine errors (e.g. the same parse_error token every attempt)>"
  ],
  "ambiguity_assessment": "<the original description was ambiguous about X. Consider clarifying Y.>",
  "suggested_clarification": "<draft of a refined description the user could try>",
  "last_attempt_macro": "<the final attempt — may still be useful as a starting point>"
}
```

The `convergent_misses` field is the key signal: if all 3 attempts missed in similar ways, the description likely has a gap. The `ambiguity_assessment` and `suggested_clarification` fields help the user see what to refine in their prompt — not just what failed in the output.

The caller (or user) decides what to do with an escalation: accept the last attempt, refine the description and retry, or abandon. The skill does not auto-retry beyond `max_retries`.

## Reference: macro-spec.md

The companion file [`macro-spec.md`](./macro-spec.md) in this folder is the single source of truth for what production currently supports. Both generate and verify workflows consult it.

Maintenance contract: when the production engine ships a new feature, update `macro-spec.md` and the skill's behavior automatically tracks. When the spec doc changes meaning, both workflows shift in lockstep — there's no drift between "what I generate" and "what I verify".

## Trigger phrases

The skill is invoked when the user says any of:

- "write me a macro that <description>"
- "author a macro for <use case>"
- "create a FlashQuery macro that <description>"
- "I need a macro that <description>"
- "generate a macro <description>"
- "verify this macro" / "check this macro against <intent>"
- "does this macro do what I asked?"
- "review my macro" (when a macro source is in scope)
- "make me a rundoc macro that <description>"

When invoked from `flashquery-macro-testgen`, the skill is called via its `generate` workflow with the **behavioral brief** that testgen constructs (never the raw coverage-cell description) mapped onto the `description` + `context` contract.

## Related skills

- **flashquery-macro-testgen** — wraps the macro into a runnable test pilot YAML. Calls this skill for the macro source synthesis. **When testgen wraps a macro this skill produced, the original natural-language `description` (the intent) MUST be emitted as the pilot's `intent:` field** (per the YAML schema in `runner.ts` `TestCase.intent`). That keeps the prompt traceable from the saved pilot back to the natural-language request that drove generation — useful for grepping related scenarios and for retracing why a particular macro shape emerged from a particular prompt.
- **flashquery-macro-run** — executes the macro framework suite and triages failures.
- **flashquery-macro-covgen** — refreshes the coverage matrix renders after new pilots land.

## Principles

**The spec is the dictionary.** Both workflows read `macro-spec.md` as the ground truth. If they disagree about what the language supports, the disagreement is a `macro-spec.md` bug, not a workflow bug.

**Verify can fix mechanical issues; only algorithmic misses regenerate.** Mechanical fixes don't waste tokens on regeneration. Algorithmic misses are real signals that the gen prompt missed the intent.

**The auto-correction loop is bounded.** 2 retries max. Beyond that, the description likely needs refinement — escalate with ambiguity feedback rather than burning more tokens.

**Production constraints are real.** If a description asks for a construct the spec doesn't support, the skill refuses cleanly rather than inventing syntax. The macro language is small; the skill stays inside it.

**Provenance is preserved.** Generated macros (when used in test pilots) carry the same `generator:` block conventions as `flashquery-macro-testgen` produces.
