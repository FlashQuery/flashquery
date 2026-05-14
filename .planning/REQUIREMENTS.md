# Requirements: FlashQuery Core — v3.4 macro-support

**Defined:** 2026-05-14  
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.  
**Source of truth:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Requirements.md`  
**Test plan:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/FlashQuery Macro Language Test Plan.md`  
**POC:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/Macro Language/macro-prototype/`

## v3.4 Requirements

### Source Resolution And Inputs

- [ ] **MACRO-SRC-01**: `call_macro` accepts the production request schema with `source`, `source_ref`, `input_vars`, `budget`, `dry_run`, `trace`, and `progress`.
- [ ] **MACRO-SRC-02**: `call_macro` validates exactly one non-empty macro source and returns canonical `invalid_input` details for invalid combinations.
- [ ] **MACRO-SRC-03**: `source_ref` resolves through the same document resolver used by FlashQuery document reads.
- [ ] **MACRO-SRC-04**: Archived macro-library documents resolve as `not_found` for `source_ref`.
- [ ] **MACRO-SRC-05**: Macro library docs support `fqm name=<identifier>` fenced blocks with structured parse failures for malformed attributes.
- [ ] **MACRO-SRC-06**: `source_ref::name` selects named macro blocks and returns the full named-block error matrix.
- [ ] **MACRO-SRC-07**: `input_var` declarations are collected before execution and missing required inputs are reported together.
- [ ] **MACRO-SRC-08**: `input_vars` support the v0 value domain, including `null` and default-literal semantics.

### Lexer And Parser

- [x] **MACRO-PARSE-01**: The lexer reserves the v0 keyword set and avoids prefix-token misclassification.
- [ ] **MACRO-PARSE-02**: Assignments to builtin names are rejected before execution.
- [x] **MACRO-PARSE-03**: Numeric, string, list, object, `null`, and comment grammar matches the v0 spec.
- [ ] **MACRO-PARSE-04**: Comparison operators parse and evaluate according to v0 semantics.
- [ ] **MACRO-PARSE-05**: Boolean combinators parse with short-circuit semantics.
- [ ] **MACRO-PARSE-06**: The `..` range operator and `range` builtin are parsed and represented correctly.
- [ ] **MACRO-PARSE-07**: `while $cond do ... done` parses and executes.
- [ ] **MACRO-PARSE-08**: `for X in $list do ... done` requires `do`.
- [ ] **MACRO-PARSE-09**: Namespaced JSON-arg tool calls parse as statement and expression forms.
- [x] **MACRO-PARSE-10**: Parse failures return structured `parse_error` envelopes with stable reasons, line numbers, and near tokens.

### Evaluator Semantics

- [ ] **MACRO-EVAL-01**: Variable assignment uses walk-up scope mutation.
- [ ] **MACRO-EVAL-02**: For-loop iterator variables remain local to each iteration.
- [ ] **MACRO-EVAL-03**: Truthiness rules are deterministic for strings, numbers, lists, objects, and `null`.
- [ ] **MACRO-EVAL-04**: Double-quoted string interpolation supports variable and chained field references.
- [ ] **MACRO-EVAL-05**: Chained field access traverses structured values and reports missing fields predictably.
- [ ] **MACRO-EVAL-06**: The four termination paths are implemented: fall-off success, `exit`, `fail`, and runtime error.
- [ ] **MACRO-EVAL-07**: Every invocation has isolated scope, trace, budget, task, and progress state.
- [ ] **MACRO-EVAL-08**: Assignment RHS evaluation completes before the target binding is mutated.

### Dispatch And Permissions

- [ ] **MACRO-DISP-01**: Namespaced macro tool calls dispatch through a `(server, tool)` registry.
- [ ] **MACRO-DISP-02**: Static permission pre-scan rejects denied or unknown tool references before side effects.
- [ ] **MACRO-DISP-03**: Dispatch-time permission backstop rejects references that bypass pre-scan.
- [ ] **MACRO-DISP-04**: `fq.call_macro` is universally unavailable from inside macros.
- [ ] **MACRO-DISP-05**: Template-masqueraded tools are universally unavailable from inside macros.
- [ ] **MACRO-DISP-06**: Delegated-emitted macros cannot call `fq.call_model`.
- [ ] **MACRO-DISP-07**: Caller identity is derived from existing FlashQuery call context.

### Builtins

- [ ] **MACRO-BI-01**: Data builtins `count`, `unique`, `append`, and `concat` match the spec and POC semantics.
- [ ] **MACRO-BI-02**: Arithmetic builtins `add`, `sub`, `mul`, `div`, and `mod` validate numeric inputs and return deterministic results.
- [ ] **MACRO-BI-03**: `fail` and `exit` halt execution with canonical envelopes.
- [ ] **MACRO-BI-04**: The runtime `input_var` builtin reads caller bindings and defaults consistently with pre-flight.
- [ ] **MACRO-BI-05**: `range` supports one-, two-, and three-argument forms including negative steps.
- [ ] **MACRO-BI-06**: `echo` and `status` write to distinct trace/progress channels.
- [ ] **MACRO-BI-07**: `task_id` and `list_tasks` expose only the current invocation/session scope.

### Shell, Vault Jail, And Introspection

- [ ] **MACRO-SHELL-01**: The v0 read-only shell whitelist includes `grep`, `find`, `sed`, `cat`, `wc`, `head`, `tail`, and `ls`.
- [ ] **MACRO-SHELL-02**: Shell path arguments are vault-jailed and escaping paths fail with `forbidden_path`.
- [ ] **MACRO-SHELL-03**: `sed -i`, `find -exec`, and `find -delete` are rejected before execution.
- [ ] **MACRO-SHELL-04**: Production shell execution does not mutate process-global cwd.
- [ ] **MACRO-SHELL-05**: `_exists()` returns native `fq` availability and brokered-server connectivity through the broker interface.

### Trace, Progress, Tasks, And Cancellation

- [x] **MACRO-OBS-01**: Trace steps are emitted as a flat ordered list with the specified kind/value shape.
- [ ] **MACRO-OBS-02**: Trace verbosity modes and per-value truncation are enforced.
- [ ] **MACRO-OBS-03**: Progress verbosity modes are enforced and degrade cleanly without a progress token.
- [ ] **MACRO-OBS-04**: The in-process task registry transitions `working` to terminal states and removes terminal records immediately.
- [ ] **MACRO-OBS-05**: Cooperative cancellation checks every required safe point.
- [ ] **MACRO-OBS-06**: Task visibility and cancellation are scoped to the active session.

### Response Envelopes

- [x] **MACRO-RESP-01**: Real-run success returns the canonical `MacroExecutionResult` payload.
- [x] **MACRO-RESP-02**: Dry-run returns `MacroDryRunResult` and never executes side-effecting tools.
- [x] **MACRO-RESP-03**: Macro error codes are exported and stable.
- [x] **MACRO-RESP-04**: Macro response helpers are additive exports in `response-formats.ts`.
- [ ] **MACRO-RESP-05**: `warnings[]` follows the shared XC-16 response convention.

### Concurrency, Budgets, And Integration

- [ ] **MACRO-INT-01**: Concurrent macro invocations across sessions do not leak state.
- [ ] **MACRO-INT-02**: Macro-executed writes inherit FlashQuery's existing write-lock table behavior.
- [x] **MACRO-INT-03**: `archive_document` acquires the standard document write lock.
- [ ] **MACRO-INT-04**: Budget enforcement covers total tokens, model calls, external tool calls, and timeout.
- [x] **MACRO-INT-05**: `call_macro` is registered in the MCP server and canonical tool metadata.
- [x] **MACRO-INT-06**: A `NullMcpBroker` integration shim ships for v0 broker readiness.
- [ ] **MACRO-INT-07**: `_meta.progressToken` is captured and used for progress emission.

## Future Requirements

### Macro Language v1+

- **MACRO-FUT-01**: Boolean literals.
- **MACRO-FUT-02**: List indexing and dotted field-set mutation.
- **MACRO-FUT-03**: `filter`, `map`, `reduce`, `sort`, lambdas, and richer data transforms.
- **MACRO-FUT-04**: `now()` and other intentionally non-deterministic helpers.
- **MACRO-FUT-05**: Try/catch syntax for tool-call failure handling.
- **MACRO-FUT-06**: Macro version declarations and compatibility negotiation.
- **MACRO-FUT-07**: Direct macro-to-macro nesting and tree-shaped trace envelopes.
- **MACRO-FUT-08**: Async `call_macro`, external MCP Tasks methods, durable task records, TTL/GC, and permissioned cancellation.
- **MACRO-FUT-09**: Macro masquerade as first-class MCP tools.
- **MACRO-FUT-10**: Result-payload truncation and trace redaction processors.

## Out of Scope

| Feature | Reason |
|---------|--------|
| MCP Broker Support implementation | Macro v0 ships the shim only; real broker transport/process management is a separate feature. |
| Real-LLM meta-skill scenario test | Useful slow-test follow-up, not required to ship macro engine v0. |
| Starter macro template package | Prototype examples are fixtures and references, not a packaged product surface. |
| Reader-writer-lock upgrade and per-document lock granularity | Broader FlashQuery concurrency improvements; macros inherit current tool-layer consistency. |
| `search_records` lock investigation | Separate correctness item discovered during research. |
| User-facing confirmation prompts and diff previews | Host product responsibility; macro engine provides dry-run and pre-scan hooks. |
| Operator-tunable internal engine limits as public contract | `timeout_ms` is the only author-facing hard limit in v0. |
| Engine-side metrics contract | Operational logging/metrics remain implementation details in v0. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| MACRO-RESP-01, MACRO-RESP-02, MACRO-RESP-03, MACRO-RESP-04, MACRO-OBS-01, MACRO-INT-03, MACRO-INT-05, MACRO-INT-06 | Phase 130 | Complete |
| MACRO-SRC-05, MACRO-SRC-06, MACRO-PARSE-01, MACRO-PARSE-02, MACRO-PARSE-03, MACRO-PARSE-04, MACRO-PARSE-05, MACRO-PARSE-06, MACRO-PARSE-07, MACRO-PARSE-08, MACRO-PARSE-09, MACRO-PARSE-10 | Phase 131 | Pending |
| MACRO-EVAL-01, MACRO-EVAL-02, MACRO-EVAL-03, MACRO-EVAL-04, MACRO-EVAL-05, MACRO-EVAL-06, MACRO-EVAL-07, MACRO-EVAL-08 | Phase 132 | Pending |
| MACRO-SRC-07, MACRO-SRC-08, MACRO-BI-01, MACRO-BI-02, MACRO-BI-03, MACRO-BI-04, MACRO-BI-05, MACRO-BI-06, MACRO-BI-07 | Phase 133 | Pending |
| MACRO-SHELL-01, MACRO-SHELL-02, MACRO-SHELL-03, MACRO-SHELL-04, MACRO-SHELL-05 | Phase 134 | Pending |
| MACRO-DISP-01, MACRO-DISP-02, MACRO-DISP-03, MACRO-DISP-04, MACRO-DISP-05, MACRO-DISP-06, MACRO-DISP-07 | Phase 135 | Pending |
| MACRO-OBS-04, MACRO-OBS-05, MACRO-OBS-06, MACRO-INT-01 | Phase 136 | Pending |
| MACRO-OBS-02, MACRO-OBS-03, MACRO-RESP-05, MACRO-INT-04, MACRO-INT-07 | Phase 137 | Pending |
| MACRO-SRC-01, MACRO-SRC-02, MACRO-SRC-03, MACRO-SRC-04, MACRO-INT-02 | Phase 138 | Pending |

**Coverage:**
- v3.4 requirements: 63 total
- Mapped to phases: 63
- Unmapped: 0

---
*Requirements defined: 2026-05-14*  
*Last updated: 2026-05-14 after starting v3.4 macro-support milestone*
