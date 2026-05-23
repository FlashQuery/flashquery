# FlashQuery Technical Debt Audit

**Role:** Bundled reference for the `flashquery-codebase-audit` skill — the
audit's method: the two-layer approach, the 19-category detection taxonomy, the
severity model, the workflow architecture, and FlashQuery-specific calibration.
The Review and Verify workflows lean on this document.
**Last updated:** 2026-05-23

---

## Contents

- Purpose
- What gets audited
- Guiding principles
- Methodology — the two layers
- Detection taxonomy — the 19 categories (A–S)
- Severity & prioritization model
- Finding confidence & accepted debt
- The mechanical toolkit
- The AI review layer — semantic checklist
- Report structure
- Skill workflow architecture
- Alignment with fq-devspec
- FlashQuery-specific calibration
- Relationship to other artifacts
- Open items / to expand
- External references used to extend this audit

---

## Purpose

Provide a systematic, repeatable way to sweep the FlashQuery codebase and surface
technical debt — code that is broken, rotting, risky, or simply in the way —
**before** new feature work builds on top of it.

The motivating case: a `catch` block that ran but never surfaced the error, so
failures happened invisibly for an unknown stretch of time. That bug is not a
style problem and would never be caught by as-you-go cleanup. It is exactly the
class of issue this audit exists to hunt down — and it raises the obvious
question of how many similar issues are sitting undiscovered.

This audit is **broad code-health** in scope. Correctness risks (swallowed
errors, untyped boundaries) are not a separate mode — they are one *category*
within the sweep, and the severity model floats them to the top of the report.

---

## What gets audited

The project is three repositories. They are not equal audit targets:

| Repo | What it is | Audit scope |
|---|---|---|
| `flashquery` | The product code — ~120 TypeScript files in `src/` (single npm package, no workspaces, Node/TS) plus ~290 TS files in `tests/` that are out of audit scope. Has `eslint.config.js`, `tsconfig.json`, `.prettierrc.json`, and `typecheck` / `lint` / `test` / `coverage` scripts. | **Primary target.** Full audit of `src/`. |
| `flashquery-plugins` | Plugin and skill definitions — no `.ts` application code; `apps/`, `core/`, `skills/`, `scripts/`. | **Light scope.** Audit any real code under `scripts/`; skill markdown is content, not code. |
| `flashquery-product` | Product docs and the FlashQuery pipeline (Captures, Roadmap, Research, etc.). No code. | **Out of code-audit scope.** Doc-rot is a separate, minor concern. |

So in practice "audit the entire codebase" means **audit the `flashquery` repo
thoroughly**, give `flashquery-plugins` scripts a light pass, and skip
`flashquery-product`.

The ~120-source-file size is small enough that reading every file is
technically possible but not yet *useful* — AI cost, focus discipline, and
signal-to-noise still favor mechanical-first triage followed by targeted
reading, which is what the two-layer methodology below codifies.

---

## Guiding principles

1. **Two layers — mechanical first, then targeted AI.** Deterministic tools
   build a complete inventory fast; AI review goes deep only where it pays off.
2. **Find what tools cannot.** A linter finds the *empty* catch. Only a reading
   finds the catch that logs to nowhere, swallows the error, and returns a
   plausible-looking default. The AI layer exists for exactly that gap.
3. **Every finding is actionable.** Location (`repo/path:line`), severity,
   estimated fix effort, and a concrete recommendation — never a vague "this
   could be better."
4. **Prioritize by risk.** Correctness and silent-failure issues outrank
   maintainability issues, which outrank cosmetic ones.
5. **Audit the tooling too.** If `tsconfig.json` is missing strict flags or
   ESLint lacks key rules, that is itself a finding — weak tooling is why debt
   accumulated unseen.
6. **Non-destructive.** The audit *reports*. It does not fix. Remediation is a
   separate, deliberate step so findings can be reviewed and prioritized first.
7. **Re-runnable and comparable.** The output is a dated snapshot; running it
   again later should produce a diffable picture of whether debt is growing or
   shrinking.

---

## Methodology — the two layers

### Layer 1 — Mechanical sweep

Run and parse deterministic tools across the repo to produce a structured
inventory. Fast, exhaustive, repeatable, no judgment required. Covers: type
errors, lint violations, dead code, unused dependencies, circular dependencies,
duplication, vulnerable packages, complexity metrics, and grep-able anti-pattern
counts. See *The mechanical toolkit* below.

### Layer 2 — Targeted AI review

The mechanical layer produces a ranked list of **hotspots** — files and modules
that score badly (high complexity, many escape hatches, many TODOs, dense error
handling, low/no test coverage, frequent churn). The AI layer reads:

- every hotspot the mechanical layer flags, plus
- a **risk-weighted sample** of the rest — prioritizing error-handling code,
  module boundaries, data-parsing code, MCP tool handlers, macro execution,
  plugin loading, LLM calls, embedding generation, redaction, authorization, and
  anything touching external systems.

This is where semantic judgment happens (see *The AI review layer* below).
Reading every file indiscriminately, even at ~120 sources, is neither
affordable nor useful; targeting the layer at mechanically-identified risk
is what makes the audit precise rather than just thorough.

---

## Detection taxonomy

The core of the audit. Each category lists what to look for, why it matters, and
how it is detected — `[tool]`, `[grep]`, or `[AI]`. The eventual skill should
implement a check for every item here.

### A. Error handling & failure surfacing — *highest priority*

- Empty `catch` blocks — error caught and discarded entirely. `[grep]` `[lint]`
- **Catch blocks that "handle" without surfacing** — log to a dropped channel,
  swallow and `return` a default, or continue silently. The motivating bug.
  `[AI]`
- `catch` blocks that assume the caught value is an `Error` (`e.message`) without
  narrowing — throws its own `TypeError` on non-Error throws. `[grep]` `[AI]`
- Over-broad catches that swallow programming bugs (`TypeError`,
  `ReferenceError`) alongside expected failures. `[AI]`
- Lost error cause — re-throwing a new error without `{ cause }`. `[AI]`
- `.catch(() => {})` / `.catch(noop)` on promises. `[grep]`
- Errors logged at the wrong level or to a sink nothing monitors. `[AI]`
- Missing error handling at external boundaries (network, DB, filesystem). `[AI]`

### B. Type-safety escape hatches

- Explicit `any` (annotations, casts, generics). `[grep]` `[lint]`
- Implicit `any` — only visible if `noImplicitAny` is on. `[tool]`
- Type assertions `as X`, and especially `as any` and `as unknown as X`. `[grep]`
- Non-null assertions `!`. `[grep]` `[lint]`
- `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`. `[grep]`
- `eslint-disable` directives — inventory and justify each. `[grep]`
- Untyped external data — `JSON.parse`, `fetch`/response bodies, `process.env`,
  file reads — used without schema validation. `[grep]` `[AI]`

### C. Async & concurrency

- Floating promises — async calls whose result/rejection is never awaited or
  handled. `[lint]` (`no-floating-promises`)
- Missing `await` (incl. `await` on non-promises). `[lint]`
- Unhandled promise rejections. `[AI]`
- Sequential `await` in loops where `Promise.all` is correct, or vice versa.
  `[AI]`
- Shared mutable state touched from concurrent paths — race conditions. `[AI]`

### D. Dead & unused code

- Unused exports / files imported by nothing. `[tool]` (knip)
- Unused dependencies and devDependencies. `[tool]` (knip / depcheck)
- Unreachable code. `[lint]`
- Unused variables, imports, parameters. `[lint]`
- Commented-out code blocks. `[grep]` `[AI]`
- Permanently-on or permanently-off feature flags / config branches. `[AI]`

### E. Dependencies & supply chain

- Known vulnerabilities. `[tool]` (`npm audit`)
- Outdated packages — note majors behind. `[tool]` (`npm outdated`)
- Duplicate / multiple versions of the same package. `[tool]`
- Deprecated packages. `[tool]`
- Heavyweight dependencies pulled in for trivial use. `[AI]`

### F. Test coverage & quality

- Files / modules / branches with no test coverage — especially error paths.
  `[tool]` (coverage report)
- Skipped or focused tests left in the tree — `.skip`, `.only`, `xit`. `[grep]`
- Commented-out or disabled tests. `[grep]` `[AI]`
- Critical paths (error handling, data validation, boundaries) with no test.
  `[AI]`
- Tests that assert nothing, or only that code ran without throwing — coverage
  with no real expectation. `[AI]`
- Over-mocking — tests that mock the very dependency they exist to exercise.
  **Integration tests must hit a real database, not mocks**; a mocked
  integration test is debt that looks like safety. `[AI]`
- Tests coupled to implementation detail rather than observable behavior — they
  break on safe refactors and discourage cleanup. `[AI]`
- Flaky / non-deterministic tests (time, ordering, network dependence). `[AI]`
- Cross-reference `COVERAGE.md` (the FlashQuery Core coverage matrix) — gaps
  there are first-class findings; the `flashquery-testgen` skill is the
  remediation route.

### G. Structure & architecture

- Circular dependencies between modules. `[tool]` (madge / dpdm)
- Barrel-file sprawl (`index.ts` re-exporting broadly) — cycle risk, build cost.
  `[grep]` `[AI]`
- "God" modules imported almost everywhere — change-amplifiers. `[tool]` `[AI]`
- Layer / boundary violations — dependencies flowing the wrong direction. `[AI]`
- Inconsistent module organization across the repo. `[AI]`

### H. Complexity & maintainability hotspots

- Oversized files and overlong functions. `[tool]`
- High cyclomatic complexity / deep nesting. `[tool]` (eslint `complexity`)
- Long parameter lists. `[lint]` `[AI]`
- Duplicated / copy-pasted blocks — especially copies that have since diverged.
  `[tool]` (jscpd) `[AI]`
- Magic numbers and magic strings. `[grep]` `[AI]`

### I. Configuration & build health

- `tsconfig.json` not strict, or missing recommended flags
  (`noUncheckedIndexedAccess`, `noUnusedLocals`, etc.) — checked against
  `typescript-standard.md`. `[AI]`
- ESLint config gaps — missing `recommended-type-checked` / key rules. `[AI]`
- Build / typecheck warnings that are tolerated rather than fixed. `[tool]`
- Configuration drift between repos. `[AI]`

### J. Documentation & comment rot

- `TODO` / `FIXME` / `HACK` / `XXX` — inventory, count, age via `git blame`.
  `[grep]`
- Comments that contradict or no longer match the code. `[AI]`
- Public APIs / exported functions with no doc comment. `[AI]`
- Stale READMEs / setup docs that no longer match reality. `[AI]`

### K. Security-adjacent hygiene

- Secrets or credentials committed to the repo. `[grep]` `[tool]`
- `.env` / `.env.test` present in the working tree — **verify they are
  git-ignored and untracked**, not committed. `[tool]`
- `eval`, `new Function`, dynamic `require`. `[grep]`
- Unvalidated input reaching sensitive sinks (queries, shell, filesystem). `[AI]`

### L. Observability & monitoring — *high priority*

- Important code paths with no logging or instrumentation — a failure there
  would be invisible, exactly as in the motivating catch-block bug. `[AI]`
- Errors routed to a sink nothing monitors or alerts on (overlaps Category A).
  `[AI]`
- Inconsistent or unstructured logging that cannot be reliably queried or
  alerted on. `[AI]`
- Error paths that should page or alert someone but do not. `[AI]`
- Log levels misused — real errors logged as `info`, noise logged as `error`.
  `[grep]` `[AI]`
- Debug logging left in production code paths. `[grep]`

### M. Resource & lifecycle management

- Database connections or clients opened but never closed, released, or pooled.
  `[AI]`
- File handles, streams, or sockets left open. `[AI]`
- Event listeners / subscriptions registered but never removed. `[grep]` `[AI]`
- `setTimeout` / `setInterval` that is never cleared. `[grep]` `[AI]`
- Unbounded caches or collections that grow without eviction — memory leaks.
  `[AI]`
- Missing cleanup in teardown / shutdown paths — no `finally`, no dispose hook.
  `[AI]`

### N. Performance & scalability debt

- Code that is functional but an obvious performance hit. `[AI]`
- Operations that scale badly with vault size (file count) or record count —
  `O(n²)` or worse, or full scans where a filter or index would do. `[AI]`
- N+1 query patterns — a query issued per item inside a loop. `[AI]`
- Multiple passes or loops over the same collection that could be consolidated
  into a single pass. `[AI]`
- Synchronous / blocking I/O on hot paths. `[grep]` `[AI]`
- Unbounded in-memory accumulation — loading a whole dataset where streaming or
  pagination would do (overlaps Category M). `[AI]`
- Redundant recomputation that could be hoisted out of a loop or memoized.
  `[AI]`
- Large reads or writes with no batching or pagination. `[AI]`

### O. Weak type modeling

*Distinct from Category B: B is about **disabling** the type checker; this is
about **underusing** it — types that are technically valid but too loose to
catch mistakes. Findings here are typically Medium/Low unless a loose type is
the root cause of a correctness finding.*

- Stringly-typed code — a bare `string` where a string-literal union would
  constrain the valid values. `[AI]`
- Bags of optional properties where a discriminated union would model the real
  states. `[AI]`
- Overly broad types — `object`, `Record<string, unknown>`, sprawling unions —
  where a precise type is knowable. `[AI]`
- Primitive obsession — bare primitives passed around where a named or branded
  type belongs. `[AI]`
- Multiple booleans encoding a state that is really one union. `[AI]`
- Types that allow illegal states — impossible field combinations remain
  representable. `[AI]`
- Missing `readonly` where immutability is intended. `[grep]` `[AI]`
- Cross-reference `typescript-standard.md` (micro-level type practices).

### P. Data & schema debt

*Migration discipline is a lower concern at FlashQuery's current scale (few users
today), so migration-specific findings default to Medium/Low — but they are still
recorded so the picture stays complete as usage grows. This caveat is about
**database schema** migrations only; breakage of existing **user config** files
is Category S and is not downgraded.*

- Scattered or inline raw SQL — queries embedded ad hoc across modules rather
  than going through a data-access layer. `[grep]` `[AI]`
- Schema drift — code assumptions about table shape diverging from the actual
  Supabase schema. `[AI]`
- Missing, out-of-order, or undocumented migrations — schema changes not
  captured as migrations. `[AI]`
- Direct table access spread across the codebase instead of through a
  repository / data layer. `[AI]`
- Queries bypassing generated or typed schema definitions — untyped row shapes
  (overlaps Category B). `[AI]`
- Unparameterized or string-built queries — injection risk (overlaps Category
  K). `[grep]` `[AI]`
- Missing indexes on columns used for lookup or filtering at scale (overlaps
  Category N). `[AI]`

### Q. MCP tool contract & agent-facing UX

*FlashQuery's public product surface is MCP. A tool that technically runs but
returns ambiguous, unstable, unsafe, or non-actionable output is product debt,
because the caller is an AI model trying to decide what to do next.*

- Tool schemas that are looser than the handler contract — optional fields the
  implementation requires, missing enum bounds, no maximums for large inputs, or
  a schema that permits impossible argument combinations. `[AI]`
- Tool names, titles, or descriptions that mislead the model about side effects,
  permissions, destructive behavior, or expected follow-up calls. `[AI]`
- Tool handlers that throw protocol-level errors for model-recoverable domain
  failures, or return `isError: true` for true server/protocol faults. MCP tools
  should separate JSON-RPC/protocol errors from actionable tool execution
  errors. `[AI]`
- Error responses that do not tell the model how to recover — missing IDs,
  valid ranges, required next steps, or available alternatives. `[AI]`
- Missing response invariants — every successful tool result should include the
  IDs, paths, timestamps, counts, or status fields needed for a follow-up call.
  `[AI]`
- Non-deterministic `tools/list` ordering or tool exposure that changes as a
  side effect of connection-local state rather than explicit config/auth input.
  `[AI]`
- Hidden stateful workflows — a tool relies on implicit per-session state
  instead of returning an explicit opaque handle and validating that handle on
  each call. `[AI]`
- Tool output that is too verbose, unstructured, or missing structured metadata,
  making it hard for an AI caller to parse and act on safely. `[AI]`
- Destructive or high-agency tools with no visible dry-run, confirmation,
  write-lock, permission pre-scan, or audit trail. `[AI]`
- Tool metadata or help markdown drifting from the actual implementation.
  `[grep]` `[AI]`
- Breaking changes to a tool's input or output contract — renamed or removed
  arguments, narrowed enums, a changed result shape — shipped without a version
  signal or compatibility window, silently breaking existing agent integrations.
  `[AI]`

### R. LLM, embedding & context-safety debt

*FlashQuery stores memory, documents, vectors, plugins, and tool outputs for use
by AI systems. That creates risks that ordinary TypeScript audits miss: prompt
injection through stored content, data over-sharing, retrieval contamination,
and model-output trust.*

- Retrieved vault content, memories, documents, plugin text, or web/model output
  treated as instructions rather than untrusted data. `[AI]`
- Model output passed into tools, shell commands, SQL, file paths, config, or
  plugin manifests without validation and capability checks. `[AI]`
- Prompt templates or tool descriptions that mix system/developer instructions
  with untrusted retrieved content without clear delimiters and provenance.
  `[AI]`
- Sensitive data leakage through tool responses, logs, traces, embeddings, or
  prompt construction; redaction bypasses around `src/mcp/redaction.ts` are
  first-class findings. `[grep]` `[AI]`
- Vector-search authorization gaps — retrieval can surface memories, documents,
  projects, or records outside the requested scope. `[AI]`
- Embedding/version drift — embeddings created with one provider/model/dimension
  are queried or mixed with another without migration or compatibility checks.
  `[AI]`
- Prompt-injection test gaps for documents, memories, plugin metadata, macro
  files, and model-generated follow-up actions. `[AI]`
- Unbounded LLM or embedding usage — no timeout, retry budget, token/size
  budget, cancellation path, or cost accounting. `[AI]`
- Overreliance on model assertions — code accepts model-generated IDs,
  citations, paths, or summaries as fact without checking source data. `[AI]`

### S. Release, packaging & runtime operations

*FlashQuery is a CLI/MCP server that users install and run locally. Release and
runtime debt can break users even when unit tests pass.*

- Package contents drift — unpublished files needed at runtime, or accidental
  inclusion of source, tests, local config, secrets, or generated artifacts.
  `[tool]`
- CLI entry points, shebangs, permissions, and Node engine assumptions not
  verified against the packed artifact. `[tool]` `[AI]`
- Startup/shutdown lifecycle gaps — signal handling, write-lock cleanup,
  connection teardown, broker child processes, and idempotent shutdown. `[AI]`
- Config migration/versioning gaps — existing user config files break silently
  after schema changes. `[AI]`
- Runtime diagnostics (`doctor`, preflight, setup) fail to detect common local
  environment problems or produce non-actionable advice. `[AI]`
- Release notes or docs drift from the packaged command surface. `[AI]`

---

## Severity & prioritization model

Every finding gets a **severity** and an **effort** estimate.

**Severity**

- **Critical** — causes or hides incorrect behavior in production now (swallowed
  errors, untyped boundary feeding bad data downstream, race conditions).
- **High** — likely to cause a bug or a costly mistake soon (escape hatches in
  load-bearing code, untested critical paths, circular deps).
- **Medium** — real maintainability drag, no immediate failure (complexity
  hotspots, duplication, dead code, weak config).
- **Low** — cosmetic or housekeeping (stale comments, magic numbers, TODO
  inventory).

**Effort** — Quick (<1h) · Moderate (hours) · Large (a day or more).

**Blast radius** — how far the defect reaches: Single file · Module · Workflow ·
Product surface. A low-effort finding with Product-surface blast radius usually
outranks a similar local cleanup.

**Priority** combines severity, effort, and blast radius: highest-severity,
lowest-effort findings are the quick wins to clear first; high-severity /
large-effort items become planned work. Correctness findings (Category A, parts
of B and C), agent-facing contract failures (Category Q), and context-safety
failures (Category R) default to Critical or High when they can hide failures,
leak data, corrupt stored knowledge, or cause the model to take the wrong action.

---

## Finding confidence & accepted debt

Two practices keep the audit trustworthy across runs:

- **Confidence marking.** Both mechanical tools and AI review produce false
  positives. Every finding carries a confidence level — *Confirmed* (verified
  against the code) or *To verify* (flagged but not yet checked). The report
  separates the two, so the Confirmed set can be trusted and the rest triaged;
  nothing is presented as fact that has not been verified.
- **Accepted-debt baseline.** Some debt is known and consciously accepted. The
  audit keeps a baseline file of accepted findings, each with a reason and a
  date. Re-runs suppress baselined items from the main report and list them
  separately, so every run highlights *new* or *changed* debt rather than
  re-flagging settled decisions — which is what makes the trend-diff meaningful.

---

## The mechanical toolkit

Concrete tools, mapped to the taxonomy. The skill should prefer the repo's own
scripts where they exist before reaching for new tooling.

- **Existing repo scripts** — `npm run typecheck`, `npm run lint`, `npm run
  test`, `npm run test:e2e`, `npm run test:integration`,
  `npm run coverage:macro-framework`, `npm run preflight`. Already present; use
  them when the environment supports the required dependencies.
- **typescript-eslint** — type-checked / strict preset for categories B, C, D, H.
- **`tsc --noEmit`** with strict flags — category B (implicit any), I.
- **knip** — unused exports, files, and dependencies (category D, E). Supersedes
  the older `ts-prune` + `depcheck` combination.
- **madge** or **dpdm** — circular dependency graphs (category G).
- **jscpd** — copy-paste / duplication detection (category H).
- **`npm audit` / `npm outdated`** — category E.
- **Complexity** — eslint `complexity` and `max-lines` / `max-depth` rules, or a
  dedicated complexity reporter (category H).
- **Secret scanning** — gitleaks or equivalent (category K).
- **ripgrep patterns** — for the grep-able anti-patterns. Illustrative starting
  set (the skill should refine these). **All mechanical scans must exclude
  vendored and build paths** — the repo nests `src/node_modules/` and `src/dist/`
  inside the source tree, so a top-level `node_modules` exclusion is not enough;
  exclude `**/node_modules/**` and `**/dist/**` or every pattern below will match
  vendored SDK code:
  - empty catch — `catch\s*\([^)]*\)\s*\{\s*\}`
  - `as any` — `\bas any\b`
  - double assertion — `as unknown as`
  - suppressions — `@ts-(ignore|expect-error|nocheck)`
  - lint suppressions — `eslint-disable`
  - any annotations — `:\s*any\b`
  - swallowed rejection — `\.catch\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)`
  - focused/skipped tests — `\.(only|skip)\(` , `\bxit\(`
  - debug leftovers — `console\.(log|debug)`
  - debt markers — `\b(TODO|FIXME|HACK|XXX)\b`
  - tool errors — `isError:\s*true`
  - tool handlers — `server\.tool|registerTool|tools/list|tools/call`
  - shell execution — `child_process|shelljs|exec\(|spawn\(`
  - model/embedding calls — `call_model|embedding|embed|OpenAI|OpenRouter`
  - redaction-sensitive fields — `api[_-]?key|token|secret|password|service_role`

---

## The AI review layer — semantic checklist

What the targeted reading looks for that the mechanical layer cannot:

- **Misleading error handling** — catches that run code but never surface the
  failure; errors logged to a channel nobody watches; silent degradation to a
  default that looks valid.
- **Boundary trust violations** — external data treated as typed without ever
  being validated, even though no tool flagged it.
- **Weak or leaky abstractions** — a wrapper that doesn't encapsulate, an
  interface that exposes its implementation, an abstraction used in one place.
- **Reachable-but-pointless code** — not "dead" by tooling standards, but
  effectively inert (a flag never set, a branch never true).
- **Divergent copy-paste** — duplicated blocks that have drifted apart, so a fix
  to one was never applied to the other.
- **Comments that lie** — documentation or inline comments contradicting the
  code they describe.
- **Misleading names** — a function named for what it used to do, not what it
  does now.
- **Implicit coupling** — modules that depend on each other's side effects or
  ordering without an explicit contract.
- **Agent contract mismatch** — a tool result that is human-readable but omits
  the machine-relevant ID/status needed for the next tool call.
- **Context poisoning path** — stored or retrieved content can act as a hidden
  instruction channel to the model or to a macro/tool workflow.
- **Authorization by convention** — a handle, project name, path, tool exposure
  setting, or plugin decision is trusted because the caller "should" only pass a
  valid one.
- **Operational blind spot** — a failure mode only appears after packaging,
  startup, shutdown, or local environment setup, not in unit tests.

---

## Report structure

The audit's output — a multi-document set written to a dated folder — is defined
in full by `output-template.md`. That document is the single source of
truth for the output location, file layout, report sections, and the per-finding
schema; this document does not restate it, so the two cannot drift.

The output is a snapshot. Re-running the audit and diffing tells you whether debt
is trending up or down — meaningful only if accepted debt is baselined (see
*Finding confidence & accepted debt*) so settled items are not re-flagged every
run.

---

## Skill workflow architecture

The audit is too large for a single pass — 19 categories over ~120 source files (plus the supporting tooling, configs, and the test tree's interaction with `src/`).
The `flashquery-codebase-audit` skill is therefore built as **separable
workflows, each individually invocable**, plus a default orchestrated run that
chains the core four end to end. Independent Review and Help are invoked on
demand.

1. **Sweep** — the Layer 1 mechanical sweep. Runs the deterministic tools,
   produces the structured inventory and the hotspot ranking. Fast, no judgment.
2. **Review** — the Layer 2 targeted AI review. Itself chunked — invocable per
   category group (e.g. error-handling & observability; MCP & LLM safety;
   structure & performance) or per hotspot batch — because the full taxonomy over
   the whole tree will not fit one pass.
3. **Report** — synthesize the inventory and review findings into the output
   document set, written per `output-template.md`.
4. **Verify** — the post-audit verification workflow (below).
5. **Independent Review** — an optional external review of the output by a
   *different* language model (below). Not part of the default run.
6. **Help** — returns the list of named workflows the skill exposes and what
   each does, so a caller can see what is available and pick one. Invoked
   whenever the user asks what the skill or the audit can do.

Running them individually is a first-class use: re-run just Review for one
category group, or just Verify against an existing report, without redoing the
rest.

### The verification workflow

After the report exists, Verify does a full review of the output itself —
deliberately a separate workflow, because a producer reviewing its own work in
the same pass misses things. It checks three things:

- **No gaps** — every category was actually exercised; nothing the sweep flagged
  was silently dropped; severity, effort, and blast-radius fields are populated.
- **Self-consistency** — finding IDs are unique, cross-references resolve, summary
  counts match the findings, and every finding follows the template.
- **Codebase-grounded** — every finding is rooted in real code: file paths exist,
  line numbers and symbol names are accurate, and the diagnosis matches what the
  code actually does. No hallucinated or stale findings. This mirrors the
  codebase-accuracy pass in `fq-devspec`'s self-review.

A finding that fails verification is corrected or down-marked to *To verify* —
never shipped as *Confirmed*.

### The independent-review workflow

Verify is the audit's own self-check. **Independent Review** is different: an
optional pass in which a *separate* language model — pointed at this same skill
by Matt — re-examines the finished output with fresh eyes and no stake in the
original conclusions. A second, independent model catches what a producer
reviewing its own work cannot, and some audits warrant that higher-assurance
check before remediation begins.

The workflow is built to be **self-contained and model-agnostic** — the
reviewing model may be a different model entirely, or a fresh instance with no
prior context. Its workflow sub-document must therefore carry everything that
model needs to run its own analysis without reconstructing context: the audit's
purpose, the detection taxonomy, the standard (`typescript-standard.md`),
the output schema, the codebase location, and how to verify a finding against
the code.

What the independent reviewer does:

- **Re-examines every finding** against the code — confirming, disputing, or
  amending each, held to the same codebase-grounding bar as Verify.
- **Adds net-new findings** it discovers that the original pass missed.
- **Annotates in place** — it writes its conclusions into the output documents
  as attributed annotations (which model, what date), so its review is visible
  and traceable alongside the original findings rather than in a separate file.
- **Incorporates its conclusions into the overall record** — updating finding
  statuses, severities, the summary counts, and the heatmap so the audit
  reflects the combined view.

This runs on demand, not as part of the default orchestrated run. Matt may invoke
it once, or fan it across several models for an ensemble pass.

---

## Alignment with fq-devspec

Remediating audit findings is development work, and FlashQuery already has the
skill that turns intent into dev-ready specs: **`fq-devspec`** takes a mature
research document and produces a numbered Requirements document and a paired Test
Plan, then advances the feature to `ready-for-dev`. When a batch of audit
findings becomes a remediation project, `fq-devspec` is the skill that specs it —
so the audit output is shaped to be `fq-devspec`-ready:

- **The summary can serve as research input.** `fq-devspec` ingests a research
  doc with resolved decisions, contracts, and a gap inventory. The audit's
  findings supply the resolved decisions and contracts; the per-finding *Open
  questions* (Part 2 of `output-template.md`) are the gap inventory
  `fq-devspec` works through in its batched gap pass.
- **Test layers match.** A finding's *New tests needed* classifies each test by
  `fq-devspec`'s layers — unit, integration, E2E, directed scenario, integration
  scenario — so the Test Plan maps straight across.
- **IDs stay traceable.** Audit findings use `FQ-AUDIT-NNNN`; when a finding
  becomes a `REQ-NNN` in a Requirements doc, the REQ cites the originating
  finding ID.
- **Roadmap lanes map to phases.** The remediation roadmap's lanes (quick wins /
  before next feature / longer-term) translate into `fq-devspec`'s phased plan.

Two patterns are borrowed from `fq-devspec` directly: the Verify workflow mirrors
its codebase-accuracy self-review pass, and the skill should adopt its "prefer
FlashQuery MCP tools, fall back to local `Read`/`Write`" tool strategy.

---

## FlashQuery-specific calibration

- `flashquery` is a **single npm package, not a monorepo** — the macro-level
  "project references / workspaces" advice in `typescript-standard.md` is
  context for future scaling, not a current finding.
- Use the repo's own `tsconfig.json` and `eslint.config.js` as the baseline,
  then report gaps against the best-practices doc — do not assume settings.
- `COVERAGE.md` (FlashQuery Core coverage matrix) is the reference for test-gap
  findings; route remediation through the `flashquery-testgen` skill.
- **Supabase is a hard dependency** — absence of a Supabase-unavailable fallback
  path is *by design*, not debt. Do not flag it.
- MCP is the public API. Findings in `src/mcp/**`, `src/server/**`,
  `src/services/mcp-broker/**`, `src/macro/**`, `src/plugins/**`, `src/llm/**`,
  `src/embedding/**`, `src/storage/**`, `src/config/**`, and `src/logging/**` get
  elevated sampling priority because they affect the AI-facing contract, model
  calls, persisted data, runtime startup, or observability. (`src/llm/**` is where
  `call_model` and model integration live; `src/server/**` is the MCP server
  itself — both verified present in the repo.)
- Tool responses must remain useful to AI callers: human-readable text is the
  transport contract today, but the audit should still verify that responses
  include stable identifiers and enough metadata for follow-up calls.
- `.env`, `.env.test` exist in the working tree alongside `.env.example` —
  confirm the real ones are git-ignored and untracked (a Category K check).
- The `flashquery` repo nests `src/node_modules/` and `src/dist/` inside the
  source tree. Every scan must exclude both; the nesting itself is also a
  candidate Category G / S finding worth confirming.
- The repo also keeps live agent worktrees under `.claude/worktrees/agent-*`.
  These are full clones of `src/`, so any tool walking the tree (knip, jscpd,
  madge with default config, gitleaks, ripgrep without explicit `-g` rules)
  will pick them up as "duplicate" source. Every mechanical tool must exclude
  `.claude/worktrees/**` in addition to `**/node_modules/**` and `**/dist/**`,
  and a knip / madge / jscpd config that bakes this in is preferable to
  passing flags every run.
- `flashquery-plugins` skill markdown is content; only `scripts/` is code.
- `flashquery-product` is docs — excluded from the code audit.

---

## Relationship to other artifacts

- **`typescript-standard.md`** — the rule catalog this audit checks code
  against. The two documents are built to work together.
- **`output-template.md`** — the format the audit's output must take, so
  every finding is directly actionable by AI fix-agents.
- **`code-simplifier` agent** — forward-looking: polishes code as it is written.
  This audit is backward-looking: finds debt already in the tree. No overlap.
- **`req-verify` skill** — checks code against *requirements*; a different axis
  from code health.
- **FlashQuery pipeline** — findings were scoped to a report for now, but
  high-severity items could later be promoted to pipeline captures for tracking.

---

## Open items / to expand

- **AI-review sampling strategy** — define the risk-weighting and a sensible
  budget for the ~120-source-file repo (and a separate decision about
  whether to extend the audit into `tests/` as a future scope).
- **Severity thresholds** — set concrete numbers (file length, function length,
  complexity score) rather than leaving them to judgment.
- **Cadence** — one-off before the next feature cycle, or a recurring/scheduled
  audit? A recurring run makes the trend-diff valuable.
- **`flashquery-plugins` scope** — confirm whether `scripts/` holds enough code
  to be worth a real pass.
- **Trend mode** — whether the skill should compare against the previous report.
- **Remediation handoff** — the path for a batch of findings is `fq-devspec`
  (see *Alignment with fq-devspec*); still open is whether single low-effort
  findings are fixed directly or always routed through a spec.
- **Items for joint review with Matt** — confirm the taxonomy is complete and
  the severity model matches how FlashQuery actually prioritizes.

---

## External references used to extend this audit

- OWASP Top 10 for LLM Applications — maps directly to Category R, especially
  prompt injection, sensitive information disclosure, supply chain risk,
  excessive agency, and overreliance.
- OWASP MCP Top 10 — maps directly to Categories Q and R: token exposure, scope
  creep, tool poisoning, command injection, insufficient authorization, lack of
  telemetry, and context over-sharing.
- Model Context Protocol tool specification — informs Category Q: tool schemas,
  deterministic tool listing, explicit handles for stateful tools, separation of
  protocol errors from tool execution errors, input validation, output
  sanitization, timeouts, and audit logging.
- OpenTelemetry semantic conventions — informs Category L: consistent operation
  names, error typing, span status, and metrics that support error-rate
  calculation without leaking sensitive details.
