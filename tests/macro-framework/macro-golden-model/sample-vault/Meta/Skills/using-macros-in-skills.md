---
type: skill
fq_id: 3add017e-88ed-4ee6-b40e-61d86b16536d
fq_title: Using macros in skills
fq_status: active
fq_tags:
  - '#type/skill'
  - '#category/meta'
  - '#topic/macros'
fq_created: '2026-05-13T19:55:30.897+00:00'
fq_updated: '2026-05-18T18:35:03.039Z'
fq_instance: work-center
---

# Using macros in skills

This meta-skill teaches you (the LLM following a skill workflow) how to
recognize and invoke FlashQuery macros embedded in skills. Skills that use
macros should reference this meta-skill at the top so its conventions are
in your context.

> **Note on location.** The path this template lives at
> (`Meta/Skills/using-macros-in-skills.md`) is *illustrative*, not
> prescribed. FlashQuery does not treat `Meta/Skills/` as a privileged
> folder, does not parse or enforce template paths, and does not look for
> "skill" documents in any special way. This template is a starter point
> — keep it here, move it elsewhere, modify it, or delete it as suits your
> vault. The conventions in this document apply to macros regardless of
> where the documentation that teaches them lives.

## What a macro is

A FlashQuery macro is a small deterministic script that runs end-to-end
inside FlashQuery's macro engine when invoked via the `call_macro` MCP
tool. Macros are the *inline-ASM* of skills: the skill is the natural-
language workflow you interpret behaviorally; an embedded macro is a
deterministic batch operation that runs byte-for-byte against
FlashQuery's tool engine.

You invoke a macro by calling the `call_macro` MCP tool. You consume
its result the same way you consume any other tool result — as
structured data you read field-by-field, not as text to parse.

## Two kinds of docs you'll encounter

Macros live inside markdown documents. There are **two distinct doc roles**
you should be able to recognize — they look similar but serve different
purposes:

| Role | Frontmatter | Audience | Purpose |
|---|---|---|---|
| **Skill doc** | `type: skill` | You (the LLM) | Workflow narrative. You read it; you may also see fqm blocks embedded inline (Pattern 1) or references to a macro library (Pattern 2/3). |
| **Macro library doc** | `type: macro_library` | The macro engine | A self-describing library of one or more named macros, addressable by `source_ref`. The prose around the fqm blocks is documentation; the executable content is the named fqm block(s). |

A single doc can technically play both roles, but the typical convention
separates them. When a skill points you at `source_ref: "Macros/foo.md"`,
that target is normally a macro library doc.

### How macros are named in library docs

Inside a macro library doc, each macro is a fenced code block with a
`name=<identifier>` fence attribute:

```fqm name=add_projections
... macro source ...
```

The fence attribute is the macro's authoritative name. Names are
identifier-style: letters, digits, underscores, hyphens. No spaces, no
quotes. Multiple macros in one library doc each have their own name.

### Addressing a named macro via `source_ref`

`source_ref` uses a `::` separator to point at a specific named macro
within a library doc. (This is distinct from `#`, which is reserved for
heading anchors within a doc. `::` means "find a named block inside this
file" — a distinct semantic from heading anchoring.)

- `source_ref: "Macros/projections.md"` — single-macro library (or you
  want whichever macro is there); only valid if the library has exactly
  one macro.
- `source_ref: "Macros/projections.md::add_projections"` — named-block
  form. Required when the library has multiple macros.

If `source_ref` doesn't match an existing block, the engine returns a
canonical error envelope listing the `available_names` so you can pick
the right one and retry.

## The function-call contract

Every macro is effectively a function with:

- **Inputs** — declared explicitly inside the macro by `input_var` builtin
  calls at the top of the source. The caller supplies values via the
  `input_vars` field of `call_macro`. The engine binds each value to the
  local name the macro chose. **Required inputs** are declared as
  `name = input_var "key"`; missing them at call time fails pre-flight with
  a canonical `invalid_input` envelope listing all missing keys at once,
  before any execution. **Optional inputs** are declared as
  `name = input_var "key" --default <literal>`; the default applies only
  when the key is truly missing (not when explicitly passed as `null`).
  `input_vars` values can be any JSON-expressible shape — strings, numbers,
  booleans, `null`, **lists** (for zero-to-N input), objects, nested
  combinations.
- **A return value** — surfaced as `result` in the `call_macro` response.
  Always a structured Value (string, number, boolean, list, object, or
  null) — never just a text blob. Field-access it directly (e.g.,
  `result.file.fq_id`) when continuing your workflow.
- **Possible error envelopes** — if the macro fails (intentionally via
  `fail`, pre-flight via missing required inputs, or due to a tool-call
  failure), the response is a canonical error envelope
  `{ error, message, identifier?, details? }`. Surface the error to the
  user only if it's unrecoverable.

### Reading a macro's input contract

A well-written macro declares its inputs at the top, one per line, with
inline comments explaining each. The `input_var` lines *are* the contract:

```fqm name=research_batch

# List of topics to research. Required.
topics = input_var "topics"

# Output catalog vault path. Defaults to "Research/".
output_path = input_var "output_path" --default "Research/"

# Max hits per topic. Optional; default 3.
hits_per_topic = input_var "hits_per_topic" --default 3
```

Reading this macro, you know:
- `topics` is required and you must pass it.
- `output_path` and `hits_per_topic` are optional — pass them only if you
  want to override the defaults.
- `topics` can be a list of any length (the zero-to-N pattern) — the macro
  will iterate over whatever you give it.

## The three embedding patterns

A skill embeds a macro invocation in one of three ways. Recognize which
pattern the skill is using and invoke accordingly.

### Pattern 1 — Inline macro at point-of-invocation

The skill contains a fenced ```fqm``` block at the step where the macro
runs. Surrounding prose tells you to call `call_macro` with that source
and the listed inputs.

When you see this pattern:

1. Copy the macro source **verbatim** between the fence markers — do not
   "improve," "clean up," reformat, or add commentary. The macro engine
   parses the source as-is.
2. Construct the `call_macro` request with `source` set to that verbatim
   text and `input_vars` set to the values described.
3. Invoke the tool. Read the structured `result` and continue the
   workflow per the skill's next-step instructions.

### Pattern 2 — Referenced macro via `source_ref`

The skill points at a macro stored in the vault and explicitly tells you
which inputs to pass:

```
Invoke call_macro with:
- source_ref: "Macros/research-batch.md"
- input_vars:
  - search_phrases: <values>
  - output_path: <value>
```

When you see this pattern:

1. Construct the `call_macro` request with `source_ref` set to the given
   vault reference and `input_vars` set to the listed values.
2. Do NOT inline the macro source yourself — the engine fetches and
   parses the doc on its own.
3. Invoke, consume the result, continue.

### Pattern 3 — Self-describing macro doc + `{{ref:...}}` expansion

The skill is compact: it references a macro doc via `{{ref:Macros/X.md}}`
and supplies inputs adjacent to the reference:

```
{{ref:Macros/research-batch.md}}

Inputs:
- search_phrases: <values>
- output_path: <value>
```

If you're being invoked as a **delegated model**, the reference will
already have been expanded by `call_model`'s preprocessing — you'll see
the macro doc's body inlined into the skill text. Use the expanded text
to understand the macro's contract; assemble the `call_macro` request
using `source_ref` pointing at the macro doc (NOT inline `source`).

If you're being invoked as the **host model**, you may see the literal
`{{ref:Macros/X.md}}` marker because `{{ref}}` resolution happens inside
`call_model` and is not (yet) available to the host directly. In this
case:

1. Call `call_model({ messages: [{ role: "user", content: <the section
   containing the marker> }], dry_run: true, include_resolved_messages:
   true })` to trigger reference expansion server-side.
2. Read the `resolved_messages` content from the response — this is what
   a delegated model would have seen automatically.
3. Proceed as if you'd received the expanded form to begin with.

(Note: `call_model({ dry_run: true })` may not be available in all
versions of FlashQuery. If it is not, you can fall back to calling
`fq.get_document` on the referenced doc to read its body — but be aware
that nested `{{ref}}` markers within that body won't be resolved.)

## Control flow after MCP tool calls

When `call_macro` (or any other MCP tool) returns, **you remain in your
turn**. The tool result is part of your working context; use it to drive
the next action. Do NOT return to the user with the tool result —
continue the workflow until you reach a step that explicitly asks for
user input or until the skill's workflow is complete.

This applies to:

- `call_model({ dry_run: true })` returning resolved skill text
- `call_macro({ ... })` returning a structured `result`
- `fq.get_document`, `fq.write_document`, and other primitives

All of these are intermediate steps in your turn. The user sees your
final response, not the intermediate tool results.

## Common pitfalls

- **Don't summarize a macro's `result` as if it were narration.** It's
  structured data — field-access it (`result.file.fq_id`, etc.) for the
  next step. Save narration for an explicit `echo` line in the macro
  source if needed.
- **Don't substitute `input_vars` values into the macro source string.**
  That's Pattern 1's antipattern. The clean way is to pass them in the
  `input_vars` parameter as JSON. The macro author declared the contract
  via `input_var` lines at the top of the source; honor it.
- **Don't omit required inputs hoping the macro will fill them in.** Pre-
  flight fails with `error: "invalid_input"` listing every missing key.
  Re-read the macro's `input_var` lines and pass every required key.
- **Don't try to invoke a fenced `fqm` block as if it were a tool name.**
  The block is the *macro source*; the *tool* you invoke is `call_macro`,
  and the source is one of its parameters.
- **Don't loop on `call_macro` errors blindly.** If `call_macro` returns
  `error: "forbidden_tools"` or `error: "unknown_server"`, that's a
  configuration problem — surface it to the user; don't retry.

## Macro language quick reference

The macro language supports these constructs when you're writing macro
source (Pattern 1 inline, or reading what a referenced macro library doc
contains):

**Comparison operators:** `==`, `!=` (strings/numbers/null); `<`, `>`,
`<=`, `>=` (numeric only). String ordering via `<`/`>` is not supported in
v0 — use a comparison builtin or rewrite if you need it.

**Boolean combinators:** `&&` (AND, short-circuit), `||` (OR, short-circuit),
`!` (NOT). All available in `if` conditions and `while` conditions.

**Loop forms:**

```
for X in $list do ... done    # foreach
while $cond do ... done       # conditional
```

`do` is required in both forms.

**Iterator-style loops:** use the `range` builtin OR the `..` range operator —
both produce equivalent lists:

```
for i in range 10 do ... done    # Python-style
for i in 0..10 do ... done       # Rust/Ruby-style — same result
```

The `..` operator is exclusive of the end (`0..10` produces `[0, 1, ..., 9]`).

**Input declarations** (per OQ #23):

```
required_input = input_var "key_name"
optional_input = input_var "other_key" --default "fallback"
optional_with_null_default = input_var "third" --default null
optional_with_list_default = input_var "fourth" --default [1, 2, 3]
```

**Reserved identifiers you cannot use as variable names:** the keywords
above (`for`, `in`, `do`, `done`, `if`, `then`, `else`, `fi`, `while`, `null`)
plus the builtin names (`echo`, `status`, `count`, `unique`, `append`,
`concat`, `add`/`sub`/`mul`/`div`/`mod`, `sleep`, `slow_op`, `fail`, `exit`,
`input_var`, `range`, `task_id`, `list_tasks`, plus shell verbs `grep`,
`find`, `sed`, `cat`, `wc`, `head`, `tail`, `ls`). Trying to assign to one
of these is a parse error.

**Truthiness in conditions:** falsy values are `null`, `0`, `""`, `[]`, `{}`.
Everything else (including comparison-operator results) is truthy.

## When in doubt

If a skill references a macro that isn't clearly documented, you can:

- Read the macro doc directly with `fq.get_document` and look at the
  `input_var` lines at the top of the `fqm` block — those *are* the
  contract (key name, optional `--default`, inline comments).
- Search for related skills or examples with `fq.search`
- Ask the user for clarification if the contract is genuinely ambiguous

The macro-doc convention (see `Macros/*` docs in this vault) puts the
contract in plain Markdown at the top of the doc, with the `input_var`
prelude inside the `fqm` block — reading it is always cheap.
