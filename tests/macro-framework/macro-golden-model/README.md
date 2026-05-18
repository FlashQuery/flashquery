---
fq_id: f5e4f331-0198-4231-adf9-174e01eb29de
fq_title: README
fq_created: '2026-05-06T04:25:14.757+00:00'
fq_status: active
fq_instance: work-center
fq_updated: '2026-05-18T18:35:01.237Z'
---
# FlashQuery Macro Language — Prototype (Executable Spec)

A standalone, runnable prototype of the FlashQuery macro language under research at
`Research/Macro Language Research/macro-language-for-flashquery-tool-composition.md`.

**As of 2026-05-12, this prototype is the executable spec.** Its grammar, dispatch,
and example macros are the canonical reference for what the production engine must
do. Any future spec drift updates the examples and tests here in lockstep, or gets
rejected.

The prototype is **not** connected to a real FlashQuery instance. It uses mock tools
registered under the `fq` namespace that print what they would have done. Its job
is to validate the paradigm end-to-end — surface syntax, parser, async evaluator
with cooperative cancellation, tool dispatch via a namespaced registry, the
model-call pattern (`fq.call_model({...})` — per the OQ #11 resolution, model calls inside macros are namespaced tool calls, not flag-style builtins), real shell-style verbs (grep/find/sed/cat/wc
backed by ShellJS), and the SEP-1686 task lifecycle — before committing to a real
FlashQuery-integrated build.

## What it demonstrates

- Parsing the resolved macro surface with Chevrotain:
  - **Shell-script layer** for control flow and builtins: `for ... done`,
    `if ... then ... else ... fi`, `$var` / `$obj.field` references with chained
    field access, `--flag value` and `-x` boolean flags, `|` pipes.
  - **Tool-call layer** for FlashQuery and brokered MCP tools: `namespace.tool({...JSON...})`.
    The JSON object inside the parens matches the tool's input schema verbatim.
  - List literals `[a, b, c]`, object literals `{ key: value, ... }`, and the
    `null` literal as first-class value expressions. Booleans (`true`/`false`)
    are deferred — `if` branches on truthiness of values; defaults use `null`.
- **Async tree-walking evaluator** with a sandboxed environment — only registered
  operators, mock tools, and registered MCP servers are accessible.
- **Namespaced tool dispatch** via a registry-keyed map (`{ fq: { tools: ... }, brave_search: { tools: ... }, web_fetch: { tools: ... } }`).
  FlashQuery is treated as an in-process "broker" of its own tools; brokered MCP
  servers slot into the same shape with transport-appropriate handlers — stdio
  for local subprocess servers, streamable HTTP for remote/hosted servers, or any
  other transport (see `Research/MCP-Broker-Support.md`). The macro engine does
  not depend on any particular transport; the broker layer encapsulates that
  detail.
- Sequential flow + variable bindings + loops + conditionals + shell-style walk-up
  scope mutation (so `i = add $i 1` inside a loop body counts correctly).
- The `fq.call_model({...})` model-call pattern (canned responses) — including `parameters.response_format` for structured output — feeding downstream `if` branching via `.field` access on structured returns. Per OQ #11 (2026-05-12), there are no separate `ask` / `ask_json` builtins; model calls are namespaced tool calls like every other FlashQuery MCP tool.
- The `unique` builtin for de-duplicating lists — the canonical use case is the
  `insert_doc_link` replacement macro (see `examples/08-insert-doc-link.fqm`).
- Real ShellJS-backed shell builtins with glob auto-expansion and pipe chaining.
- **SEP-1686-aligned task lifecycle**: every run creates a task in `working` state,
  transitions to `completed` / `failed` / `cancelled` per the spec. Cooperative
  cancellation is implemented and demonstrated end-to-end.
- **Progress reporting** via a `status` builtin (the macro-side surface for MCP's
  `notifications/progress`) plus auto-emission for for-loop iterations and model
  calls.

## Running it

From this folder:

```
npm install
```

### Run a built-in demo

```
npm run demo                # two inline example macros: archive-drafts + review-readiness
npm run demo:syntax-error   # deliberately malformed macro, demonstrates parser errors
npm run demo:cancel         # runs examples/07-cancellation.fqm and cancels it mid-execution
                            # demonstrates the SEP-1686 working→cancelled lifecycle transition
```

### Run your own macro file

```
npm run script -- examples/01-hello.fqm
npm run script -- examples/02-archive-drafts.fqm     # namespaced fq.* tool calls
npm run script -- examples/03-review-readiness.fqm   # fq.call_model with response_format + if branching
npm run script -- examples/04-shell-pipeline.fqm     # real grep/find/sed against sample-vault/Specs/
npm run script -- examples/05-counter.fqm            # iteration counters + math builtins
npm run script -- examples/06-status-and-tasks.fqm   # status + task_id + list_tasks
npm run script -- examples/07-cancellation.fqm       # the happy path of the cancel demo
npm run script -- examples/08-insert-doc-link.fqm    # insert_doc_link parity (unique + frontmatter update)
npm run script -- examples/09-research-pattern.fqm   # delegated-model research batch-fetch (brokered web tools)
npm run script -- examples/10-adaptive-research.fqm  # _exists() introspection + fallback
npm run script -- examples/11-fail-missing-server.fqm # fail() halts the macro with an error envelope
npm run script -- examples/12-exit-with-result.fqm   # exit() returns a structured value as the macro's result
npm run script -- examples/13-input-vars.fqm --input-vars '{"search_phrases":["AI safety","model alignment"]}'
                                                     # input_var builtin reads caller-supplied input_vars (OQ #23)
npm run script -- examples/14-recoverable-error.fqm  # recoverable expected errors via envelope inspection
npm run script -- examples/15-vault-jail.fqm         # vault-jail wrapper: valid paths, then a rejected escape (OQ #25)
npm run script -- examples/16-shell-verbs-extended.fqm # head/tail/ls — the three new whitelisted verbs (OQ #25)
npm run script -- examples/17-input-var-missing.fqm  # negative test: pre-flight rejects missing required inputs (OQ #23)
npm run script -- /path/to/your-own.fqm
```

(The `--` is npm's way of forwarding the rest of the command line as arguments
to the script.)

Or call `tsx` directly:

```
npx tsx src/run.ts examples/01-hello.fqm
```

Convention is `.fqm` (FlashQuery Macro), but the runner accepts any extension —
it just reads the file as text.

### Passing input variables

The runner accepts an optional `--input-vars '<JSON>'` flag that passes a
caller-supplied `input_vars` map through to the macro. Per OQ #23
(resolved 2026-05-12), the macro **declares each expected input
explicitly** via the `input_var "<key>" [--default <literal>]` builtin —
each line at the top of the macro is one input declaration. Together they
form the macro's input contract.

The engine pre-flight-validates the supplied `input_vars` against the
contract BEFORE any execution. If a required input is missing, the
runner emits the canonical `invalid_input` envelope listing ALL missing
keys at once (not just the first), and the macro body never runs.

```
npm run script -- examples/13-input-vars.fqm \
  --input-vars '{"search_phrases":["AI safety","model alignment"]}'
```

```fqm
# Required input — pre-flight fails if missing.
search_phrases = input_var "search_phrases"

# Optional inputs with literal defaults.
output_path    = input_var "output_path"    --default "Research/web-output.md"
hits_per_topic = input_var "hits_per_topic" --default 2
reviewer       = input_var "reviewer"       --default null   # null literal supported
```

The default-literal grammar accepts strings, numbers, `null`, list
literals (`[1, 2, 3]`), and object literals (`{ key: "value" }`). Boolean
defaults (`true`/`false`) are deferred per §5 of the research doc —
attempts to use one fail at parse time. Branch on `null` inside the macro
body if you need optional-with-no-default behavior.

See `examples/17-input-var-missing.fqm` for the pre-flight rejection envelope.

### Vault root and shell-verb jailing

The runner accepts an optional `--vault-root <path>` flag. Every shell-verb
path argument (`cat`, `grep`, `find`, `sed`, `wc`, `head`, `tail`, `ls`)
is rewritten through a jail wrapper (per OQ #25):

- Inside a macro, `/` means **vault root**, not host root. `ls /Macros`
  reads `<vault_root>/Macros/` on the host.
- Bare relative paths resolve to the vault root via ShellJS's cwd.
- `..` segments that escape the vault root cause the verb to fail with
  the canonical `forbidden_path` envelope. The macro halts.

The default `--vault-root` is `macro-prototype/sample-vault/` so the
sample-vault content can be used as the test root. Override for your
own tests: `npm run script -- macro.fqm --vault-root /path/to/vault`.

See `examples/15-vault-jail.fqm` for both halves of the contract.

## Available built-ins and mock tools

### Operators

- `echo a b c ...`     — print arguments separated by spaces to stdout (trace channel)
- `input_var "key" [--default <literal>]` — read a caller-supplied input from `input_vars` (per OQ #23). Each call declares one input in the macro's contract; pre-flight validates required keys before execution.
- `fail "msg"`         — deliberately abort the macro with a canonical error envelope; statements below `fail` do not run
- `exit value`         — deliberately halt the macro successfully with `value` as the structured `result` (any Value type — string, list, object, etc.). Zero-arg form returns `null`. Statements below `exit` do not run.
- `count $x`           — length of a list or string
- `unique $list`       — de-duplicate a list, preserving first-occurrence order
- `append $list $item` — append an item to a list (returns new list; non-mutating)
- `add 1 2 3`          — sum of numbers
- `sub 10 3`           — subtract (10 - 3 = 7)
- `mul 4 5`            — multiply
- `div 17 5`           — integer divide (3)
- `mod 17 5`           — modulo (2)
- `concat "a" "b"`     — concatenate strings, or concatenate lists
- `sleep 500`          — cancel-aware async sleep, ms
- `slow_op 800 "label"` — simulates a long-running tool call; cancel-aware

### Status, progress, and task introspection

These map to the SEP-1686 task lifecycle and MCP's `notifications/progress`
mechanism. In this standalone prototype, `status` writes to stderr with a
`[STATUS]` prefix and updates the in-memory task registry. In production, it
would emit a `notifications/progress` JSON-RPC message on the MCP channel.

- `status "message"` — emit a status update with just a message
- `status --progress N --total M "message"` — emit numeric progress with optional message
- `task_id` — returns the current task's UUID (so a macro can log/correlate)
- `list_tasks` — render the task registry to stdout and return the list as a value

### Shell-style builtins (backed by ShellJS)

Per OQ #25 (resolved 2026-05-12), the v0 whitelist is **8 read-only verbs**.
All filesystem mutation goes through the FlashQuery tool layer (`fq.*`).

- `grep [-i] [-v] [-c] [-l] [-n] PATTERN file_or_glob...` — returns matching lines
  - In a pipeline: `cat "*.md" | grep "TODO"`
- `find PATH [--name "*.md"] [--type f|d]` — returns list of paths
- `sed "s/OLD/NEW/[gim]" file_or_glob...` — text substitution (returns rewritten text; never mutates files)
  - In a pipeline: `cat "x.md" | sed "s/foo/bar/g"`
- `cat file_or_glob...` — concatenate file contents (or pass through stdin in a pipe)
- `wc [-l] [-w] [-c] file_or_glob...` — count lines, words, or chars (default lines)
- `head [-n N] file_or_glob...` — first N lines (default 10); also pipeline-friendly
- `tail [-n N] file_or_glob...` — last N lines (default 10); also pipeline-friendly
- `ls [-A] [-d] [-l] [-R] [path_or_glob...]` — directory listing; `-l` returns objects with `{name, size, mtime}`

Bundled short flags work like Bash: `grep -iv "todo"` is the same as
`grep -i -v "todo"`. Long flags take a value: `find . --name "*.md"`.

#### Vault-jail wrapper

Every path argument (per OQ #25) is rewritten through a single wrapper
before ShellJS sees it. Inside a macro, `/` means **vault root** and
escape attempts (`..`-traversal that resolves outside the vault root) are
refused with the canonical `forbidden_path` envelope. The wrapper also
sets ShellJS's cwd to the vault root at the start of each shell-verb call
so bare relative paths resolve there. The runner accepts `--vault-root
<path>` to point the wrapper at a host directory (default: `sample-vault/`).

#### Flag-level rejections

Three flags are refused at pre-scan time with `forbidden_shell_flag`:

- `sed -i`     — in-place file modification
- `find -exec` — arbitrary command execution
- `find -delete` — file mutation via find

The pre-scan walks the AST before any execution begins, so a rejected
flag halts the macro before any side effects.

### Pipes

Use `|` to thread the output of one stage into the next as implicit stdin:

```bash
todo_count = cat "tmp/specs/*.md" | grep "TODO" | wc -l
echo "TODOs found: $todo_count"
```

Each pipeline stage's output value is passed as `stdin` to the next stage.
For shell builtins, "stdin" is normally a list of lines or a string.

### Glob expansion

String args in file positions are auto-expanded against cwd:

- `*.md` → matches every `.md` file
- `tmp/specs/*.md` → matches files under `tmp/specs/`
- `**/*.md` → recursive
- `?` → single character
- `[abc]`, `{a,b}` → character / brace classes

A glob that matches nothing throws an error (rather than silently passing the
literal pattern through), which keeps model-authored macros failing loudly
rather than silently mis-running.

### FlashQuery MCP tools (namespaced, JSON-arg form)

These live in the `fq` namespace and are invoked with the namespaced JSON-arg
form `fq.tool_name({...})`. The mock implementations live in `src/mockfq.ts`;
they log what they would have done and return canned values that mirror the
consolidation doc's identification-block shapes.

- `fq.search({ query, entity_types?, tags?, ... })` — returns a canned 3-doc list
- `fq.get_document({ identifiers, include? })` — returns a single canned doc, or
  a `{ error: "not_found", ... }` envelope when nothing matches
- `fq.write_document({ mode: "create" | "update", path?, title?, identifier?, content?, frontmatter?, tags? })`
- `fq.move_document({ identifier, destination_path })`
- `fq.apply_tags({ targets, tags })`
- `fq.archive_document({ identifiers })`
- `fq.manage_directory({ action: "create" | "remove", paths })`
- `fq.insert_in_doc({ identifier, position, content, heading?, ... })`

The same registry shape will host external brokered MCP servers (e.g.,
`brave_search.web_search({...})`) when the broker feature ships
(`Research/MCP-Broker-Support.md`). The macro engine doesn't change.

### Brokered MCP tools (namespaced, mocked)

These mock external MCP servers that would be brokered into the macro engine
via the MCP Broker feature (`Research/MCP-Broker-Support.md`). They use the
same `namespace.tool({...})` form as `fq.*` tools — the macro engine doesn't
distinguish native FlashQuery tools from brokered ones. Transport choice
(stdio for local subprocesses, streamable HTTP for hosted services) is
encapsulated in the broker layer; the prototype's mock handlers are
in-process functions returning canned values.

- `brave_search.web_search({ query, count? })` — returns an array of canned
  search hits `[{ url, title, description }, ...]`
- `web_fetch.fetch({ url })` — returns a canned page record
  `{ url, status, content, content_type, fetched_at }`, or a `{ error: "not_found", ... }`
  envelope for URLs without canned content

See `examples/09-research-pattern.fqm` for the canonical batch-fetch
pattern that motivates these mocks.

### Namespace introspection methods

Engine-resolved (not dispatched to the broker). Marked by a leading
underscore so they're visually distinct from real tool calls.

- `<server>._exists()` — `true` if the server entry is in the registry and
  (in production) the broker reports its connection as alive. For native
  `fq` it's trivially `true`. Designed to support the guard pattern
  (`if ! brave_search._exists() then fail "..." fi`) and adaptive
  fallback (`if brave_search._exists() then ... else fq.search(...) fi`).

Future siblings designed for, not yet shipped: `_list_tools()`,
`_capabilities()`, `_version()`. They'd all be engine-resolved on the
same leading-underscore convention.

### Model calls (via fq.call_model, mocked)

**Per the OQ #11 resolution (2026-05-12), there are no separate `ask`/`ask_json`
builtins.** Model calls inside macros use `fq.call_model({...})` directly —
the canonical FlashQuery MCP tool call form. The mock in `src/mockfq.ts`
supports all six of the real `call_model` resolvers:

- `fq.call_model({ resolver: "model", name: "haiku", messages: [...] })` —
  direct model invocation; returns canned response with `content`,
  `model_used`, `usage`
- `fq.call_model({ resolver: "purpose", name: "draft-reviewer", messages: [...] })` —
  purpose-based invocation; same response shape
- `fq.call_model({ resolver: "list_models" })` — returns the configured
  models (canned: haiku + opus); no LLM call
- `fq.call_model({ resolver: "list_purposes" })` — returns configured
  purposes (canned: summarizer, draft-reviewer, spec-synthesizer); no LLM call
- `fq.call_model({ resolver: "search", parameters: { query: "..." } })` —
  search models/purposes by name/description; no LLM call
- `fq.call_model({ resolver: "help" })` — help text; no LLM call

For structured output (the old `ask_json` use case), pass
`parameters.response_format`:

```fqm
verdict = fq.call_model({
  resolver: "purpose",
  name: "draft-reviewer",
  messages: [{ role: "user", content: "Is this ready? $doc.fq_id" }],
  parameters: { response_format: { type: "json_schema", schema: { "ready": "boolean", "reason": "string" } } }
})

if $verdict.ready then ...
```

The mock returns canned structured data when it sees a `response_format`
request — `ready: true` for inputs not mentioning `doc_b`, `ready: false`
otherwise. This is the same behavior the old `ask_json` mock had; only the
calling shape changed.

## Task lifecycle (v0 — in-process registry)

Every macro run creates a task record in the in-memory registry. The task
starts in state `working` and transitions to one of the terminal states
`completed` / `failed` / `cancelled`. Per the OQ #21 resolution (2026-05-12),
v0 ships sync-only with an in-process registry as scaffolding for future
async; the registry does *not* adopt SEP-1686's external protocol surface
(no `tasks/get` / `tasks/result` / `tasks/list` / `tasks/cancel` MCP methods,
no `task` parameter on `call_macro`'s request schema, no `input_required`
state, no `unknown` fallback, no TTL). State names match SEP-1686 vocabulary
so the registry can grow into the protocol surface later without re-deriving
the state machine — but everything external waits for the MCP Tasks spec to
stabilize.

The cancel demo exercises the `working → cancelled` transition end-to-end:

```
npm run demo:cancel
```

This runs `examples/07-cancellation.fqm` (a macro with four `slow_op` stages)
and schedules `taskRegistry.cancel()` after 500ms. The evaluator's cooperative
cancellation check fires at the next safe point (the next 100ms chunk inside
the active `slow_op`'s sleep), throws `MacroCancellationError`, and the task
transitions to terminal `cancelled` with the correct timestamps.

Cooperative cancellation safe points: between top-level statements, before
each statement, at the start of each for-loop iteration, between pipeline
stages, before each call dispatch, and inside `sleep`/`slow_op` between
chunks. Long-running tools should follow the `sleep` pattern (wake every
100ms, check the task status, throw if cancelled).

## File layout

- `src/lexer.ts` — Chevrotain token definitions.
- `src/parser.ts` — Chevrotain CST parser + AST conversion.
- `src/evaluator.ts` — Async tree-walking interpreter with cooperative cancellation checks; namespaced tool-call dispatch through a registry.
- `src/builtins.ts` — Builtins (`input_var`, `echo`, `count`, `unique`, `append`, `add`, `sub`, `mul`, `div`, `mod`, `concat`, `sleep`, `slow_op`, `fail`, `exit`), status + task introspection (`status`, `task_id`, `list_tasks`). Model calls are NOT builtins — per OQ #11 (2026-05-12), they're invoked via `fq.call_model({...})` and the mock lives in `mockfq.ts`.
- `src/mockfq.ts` — Mock FlashQuery MCP tool registry (the `fq` server entry: `search`, `get_document`, `write_document`, `move_document`, `apply_tags`, `archive_document`, `manage_directory`, `insert_in_doc`). Also exports `defaultToolRegistry` which composes `fq` with the brokered server mocks below.
- `src/mockbrokers.ts` — Mock brokered MCP server entries (`brave_search` and `web_fetch`). Demonstrate that the namespaced-dispatch model supports first-class tool calls into external MCP servers alongside `fq` — same `ServerEntry` shape, just with handlers that would talk to a brokered server in production (stdio, streamable HTTP, or any other transport).
- `sample-vault/` — Canonical convention-reference artifacts (markdown only; not executed by the runner). Demonstrates the self-describing macro doc convention (`Macros/research-batch.md`), the three skill-embedding patterns (three sample skills in `Sample-Skills/`), and the meta-skill that teaches macro conventions to LLMs (`Meta/Skills/using-macros-in-skills.md`). See `sample-vault/README.md` for the layout.
- `src/shellbuiltins.ts` — ShellJS-backed shell builtins (`grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, `ls`). Vault-jail and flag-rejections are enforced; path arguments go through `src/pathwrapper.ts` before ShellJS sees them.
- `src/pathwrapper.ts` — Vault-jail wrapper. `resolveMacroPath(macroPath, vaultRoot)` strips a leading `/`, joins onto the configured vault root, normalizes, and verifies containment. Throws `ForbiddenPathError` for paths that escape.
- `src/taskregistry.ts` — In-memory task registry for the v0 in-process lifecycle (`taskId`, `status`, `createdAt`, `lastUpdatedAt`, `statusMessage`, `progress`, `trace`). State names match SEP-1686 vocabulary; the external protocol surface is deferred.
- `src/types.ts` — AST, `Value`, and `BuiltinFn` (which now allows `Value | Promise<Value>`).
- `src/run.ts` — CLI runner: takes a file path, parses, evaluates, manages task lifecycle.
- `src/demo.ts` — Two sample macros run inline (archive-drafts + review-readiness).
- `src/demo-syntax-error.ts` — Deliberately malformed macro to demo parser error reporting.
- `src/demo-cancel.ts` — Runs the cancellation example and schedules a cancel mid-execution.
- `examples/*.fqm` — 17 sample macro files you can run via `npm run script -- examples/...`. Examples 13 and 17 exercise the `input_var` contract; examples 15 and 16 exercise the vault-jail wrapper and the three new shell verbs.
- `sample-vault/Specs/*.md` — Sample data for `examples/04-shell-pipeline.fqm` (vault-rooted; jailed under the configured vault root).

## Surface syntax (one-page version)

The macro language has **two consistent layers** plus value literals:

```bash
# Comment.
# Variables: assign with =, reference with $name. Spaces around = are allowed
# (this is a deliberate divergence from real Bash, for readability).

# ----- Tool-call layer -----
# FlashQuery (and brokered) MCP tools use the namespaced JSON-arg form.
# The JSON inside the parens matches the tool's input schema verbatim.
fq.manage_directory({ action: "create", paths: ["Q3-2026"] })
drafts = fq.search({ query: "tag:#draft" })

# For loop. No ;do — newline is enough. End with done.
for d in $drafts
  fq.move_document({ identifier: $d.fq_id, destination_path: "Q3-2026/" })
  fq.apply_tags({ targets: [{ entity_type: "document", identifier: $d.fq_id }], tags: ["#archived"] })
done

# ----- Shell-script layer (builtins, control flow, values) -----
# Builtins use flag/positional style, just like shell commands.
total = count $drafts
echo "moved $total drafts"

# If statement. then introduces the body, fi closes it.
verdict = fq.call_model({
  resolver: "purpose",
  name: "draft-reviewer",
  messages: [{ role: "user", content: "is this draft ready? $d.fq_id" }],
  parameters: { response_format: { type: "json_schema", schema: { "ready": "boolean" } } }
})
if $verdict.ready then
  fq.move_document({ identifier: $d.fq_id, destination_path: "Review/" })
else
  echo "not ready"
fi

# Strings:
# - "double quoted" — supports $var and $var.field interpolation
# - 'single quoted' — literal, no interpolation
# Note: $(...) command substitution is NOT supported. Bind to a variable:
total = count $drafts
echo "moved $total drafts"

# Lists and objects as first-class values:
priorities = ["high", "medium", "low"]
config = { mode: "update", tags: ["planning"] }

# Field access on structured returns (chained access supported):
related = $source_doc.frontmatter.related_to
links = unique (append $related $new_id)

# Shell-style pipelines for text/list manipulation:
todos = cat *.md | grep "TODO" | wc -l
echo "found $todos todos"
```

**Visual rule for the AI/human reader:** if you see `name1.name2(`, it's a
registered tool call carrying a JSON arg matching that tool's schema. Otherwise
it's a builtin, control-flow keyword, or value expression — all shell-style.

(That single rule covers every example in `examples/` — start with
`01-hello.fqm` for the bare basics, `02-archive-drafts.fqm` for the canonical
namespaced tool-call pattern, `05-counter.fqm` for the scope-mutation trick.)

## Output streams (stdout vs. stderr)

Two channels, kept deliberately separate so the trace stays clean:

- **stdout** — the trace/result channel. `echo`, `[mock]` tool-call traces,
  and `list_tasks` rendering go here.
- **stderr** — the liveness channel. `[STATUS]` lines from explicit `status`
  builtin calls, `[PROGRESS]` auto-emissions from for-loop iterations and
  model calls, and runner-level error reports go here.

In production, the stderr lines become `notifications/progress` MCP messages
to the calling client; the stdout content stays as the macro's trace and result.

## What the prototype does NOT do

- No real FlashQuery tool calls — `mock_*` tools just log what they would do.
- No real model API calls — `fq.call_model` is mocked and returns canned values.
- No real MCP integration — `call_macro` is not exposed over a transport;
  the runner invokes the engine directly and the cancel demo schedules
  cancellation via in-process `setTimeout` (the same mechanic production v0
  host code uses for timeouts and shutdown).
- No durable persistence — the task registry is in-memory and ephemeral. v0
  production also runs in-memory; durable storage is deferred until async
  ships and the MCP Tasks protocol surface stabilizes.
- No `input_required` state — async-only by construction; tied to MCP's
  elicitation work. Not in the v0 type model.
- No TTL / garbage collection — immediate cleanup on terminal state in
  production v0; the prototype keeps terminal records in the Map for demo
  inspection visibility (the cancel demo prints the final task record after
  it transitions to `cancelled`).
- Shell builtins (`grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, `ls`) DO
  read real files through ShellJS, with glob expansion, jailed under the
  configured `--vault-root` (default `sample-vault/`). They never mutate
  files — `sed -i`, `find -exec`, and `find -delete` are refused at
  pre-scan time, and the v0 whitelist contains no mutation verbs.
  Filesystem mutation goes through the FlashQuery tool layer in production.
