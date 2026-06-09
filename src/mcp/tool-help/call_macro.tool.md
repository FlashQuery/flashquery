---
name: call_macro
description: "Execute a FlashQuery macro to chain multiple tool operations, pass intermediate results between them, or run conditional logic in a single round-trip. Use for compound or composite work that combines several individual FlashQuery tool calls into one orchestrated execution. The macro language supports variables, conditionals, loops, and composition of any FlashQuery-native or brokered tool, with intermediate state held inside the engine rather than in the conversation context. For one-shot single-tool operations, prefer the direct tool. Pass help:true for syntax and patterns."
help_hint: "FlashQuery's general-purpose execution tool — runs a macro that can chain multiple FlashQuery operations, pass intermediate results between them, or run conditional logic in a single round-trip. Best for compound or composite work; for one-shot single-tool operations, prefer the direct tool. Pass `{help: true}` for syntax and patterns."
tier: admin
args:
  source: "Inline FlashQuery macro source."
  source_ref: "Vault document reference containing macro source."
  input_vars: "Optional initial variable bindings."
  budget: "Optional execution limits."
  dry_run: "Optional parse and planning mode."
  trace: "Optional trace detail level."
  progress: "Optional progress notification level."
---

# call_macro

## Purpose

Use `call_macro` when one request needs deterministic orchestration across multiple FlashQuery-native or brokered tools. A macro can read a value, store it in a variable, branch on it, loop over collections, and pass intermediate results into later calls without putting that state back into the conversation. Prefer direct tools for single operations; use a macro when the work is compound, conditional, or needs fan-out/fan-in behavior.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `source` | string | one of `source` or `source_ref` | none | Inline macro source. |
| `source_ref` | string | one of `source` or `source_ref` | none | Vault document reference. The macro receives the `_self` source-document snapshot. |
| `input_vars` | object | no | `{}` | Initial variables available to the macro. |
| `budget` | object | no | configured defaults | Optional `max_total_tokens`, `max_model_calls`, `max_external_tool_calls`, and `timeout_ms`. |
| `dry_run` | boolean | no | `false` | Parse and plan without executing side effects. |
| `trace` | string | no | `summary` | `full`, `summary`, or `none`. |
| `progress` | string | no | `milestones` | `full`, `milestones`, or `silent` progress notifications. |

## Returns

Returns a standard MCP text result containing the macro evaluation result or a structured expected/runtime error. Successful macros return the value emitted by the macro program. Failures include parse errors, invalid source selection, budget exhaustion, tool errors, cancellation, or requested `needs_user_input` exits.

## Examples

```json
{ "source": "let doc = get_document({ identifiers: \"Notes/Plan.md\" })\nexit doc" }
```

Reads one document and returns the direct tool result.

```json
{ "source": "let a = get_document({ identifiers: \"Notes/A.md\" })\nlet b = get_document({ identifiers: \"Notes/B.md\" })\nexit { a: a, b: b }", "trace": "summary" }
```

Chains reads and returns both intermediate values in one response.

```json
{ "source_ref": "Macros/review-draft.md", "input_vars": { "target": "Drafts/Post.md" }, "dry_run": true }
```

Loads macro source from the vault and validates it without applying side effects.

## Gotchas

- Provide exactly one of `source` or `source_ref`.
- `_self` is available only when the macro is loaded via `source_ref`.
- Write macros to be idempotent around partial state; retries can happen after failures.
- Each macro step uses the called tool's own document lock behavior. `call_macro` does not hold a macro-spanning lock, does not make multi-step document workflows atomic, and does not auto-thread future `version_token` / `expected_version` safety checks.
- When a macro needs read-modify-write safety across steps, pass explicit version preconditions once the target tool supports them; automatic macro token threading and atomic macro execution are deferred.
- Use explicit budgets for broad loops or model/tool-heavy programs.
- If the macro needs a user decision, return a `needs_user_input` style value instead of guessing.
- For surgical, line-level edits, use the `sed -i` shell verb (e.g. `sed -i "s/old/new/" "Notes/doc.md"`); for section or whole-document edits use `replace_doc_section` / `insert_in_doc` / `write_document`. Shell content verbs (`cat`, `grep`, `sed`, `wc`, `head`, `tail`) default to `--scope "body"` (frontmatter excluded), so `sed -i` leaves frontmatter — including `fq_id` — untouched by default; pass `--scope "both"` for the whole raw file.
- A `sed -i` write reconciles into the search index/embeddings on the next vault scan, not synchronously.

## Related Tools

- `call_model` can ask an LLM to reason or draft before a macro executes.
- `search_tools` can discover direct tools before deciding whether a macro is warranted.
- Direct document tools such as `insert_in_doc`, `replace_doc_section`, and `move_document` are better for one-shot operations.
