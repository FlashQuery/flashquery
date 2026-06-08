# FlashQuery Macro Language — Specification Reference

**Audience.** Both the generate and verify workflows of `flashquery-macro-author` consult this file as the ground truth for what the production engine supports. When generating, use ONLY constructs documented here. When verifying, check ONLY against the rules stated here. If production ships a new feature, update this file; both workflows track automatically.

**Spec date.** 2026-05-19. Reflects FlashQuery v3.5 + REQ-112a/b/c/d clarifiers shipped.

**Authoritative sources.**

- `flashquery-product/Archive/Implemented/Macro Language (17-May-2026)/FlashQuery Macro Language Requirements.md` (REQ-001..063 — archived, frozen).
- `flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md` §7.15 REQ-103..112d (macro engine extensions shipped with v3.5 broker).

This file is the operational summary. When in doubt, the authoritative sources rule.

---

## 1. Grammar — surface syntax

Macros are line-oriented, shell-flavored. Statements are separated by newlines. No semicolons. Indentation is ignored.

### 1.1 Statements

A macro is a sequence of statements. Each statement is one of:

- **Assignment.** `<identifier> = <expression>` — binds the value of expression to the named variable. Walk-up scope: if the name exists in any enclosing scope, the assignment updates that binding; otherwise creates a new local binding in the current scope.
- **Tool call (statement position).** `<server>.<tool>({ <args> })` — dispatches the call and discards the return value.
- **For-loop.** `for <var> in <iterable> do <statements> done` — iterates the variable over the items in the iterable. Iterator variable is strictly local to the loop body.
- **While-loop.** `while <condition> do <statements> done` — iterates while the condition is truthy. Condition re-evaluated each iteration.
- **If-then-else.** `if <condition> then <statements> [ else <statements> ] fi` — branch on condition truthiness. The `<condition>` accepts any value-producing expression: primaries (`$var`, literals), field access, comparisons (`$x == 5`), boolean combinators (`$a && $b`), `_exists()` introspection (§5.2), and pipelines / builtin calls (`input_var "flag" --default false`, `count $list`). The truthiness of the resulting value gates the branch. Same shape for `while <condition> do ... done`. **Note:** the §1.2 grammar boundary on pipelines-in-comparison-operands STILL applies — `if mod $n 2 == 0 then` doesn't parse because the pipeline is on the LHS of `==`; pre-compute first.
- **Continue / Break.** `continue` skips to the next iteration of the enclosing loop. `break` exits the enclosing loop. Parse-time error if used outside a loop body.
- **Exit builtin.** `exit <expression>` — halts the macro immediately, returning the expression's value. Statements after `exit` do not run. It is parsed as a builtin name, not a separate statement keyword.
- **Fail builtin.** `fail "<message>"` — halts the macro with a `macro_aborted` error envelope carrying the message. It is parsed as a builtin name, not a separate statement keyword.

### 1.2 Expressions

- **Literals.** Number (`42`, `3.14`, `-1`), string (`"double-quoted"` with `\n` `\t` `\r` `\"` `\\` `\$` escapes; `'single-quoted'` raw), boolean (`true`, `false` — lowercase only, REQ-112c), `null`, list (`[1, 2, 3]`), object (`{ key: value, "string key": value }`).
- **Variables.** `$name` — read the binding named `name` from the current scope, walking up to parents. `${name}` works the same inside string interpolation.
- **Field access.** `$obj.field` or `$obj.a.b.c` — read a field from an object value. Chained access through `.` traverses nested objects.
- **String interpolation.** Inside `"..."`, sequences `$name` and `${name.path}` are substituted with the stringified variable value. Inside `'...'`, raw text — no interpolation.
- **Comparison.** `==`, `!=`, `<`, `<=`, `>`, `>=`. Numeric operators require numeric operands. Cross-type equality (`"5" == 5`) returns `false`.

  **Grammar boundary — pipelines are NOT valid operands of comparison operators.** The `compareExpr` rule chains over `rangeExpr`, which roots at `primary` (literals, varOrField, listLit, objectLit, parenthesized expr, toolCall in primary position). A pipeline expression (e.g., `count $list`, `mod $n 2`, `add $a $b`) cannot appear directly as a left or right operand of `==`, `!=`, `<`, etc. **Always pre-compute pipeline values into a named variable, then compare the variable.**

  ```
  # WRONG — pipeline as left operand of ==
  if mod $n 2 == 0 then ...           # parse_error

  # WRONG — pipeline as right operand of ==
  if $n_reachable == count $candidates then ...  # parse_error

  # CORRECT — pre-compute, then compare
  remainder = mod $n 2
  if $remainder == 0 then ...

  total = count $candidates
  if $n_reachable == $total then ...
  ```

  Pipelines DO compose freely in object-literal value positions (REQ-011 ac4: "Values are any expression" — `rhsExpr` accepts pipelines directly), in assignment RHS (`x = count $list`), and as `if`/`while` conditions when the pipeline result is itself truthy. The restriction is specifically on comparison-operator operands.
- **Boolean combinators.** `&&`, `||`, `!`. `&&` and `||` short-circuit and return strict booleans (`1 && 2` yields `true`, not `2`; `0 || "fallback"` yields `true`, not `"fallback"`).
- **Range.** `1..5` — iterates [1, 2, 3, 4]. **End-exclusive.** `range N` builtin produces [0, 1, ..., N-1].
- **Tool call (expression position).** `<server>.<tool>({ <args> })` — same as statement form; the return value is the expression's value.
- **Introspection call.** `<server>._exists()` or `$server_name._exists()` — engine-resolved probe. See §5 below.

### 1.3 Reserved keywords

These cannot be used as variable names. Assignment to a reserved keyword raises `parse_error / reserved_keyword_assignment`:

```
for, in, do, done, if, then, else, fi, while, continue, break, null, true, false
```

**Identifiers that BEGIN with these prefixes are fine**: `forecast`, `truthy_check`, `donefile`, `iffy` all lex as bare identifiers per the `longer_alt: Identifier` rule on the keyword tokens.

**Reserved keywords cannot be used as BARE object-literal keys either.** Object-entry grammar accepts `Identifier | DoubleQuotedString | SingleQuotedString` for the key position. Since reserved keywords lex as their dedicated tokens (not `Identifier`), writing `{ done: $list }` fails with `parse_error / unexpected_token` near `done`. Quote the key — `{ "done": $list }` — or use a non-reserved name — `{ completed: $list }`. This is a common authoring pitfall when the natural English name for a field happens to be a keyword (`done`, `true`, `else`, etc.).

### 1.4 Builtin names

These cannot be shadowed by variable assignment. Assignment to a builtin name raises `parse_error / builtin_name_shadowing`:

```
echo, status, task_id, list_tasks, count, unique, append, concat,
add, sub, mul, div, mod, sleep, slow_op, fail, exit, input_var, range,
grep, find, sed, cat, wc, head, tail, ls
```

When generating macros, prefer non-conflicting names: `phase` instead of `status`, `result_value` instead of `exit`, `summary` instead of `status`.

**Common trap — `count` as a loop variable or input_var binding.** Three natural-English uses of `count` all trigger `builtin_name_shadowing`:

```
count = 0                              # WRONG — count is a builtin
for i in $items do count = add $count 1 done   # WRONG — same
count = input_var "count"              # WRONG — input_var binding to builtin name
```

The fix is to rename the variable (use `n`, `total`, `cnt`, `n_items`, etc.) while keeping any string keys (like `input_var "count"`) intact. Other commonly-natural names that hit the trap: `status`, `exit`, `range`, `concat`, `append`. Confirmed via the autonomous histogram run on 2026-05-19 — `count` shadowing recurred multiple times across loop accumulator and input_var scenarios.

**Common trap — `do` as a tool name.** When designing broker scenarios, the natural English `svc.do(...)` is a parse error because `do` is the for/while loop keyword (lexes as `Do` token, not `Identifier`). Rename to `perform`, `run`, `execute`, etc. Confirmed via the autonomous run.

**Original input_var-binding trap:** The natural temptation when reading `input_var "count"` is to bind the result to a variable also named `count`. **This is a parse error** because `count` is a builtin. The fix is to rename the VARIABLE while keeping the input_var KEY string unchanged:

```
# WRONG — count is a builtin, can't be a variable name
count = input_var "count"

# CORRECT — rename the variable, keep the key string
n_items = input_var "count"
total = input_var "count"
```

This trap occurs more often with input_var bindings than with regular assignments because the input_var key string is fixed by the caller's contract — the author has less freedom to rename it. Renaming only the LHS variable resolves the conflict. The builtins most commonly hit by this pattern are `count`, `status`, `exit`, `range`, `concat`, and `append` — any of these as natural-language data names need a renamed LHS binding.

### 1.5 Flag argument syntax

Some builtins (`input_var`, `status`, `needs_user_input`-shape patterns via fq tools) accept flag-style args. The grammar accepts `--flag value` (space-separated). The `--flag=value` form is **not** in the grammar.

```
# correct
val = input_var "key" --default 5

# WRONG (does not parse)
val = input_var "key" --default=5
```

---

## 2. Truthiness and equality (REQ-022)

**Falsy values:** `null`, `0`, `0.0`, `""`, `[]`, `{}`, `false`.

**Truthy values:** everything else, including:
- Non-empty strings — even `"false"` (the string) and `"0"` (the string) are truthy.
- Non-zero numbers, positive or negative.
- Non-empty lists / objects.
- Booleans from comparison operators (`true` from `5 == 5`).

**Equality.** `==` is strict — no implicit type coercion. `"5" == 5` is `false`. `true == 1` is `false`.

---

## 3. Scope rules

### 3.1 Walk-up assignment (REQ-019 ac1)

`name = expr` looks up the scope chain. If `name` exists in any ancestor scope, the assignment updates that binding. Otherwise, it creates a new binding in the current scope.

This is bash-style behavior. It's what makes counter-mutation in loop bodies work:

```
total = 0
for x in [1, 2, 3] do
  total = add $total $x
done
# total is now 6
```

### 3.2 `if` / `else` do NOT create a new scope (REQ-112b)

A new variable assigned inside an `if` / `else` body persists after `fi`:

```
flag = 1
if $flag == 1 then
  result = "yes"   # new binding in the enclosing scope
fi
# $result is "yes" here — REQ-112b
```

If the branch that defines a name doesn't run, the name is **undefined** after `fi` — reading it raises `Unknown variable: $name`. No phantom default.

### 3.3 For-loop iterator variable is strictly local (REQ-020)

```
x = "outer"
for x in [1, 2, 3] do
  echo $x
done
# $x is STILL "outer" — the loop's x was a separate binding
```

### 3.4 For-loop and while-loop bodies DO create a new scope

NEW variables (not previously declared at outer scope) assigned inside a `for` or `while` body do NOT leak to the enclosing scope. Walk-up assignment to outer-declared variables still works.

```
for i in [1, 2, 3] do
  loop_local = $i        # local to this iteration
  outer_counter = add $outer_counter 1  # walk-up if outer_counter exists outside
done
# $loop_local is undefined here
```

### 3.5 Macro frames are isolated (REQ-027)

A macro invoked via `fq.call_macro` runs in an isolated invocation. Its variables, task registry, and budget are scoped to the invocation; cross-invocation leakage does not occur.

---

## 4. Field access (REQ-023 + REQ-112d)

### 4.1 Leaf access on present object — missing key returns null (REQ-112d)

```
obj = { a: 1 }
v = $obj.does_not_exist
# v is null — REQ-112d lenient leaf-access
```

This composes with truthiness for guard patterns:

```
if $_self.frontmatter.optional_field == null then
  default = "fallback"
fi
```

### 4.2 Chained access through null still throws (REQ-023 ac2)

```
obj = { a: 1 }
v = $obj.missing.subfield   # raises: chain hits null at .missing, then .subfield on null
```

This preserves typo-protection. `$obj.usre.id` (misspelled `user`) still throws because the chain steps through `null`.

### 4.3 Field access on null / non-object / list with non-integer key (REQ-023 ac2-4)

All throw runtime errors:

```
obj = null
v = $obj.x          # runtime error

obj = 42
v = $obj.x          # runtime error

obj = [1, 2, 3]
v = $obj.name       # runtime error — list indexing by string is not supported
```

---

## 5. Introspection: `_exists()` and the leading-underscore convention (REQ-045 + REQ-112a)

### 5.1 Basic form

`<server>._exists()` — engine-resolved probe. Returns `true` if the server is reachable, `false` otherwise. For `fq`, always returns `true`.

For brokered servers, the probe goes through `broker.isConnected(serverId, { deepProbe: true, timeoutMs: 250 })`. A slow-or-down server is treated identically to a missing server — both return `false`.

### 5.2 Usable in any expression position

`_exists()` calls work anywhere a value is expected — assignment RHS, `if` condition, `&&` / `||` operands, after `!`, builtin args:

```
if svc._exists() then ...           # in if-condition
e = svc._exists()                   # in assignment
guard = svc._exists() && 1 == 1    # in && operand
if ! svc._exists() then fail ... fi # after !
```

### 5.3 Variable-ref server slot (REQ-112a)

For dynamic dispatch on a server name held in a variable:

```
target_server = $_self.frontmatter.target_server   # e.g., "basic"
ok = $target_server._exists()                       # probes the server named "basic"
```

**Restriction:** VarRef-subject (`$x.something()`) is allowed ONLY for introspection methods (tool name starts with `_`). `$x.real_tool({...})` is rejected at parse time. Tool dispatch on a variable-stored server name is out of scope.

### 5.4 Leading-underscore methods are engine-resolved

`_exists()` is the only one shipped in v3.5. The convention `_<name>()` is reserved for future introspection methods (`_list_tools()`, `_capabilities()`, `_version()`).

---

## 6. `_self` binding (REQ-103)

When a macro is loaded via `source_ref` (from a vault document), the engine binds `_self` to a snapshot of the source document at macro start:

- `_self.path` — string, the document's path.
- `_self.title` — string.
- `_self.frontmatter.*` — read-only snapshot of the frontmatter.
- `_self.tags` — list of tag strings.
- `_self.fq_id` — immutable identifier.

**Snapshot semantics.** `_self` is captured ONCE at macro start. It does NOT auto-refresh. A macro that needs latest persisted state mid-run must call `fq.get_document({ identifiers: $_self.path })`. (`_self` is a variable binding — always read it with the `$` sigil, e.g. `$_self.path`, per the §1.2 variable-read grammar.)

**Inline source case.** When a macro is invoked via `fq.call_macro` with inline source (no `source_ref`), `_self` is undefined. Accessing `_self.*` raises a runtime error: `"_self is only available when the macro was loaded via source_ref."`

**Read-only.** Assigning to `_self.*` is a PARSE-TIME error. To mutate the document, call `fq.write_document({ mode: "update", identifier: $_self.path, frontmatter: {...} })`.

---

## 7. Brokered tool dispatch (REQ-106 / REQ-107 / REQ-108)

### 7.1 Coercion of `CallToolResult` (REQ-106)

When a macro calls a brokered tool (`<server>.<tool>(args)`), the engine applies this coercion to the SDK's `CallToolResult` envelope BEFORE binding to the macro's value:

1. If `isError === true` → raise `fail` (do NOT bind a value — REQ-107 fail-fast).
2. Else if `structuredContent` is present → bind `structuredContent` as the value.
3. Else if `content[0].type === 'text'` and the text parses as JSON → bind the parsed value.
4. Else if `content[0].type === 'text'` → bind the raw string.
5. Else → bind the full `CallToolResult` (rare; multimodal).

### 7.2 Fail-fast on errors (REQ-107)

`isError: true` from a brokered tool → macro halts with `tool_call_failed`. A thrown error from the tool → same. The macro does NOT continue with a bound error value.

### 7.3 Argument passthrough (REQ-108)

Arguments to brokered tools pass through bit-exact. JS-native types (string, number, boolean, null, list, object) reach the broker unchanged. No engine-side coercion (`"42"` does NOT become `42`).

---

## 8. Five termination paths (REQ-024 + REQ-105)

A macro ends in exactly one way:

1. **Fall-off-end.** Macro runs to completion without `exit` or `fail`. Result: `{ result: null, ... }`.
2. **`exit value`.** Halt with the value. Result: `{ result: <value>, ... }`.
3. **`fail "message"`.** Halt with `macro_aborted`. Result: `{ error: "macro_aborted", message, ... }`.
4. **Runtime error.** Engine hits an unexpected error or a tool throws / returns `isError: true`. Result: `{ error: "tool_call_failed" or similar, ... }`.
5. **`needs_user_input`.** Fifth termination (REQ-105). Two valid emitters per REQ-060: (a) FQ-native tools, (b) the broker layer on TOFU schema drift during a brokered dispatch. The macro engine catches the underlying error and produces a `reason: "needs_user_input"` envelope with the elicitation payload. Brokered tools cannot return a `needs_user_input` event in their result payload — that path is forbidden.

---

## 9. Common idioms (REQ-112-aware)

### 9.1 Optional-config default via null guard

```
configured_max = $_self.frontmatter.max_iterations
if $configured_max == null then
  configured_max = 100
fi
```

### 9.2 Boolean sentinel for loop early-exit

```
should_continue = true
for x in $items do
  if ! $should_continue then
    break
  fi
  if $x == "stop" then
    should_continue = false
    continue
  fi
  # ... process x ...
done
```

### 9.3 If-block assignment that persists

```
if $broker_reachable then
  status_marker = "online"
fi
# $status_marker is "online" or undefined here, depending on whether the branch ran
```

### 9.4 Dynamic server probe

```
target_server = $_self.frontmatter.target_server
if $target_server._exists() then
  result = $target_server.do_thing({ ... })
fi
```

### 9.5 Server-existence guard before dispatch

```
if ! basic._exists() then
  fail "basic broker is not reachable"
fi
v = basic.do_thing({ ... })
```

### 9.6 Walk-up counter in a loop

```
total = 0
for x in $items do
  total = add $total $x
done
exit { sum: $total }
```

### 9.7 Self-referential rundoc

```
exit { path: $_self.path, marker: $_self.frontmatter.marker, completed: $completed }
```

### 9.8 Surgical edits (bash verbs) vs. section / whole-document edits (`fq.*`)

**Granularity rule — pick the right tool for the precision you need.** Bash-style shell verbs (`sed`, `grep`, `head`, `tail`, ...) are the **surgical, line-level** mechanism — use them for "change these specific lines/values." The native `fq.*` document tools operate at **section or whole-document** granularity (`replace_doc_section` = one heading section; `insert_in_doc` = insert at an anchor; `write_document` = whole body/frontmatter). For precision INTO a document, reach for the shell verbs; for section/whole-doc moves, use `fq.*`.

**Mechanism — `sed` transforms text, it does not mutate the file.** FlashQuery's `sed` returns the transformed text; it does NOT edit in place (`sed -i` is forbidden, §10). A bare `sed "file" "s/a/b/"` statement computes a result and discards it — nothing changes. The surgical pattern is **read → `sed`-transform → write the result back**: `sed` does the precise edit; `get_document` / `write_document` are just the read and persist endpoints.

**Surgical body line/section edit (the canonical pattern):**
```
doc = fq.get_document({ identifiers: "Notes/config.md", include: ["body"] })   # body only — no frontmatter
new_body = echo $doc.body | sed "s/timeout: 30/timeout: 60/" | sed "s/retries: 2/retries: 5/"
fq.write_document({ mode: "update", identifier: "Notes/config.md", content: $new_body })
```
Reading via `get_document` `include: ["body"]` yields the body WITHOUT frontmatter, so writing `content` back is clean. `echo $var | sed ...` pipes the value through the transform — chain one `sed` per substitution (`grep` the same way to filter lines). The body field of the read result is `$doc.body`.

**Frontmatter / config values are NOT body text.** Set them directly — `write_document` update MERGES frontmatter (named fields overwritten, others preserved, `null` deletes a field):
```
fq.write_document({ mode: "update", identifier: "Specs/limits.md", frontmatter: { default_limit: 250 } })
```

**Whole-file `cat` variant.** `cat "file"` reads the RAW on-disk file (frontmatter + body). Use `cat | sed | write_document content` only for frontmatter-LESS files; otherwise the frontmatter text folds into the body. Prefer the `get_document` body-only form above.

---

## 10. Things the macro language does NOT have

Refuse to generate macros that require any of these:

- **Boolean coercion in tool args.** `{ help: true }` is a true boolean now (REQ-112c) — don't substitute integers. But comparison operators don't coerce: `"5" == 5` is `false`.
- **List indexing by integer position.** `$list[0]` is deferred. Iterate via `for` instead.
- **String concatenation operator.** Use string interpolation `"${a}${b}"`.
- **Anonymous functions / closures.** Not in the language.
- **try / catch.** Use error envelope inspection — when a tool returns an envelope with `error` and `isError: false`, the macro can read `.error` from the bound value.
- **Async / await keywords.** All execution is sequential; `sleep` / `slow_op` are the only async-ish primitives.
- **Imports / require.** Each macro is self-contained.
- **String case operators / regex literals.** Use `grep` / `sed` shell verbs for text manipulation.
- **`--flag=value` argument syntax.** Use `--flag value`.

If a description requires any of these, the generator should refuse with a clear "the macro language does not support X; consider doing Y instead" message rather than inventing syntax.

---

## 11. Test-pilot context (for `flashquery-macro-testgen` callers)

When this skill is invoked by `flashquery-macro-testgen`, the produced macro is consumed by the test framework. Relevant extra context:

- The framework can wire **brokered tools via the fake-broker archetype library** (`ReadOnlyTool`, `WriteTool`, `JSONTextTool`, `StructuredContentTool`, `IsErrorTool`, `ThrowingTool`, `ScriptedTool`, `LyingTool`, `SlowTool`, `MultimodalTool`, `NeedsInputViaTofuDrift`). The macro's `<server>.<tool>(...)` calls dispatch into these archetypes.
- The framework can populate a **vault fixture** via the YAML's `vault: { "/path": "content" }` map. Shell verbs (`cat`, `ls`, `grep`, etc.) resolve paths against this vault root. Path-jail enforcement is real.
- The framework can populate **`input_vars`** via the YAML's `input_vars: { key: value }` map. The macro's `input_var "key"` builtin reads from this.
- The framework can populate **`_self` binding** via the YAML's `self_binding: { path, frontmatter, title, tags, fq_id }`. The macro's `_self.*` reads from this.
- Native `fq` dispatch is **stubbed** in the in-process framework. The framework does not have real Supabase wiring. Calls to `fq.write_document`, `fq.get_document`, `fq.search_tools` etc. that need to actually persist or query should go through the directed/integration scenario layer, not the macro framework. Macros that exercise `fq.*` document mutation (`write_document`, `insert_in_doc`, `replace_doc_section`, `apply_tags`, `move_document`, `manage_directory`, etc.) are directed/integration-testable only, not golden-harness-testable. If the test needs to exercise a brokered-shape `fq.search_tools` envelope or document-mutation return envelope for branch logic, simulate it via a `JSONTextTool` or `StructuredContentTool` archetype.

When generating for the framework, the macro should ONLY use behaviors the framework can wire. If the description requires native `fq` dispatch that needs real Supabase, that's an algorithmic miss — the skill should flag it as such rather than generate an unrunnable macro.

### 11.1 Static pre-scan walks every tool reference (REQ-028)

**Critical rule for test-pilot generation.** Production's permission pre-scan walks the macro AST statically before any code runs. It enumerates every `<server>.<tool>(...)` dispatch reference, INCLUDING references inside if-branches and loop bodies that may never execute at runtime. Every referenced dispatch server MUST be present in the test's `tools:` registry, or pre-scan rejects the macro with `unknown_server` before evaluation starts.

**Implication.** When generating a macro that references multiple servers (e.g., a primary + backup failover pattern), the test pilot's `tools:` block MUST register ALL referenced servers — even ones the runtime path won't reach.

**Verification check (test-pilot mode).** Before passing a generated macro to the test wrapper, the verify workflow MUST extract every `<server>.<tool>(...)` dispatch reference from the macro source and compare against the `tool_surface` the caller declared (or the `tools:` block being built). Missing dispatch servers → algorithmic miss with `kind: "unregistered_tool_reference"` and `suggested_change: "register <server> in the tools: block, or restructure the macro to not reference it"`. Introspection calls (`<server>._exists()` and `$server_name._exists()`) are NOT part of the static permission pre-scan; they are runtime-resolved probes. Verify may still warn about an `_exists()` probe that cannot be exercised in a given test surface, but it must not classify that as a pre-scan miss.

### 11.2 FakeBroker conflates "registered" with "reachable"

**Framework limitation.** The in-process `FakeBroker` exposes `isConnected(serverId)` as `this.servers.has(serverId)` — i.e., a server is reachable iff it's registered. There is no current archetype that registers a server but makes `_exists()` return false.

**Implication.** Failover macros that branch on `if primary_srv._exists() then ... else backup_srv ...` cannot have their backup-path branch exercised at the framework layer. Both servers must be registered (so pre-scan passes), at which point both `_exists()` probes return `true` and the primary path always wins.

**Generation guidance.** When the description asks for "fall back if primary isn't reachable" semantics in a test-pilot context, generate the macro normally but flag this in the verify report as a `framework_limitation` warning. Suggest covering the backup path via a directed/integration scenario where real broker behavior can be staged, or document the limitation in the pilot's `description:` field.

**Future affordance.** A proposed `UnreachableTool` archetype (or an `is_connected: false` flag on existing archetypes) would close this gap. Until that ships, treat the failover-backup branch as test-pilot-untestable.

---

## 12. Native `fq.*` tool surface

Use this catalog for production/native FlashQuery calls. The macro-author generate and verify workflows must not invent native `fq.*` tool names or argument keys outside this list unless the caller explicitly supplies an additional `context.tool_surface`. Native `fq` is stubbed in the macro framework; these calls run in production / directed / integration contexts.

### 12.1 Read

```
doc = fq.get_document({
  identifiers: "Notes/project.md",          # string or [list]; UUID, vault path, or filename
  include: ["body", "frontmatter", "headings"],
  sections: ["Overview", "Risks"],          # optional; requires "body" in include
  occurrence: 1,                            # optional; which heading match
  include_nested: true,                     # optional; default true
  follow_ref: "supersedes"                  # optional; frontmatter dot-path resolved as identifier
})

hits = fq.search({
  query: "planning",                        # optional; empty query needs tags/path_filter/list_all
  mode: "mixed",                            # "filesystem" | "semantic" | "mixed"
  entity_types: ["documents", "memories"],
  tags: ["#draft"],
  tag_match: "any",                         # "any" | "all"
  limit: 10
})

tools = fq.search_tools({ query: "edit a section of a document" })
```

### 12.2 Whole-document write

```
fq.write_document({
  mode: "update",                           # "create" | "update"
  identifier: "Notes/project.md",           # update mode; create may use path
  path: "Notes/new-project.md",             # create mode
  title: "Project Plan",                    # optional
  content: "...full body...",               # optional
  frontmatter: { status: "review" },        # optional; FQ-managed fields rejected
  tags: ["planning"]                        # optional; REPLACES full tag list
})
```

Use `apply_tags` for additive/removal tag edits. `write_document.tags` is replacement semantics.

### 12.3 Section-targeted edits

```
fq.insert_in_doc({
  identifier: "Notes/project.md",
  position: "after_heading",                # top|bottom|end|after_heading|before_heading|end_of_section
  heading: "Risks",                         # required for *_heading / end_of_section
  content: "- New risk: vendor lock-in",
  occurrence: 1,                            # optional; 1-indexed
  include_nested: true,                     # optional; end_of_section only
  heading_match: "contains",                # "contains" | "exact"
  heading_level: 2                          # optional 1-6
})

fq.replace_doc_section({
  identifier: "Notes/project.md",
  heading: "Overview",
  content: "Rewritten overview body.",      # "" deletes the heading + section
  include_nested: true,
  heading_match: "exact",
  heading_level: 2,
  occurrence: 1
})
```

### 12.4 Tags / lifecycle / structure

```
fq.apply_tags({
  targets: [{ entity_type: "document", identifier: "Notes/project.md" }],
  add_tags: ["#reviewed"],
  remove_tags: ["#draft"]
})

fq.move_document({ identifier: "Notes/project.md", destination: "Archive/project.md" })
fq.copy_document({ identifier: "Notes/project.md", destination: "Notes/project-copy.md" })
fq.archive_document({ identifiers: ["Notes/project.md"] })
fq.remove_document({ identifiers: ["Notes/scratch.md"] })

fq.manage_directory({
  action: "rename",                         # create | remove | rename | move
  paths: ["Notes/Ideas"],
  destinations: ["Archive/Ideas"]           # for rename/move; positionally aligned
})
```

`apply_tags` requires at least one of `add_tags` or `remove_tags`. It does not accept a generic `tags` key.

### 12.5 Memory

```
fq.write_memory({
  mode: "create",                           # "create" | "update"
  content: "User prefers terse summaries.",
  memory_id: "...",                         # required when mode is "update"
  tags: ["preference"],                     # replacement list in update mode
  plugin_scope: "global",                   # create only; default "global"
  include: ["content", "tags_full"]
})

mem = fq.get_memory({ memory_ids: "<uuid>", include: ["content", "tags_full"] })
fq.archive_memory({ memory_ids: ["<uuid>"] })
```

### 12.6 Records

```
fq.write_record({
  mode: "create",                           # "create" | "update"  (no "upsert")
  plugin_id: "crm",
  plugin_instance: "work",                  # optional; omit for single-instance plugins
  table: "contacts",
  id: "<uuid>",                             # required when mode is "update"
  data: { name: "Ada" },                    # schema-validated fields
  include: ["data", "schema_metadata"]      # optional payload sections
})

rec  = fq.get_record({ plugin_id: "crm", table: "contacts", id: "<uuid>", include: ["data"] })
fq.archive_record({ targets: [{ plugin_id: "crm", table: "contacts", id: "<uuid>" }] })
recs = fq.search_records({
  plugin_id: "crm", table: "contacts",      # all optional
  filters: { status: "active" },            # field-equality filters (AND)
  query: "Ada",                             # text/semantic query (table-dependent)
  tag: "vip", taggable_tables_only: false,
  include: ["data"], limit: 10
})
```

**Return shape.** Record writes/reads return a record-identification block `{ id, plugin_id, table, created_at, updated_at }`. After a `create`, read the new record's UUID via `.id` (e.g. `new_id = $created.id`) — `create` does not take an `id` input but returns one.

### 12.7 Model and macro orchestration

```
reply = fq.call_model({
  resolver: "purpose",                      # model|purpose|list_models|list_purposes|search|help
  name: "draft-reviewer",
  messages: [{ role: "user", content: "Review this draft." }],
  parameters: {
    response_format: { type: "json_schema", schema: { ready: "boolean" } }
  }
})
```

`fq.call_macro` is host-controlled and not callable from inside macros.

### 12.8 Invariants and legacy surfaces

- **No recursion (INV-08).** `fq.call_macro(...)` exists as a tool but **must not be generated inside a macro body** — a macro cannot invoke `call_macro`. Macro composition is a host concern, not an in-macro one.
- **Avoid legacy / removed surfaces.** Do not generate these in new macros:
  - `insert_doc_link` — transitional, gated on `call_macro` parity (will be removed); prefer the section/link patterns above.
  - `create_document`, `update_document`, `save_memory`, `search_documents`, `create_directory` — **removed**; use the canonical replacements (`write_document`, `write_memory`, `search`, `manage_directory`) per the `tool-metadata.ts` legacy map.

### 12.9 Dry-run validation (engine-backed pre-check)

`call_macro` accepts a `dry_run: true` flag: `fq.call_macro({ source, input_vars, dry_run: true })`. The engine then **parses, preflights, validates the input-var contract, and runs the static permission pre-scan (REQ-028) WITHOUT executing any statement or dispatching any tool** — zero side effects. It returns `{ parsed_ok, input_var_contract, tool_references, server_references }`, or a `parse_error` / preflight / `unknown_server` / `unknown_tool` / `invalid_input` envelope on failure. This is the deterministic counterpart to the skill's static verify — use it to confirm a generated macro parses and is permitted to call exactly the tools it references before any live run. It does NOT catch runtime errors (null-chain field access, unknown-variable reads, a missing heading, a tool returning `isError`), and — like the pre-scan it shares — it does NOT cover `_exists()` introspection references (§11.1).
