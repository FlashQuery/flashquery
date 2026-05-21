---
name: flashquery-macro-author
description: Author and verify a FlashQuery macro from a natural-language description of intent. Use this skill when the user asks to "write me a macro that ...", "author a macro", "generate a FlashQuery macro", "create a rundoc macro for ...", "I need a macro that ...", "verify this macro against my intent", "check this macro against the spec", "review my macro", or any phrase indicating they want a macro program produced from English (or want one they have checked against a stated intent). Two workflows — generate (description → macro source) and verify (description + macro source → conformance report). Generate optionally auto-invokes verify with a bounded auto-correction loop. Verify can also be invoked standalone. This skill produces JUST the macro source. Wrapping into a test pilot YAML belongs to `flashquery-macro-testgen`; executing a macro against the engine belongs to the host (`fq.call_macro`) or `flashquery-macro-run`.
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

- It does **not** run the macro. Execution is a separate concern (host MCP `fq.call_macro` in production; `flashquery-macro-run` for the test suite).
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

#### Three flow modes

| Mode | `verify` | `auto_correct` | Behavior | When to use |
|---|---|---|---|---|
| **Zero-shot** | `false` | n/a | Generate only. Fastest. No verification overhead. | Performance-sensitive one-shot generation when the user accepts uninspected output. |
| **Validated** | `true` | `true` (default) | Generate → verify → apply mechanical fixes → loop on algorithmic misses up to `max_retries` → return final result. | **Default for end-user authoring.** Best UX. The user receives a vetted macro. |
| **Calibration** | `true` | `false` | Generate → verify → return RAW macro + complete diagnostic report. No fixes applied, no retries. | Skill development. We want to see exactly what the generation step produced so we can identify recurring gaps and improve `macro-spec.md` or the prompt. |

Why calibration mode matters: if verify silently auto-fixes the same kind of issue every run (e.g., always casing `True` → `true`), we never see that the gen prompt keeps making that mistake. Calibration mode surfaces the misses-that-would-have-been-fixed so we can update the spec to prevent them at generation time.

**Process:**

1. Read `macro-spec.md` (this folder) to ground the generation in current production semantics.
2. Parse the description for: (a) the load-bearing behavior, (b) the implicit success contract, (c) tools/frontmatter/inputs referenced.
2.5. **Pre-generation feasibility check** (see "Pre-generation feasibility check" section below). Run two narrow checks against the description BEFORE generating any macro source — spec-feasibility and surface availability. If either flags a concern, return a structured pre-check response (with reasoning + a suggested restatement) WITHOUT generating. If both clean, proceed to step 3. Behavioral descriptions where a translation pattern exists DO NOT trigger the check — the skill picks the pattern and proceeds.
3. Synthesize macro source using idiomatic post-REQ-112 patterns (lowercase booleans, flat if-scope, missing-field-null guards, leading-underscore introspection with VarRef when appropriate). Do not produce constructs the spec doesn't support.
4. If `verify === true`:
   - **Validated mode** (`auto_correct: true`): invoke the verify workflow with `(description, macro_source, apply_fixes: true)`.
     - If verify returns `pass: true` (possibly after applying mechanical fixes): return.
     - If verify returns `pass: false` and `retries_left > 0`: feed the verify report's `algorithmic_misses` and `suggested_change` fields back into the generation prompt; regenerate; loop.
     - If `retries_left === 0` and still failing: escalate (see Escalation below).
   - **Calibration mode** (`auto_correct: false`): invoke the verify workflow with `(description, macro_source, apply_fixes: false)`. Return the result without re-generation regardless of pass/fail status.
5. Return the generation result.

**Output shape — validated mode (success path):**

```json
{
  "mode": "validated",
  "pre_check": { "feasible": true },
  "macro": "<macro source string, post-fix>",
  "verify_report": { ... },
  "attempts": 1,
  "fixed_issues": [],
  "warnings": []
}
```

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
  "skill_improvement_signal": "<one-line: which kind of misses recurred? where in macro-spec.md to update?>",
  "attempts": 1
}
```

`skill_improvement_signal` is the load-bearing field for calibration. After 1+ calibration runs reveal the same pattern of misses, the signal tells the maintainer exactly which section of `macro-spec.md` (or which exemplar pattern) needs strengthening. Over time the signal trends from substantive ("gen keeps using integer sentinels instead of bools") to empty (gen is producing clean idiomatic output) — that's the skill converging.

**Output shape — zero-shot mode:**

```json
{
  "mode": "zero-shot",
  "macro": "<macro source string, no verification performed>"
}
```

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
3. **Behavioral intent check.** Walk the macro's structure against the description's stated behavior. Does the control flow drive through the behavior the description names? Do the tools / fields / inputs referenced match what the description implies? Each mismatch lands in `algorithmic_misses`.
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
  report = verify(description, macro, context, apply_fixes=true)

  if report.pass:
    return { macro: report.macro, verify_report: report, attempts, ... }

  if retries_left == 0:
    return escalation(description, attempt_history)

  attempts += 1
  macro = regenerate(description, context, prior_attempt=macro, verify_findings=report.algorithmic_misses)
```

**Retry budget**: 2 by default. Worst case is 3 generations: original + correction 1 + correction 2.

**What the regenerate prompt gets**: the original description, the prior macro attempt, AND the `algorithmic_misses` list with `suggested_change` fields. The LLM uses the verify feedback to target the specific misses.

**What does NOT trigger regeneration**: mechanical fixes (verify already corrected those in-place), warnings (informational only). Only `algorithmic_misses` causes the loop.

## Escalation (when max_retries exhausted)

After `max_retries + 1` failed generations, return an escalation report instead of a macro:

```json
{
  "escalated": true,
  "attempts": 3,
  "history": [
    { "attempt": 1, "macro": "...", "verify_report": { ... } },
    { "attempt": 2, "macro": "...", "verify_report": { ... } },
    { "attempt": 3, "macro": "...", "verify_report": { ... } }
  ],
  "convergent_misses": [
    "<pattern that recurred across attempts>"
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
