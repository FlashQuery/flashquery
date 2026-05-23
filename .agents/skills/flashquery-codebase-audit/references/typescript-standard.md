# TypeScript Best Practices

**Role:** Bundled reference for the `flashquery-codebase-audit` skill — the TypeScript coding standard the audit judges the codebase against. Findings cite its sections.
**Last updated:** 2026-05-23

---

## Contents

- Purpose
- The core principle
- Micro level — types, files, functions
- Macro level — project organization at scale
- Code clarity & style conventions
- tsconfig reference
- Tooling & CI
- Testing practices for TypeScript systems
- Contested points / nuances
- How this reference is organized
- Open items / to expand
- Sources

---

## Purpose

Capture the common ways production TypeScript is misused, and the practices that
counter each one, organized so the `flashquery-codebase-audit` skill can *detect
and explain* violations, not just describe ideals. This document is the standard;
the audit checks the codebase against it.

Coverage is at two levels:

- **Micro level** — the type system itself, individual files and functions.
- **Macro level** — project organization, module boundaries, build, and tooling
  at the scale of something like FlashQuery (multiple repositories).

---

## The core principle

Nearly every "TypeScript done badly" story is the same move: **using an escape
hatch that silently switches the type checker off**, then being surprised when a
bug it would have caught reaches production. `any`, `as`, the `!` non-null
operator, untyped `JSON.parse`, `@ts-ignore` — they all do the same thing.

The inverse is the whole best practice: **let the type system do its job
everywhere, and validate explicitly at the points where untrusted data enters the
program.** If the skill encodes one principle, it is this one.

---

## Micro level — types, files, functions

### Misuses

1. **Not running strict mode.** Without it, `null`/`undefined` are valid members
   of every type and implicit `any` creeps in. `strict: true` is non-negotiable.
   Turning it on and seeing hundreds of errors does not break anything — it makes
   pre-existing latent bugs visible.

2. **`any` as a default.** It does not just disable checking on one variable; it
   is *contagious* — assignable both directions, so it spreads. Replace with
   `unknown`, which forces narrowing before use. `any` is legitimate only in
   narrow cases: incremental JS→TS migration, or genuinely untyped third-party
   libraries.

3. **Type assertions (`as`).** `as` tells the compiler "trust me" and checking
   stops. Frequent assertions are a *symptom* that the types are modeled wrong.
   The double assertion `as unknown as X` and the non-null `!` operator are the
   same lie in different clothes. Prefer type guards so the *compiler* proves the
   narrowing.

4. **Trusting external data.** `JSON.parse`, `fetch` responses, `process.env`,
   file and DB reads are all effectively `any` (or an unproven asserted type).
   This is the highest-value boundary to fix.

5. **Bags of optional properties.** Many optional fields where only certain
   combinations are valid is an ambiguous type. Model real states with a
   discriminated union instead.

6. **Mutating objects/arrays in place**, causing aliasing bugs — prefer
   `readonly`, `as const`, and spread.

7. **Reaching for classes/enums reflexively.** An object literal or plain
   function often does the job a class is wrapped around. Enums are contested —
   see Contested Points.

8. **Letting return types be fully inferred at public boundaries** (see the
   nuance in Contested Points — internal inference is fine).

9. **Floating promises.** Unhandled async calls are a major silent-failure
   source; catch them with the `no-floating-promises` lint rule.

### Error handling in `try`/`catch` (micro level)

TypeScript has **no checked exceptions** — a function signature never tells you
what it can throw — so the type system gives no help with error conditions
unless you act deliberately. Failure modes:

- **Assuming the caught value is an `Error`.** JavaScript can throw *anything* —
  a string, number, `undefined`, a plain object. Code that reads `e.message`
  blindly throws its own `TypeError` the day a non-Error is thrown, often
  swallowing the original failure. Strict mode helps: `useUnknownInCatchVariables`
  (enabled by `strict`) types the caught value as `unknown`, forcing a narrow.
- **Catch-all that swallows.** A single broad `catch` treating a validation
  error, a network timeout, and a genuine programming bug (`TypeError`,
  `ReferenceError`) the same. Programming bugs should surface loudly, not be
  smoothed over.
- **Empty or log-and-continue catch blocks** that hide failures entirely.
- **Losing the original error** — re-throwing without setting `{ cause }`, so
  the stack trace and root cause vanish.
- **`instanceof` across boundaries** — custom error classes checked with
  `instanceof` can fail across module realms / bundling boundaries; discriminate
  on a literal `name`/`code` field instead.

TypeScript **cannot** give compile-time exhaustiveness on a `catch` — it is one
untyped funnel. The fix is to **catch at the boundary and immediately convert the
failure into a typed, discriminated value** (a Result union). Once it is a
discriminated union, the `never`-based exhaustiveness check applies again: add a
new error kind and every consumer that fails to handle it fails to compile.
That is how "check all error conditions" is actually enforced — not on
`try/catch`, but one step downstream. Keep `try`/`catch` at boundaries; avoid
scattering it through business logic.

### Best practices

- **`unknown` + narrowing** instead of `any`. Narrow with `typeof`, `instanceof`,
  the `in` operator, or custom type-guard predicate functions.
- **Discriminated unions** for state, with **exhaustiveness checks**: assign the
  `default`/fallthrough case to a `never` variable so adding a union member
  without handling it becomes a compile error.
- **Result pattern** — errors as values (`{ ok: true, value }` / `{ ok: false,
  error }`) where appropriate, rather than thrown exceptions, so error handling
  is exhaustiveness-checkable.
- **Built-in utility types** (`Partial`, `Required`, `Pick`, `Omit`, `Record`)
  before hand-rolled ones; composition over deep inheritance.
- **`readonly` / `as const`** for immutability.
- **`import type`** for type-only imports, so they cannot drag runtime code along.
- Annotate return types **at public/module boundaries**; internal inference is
  fine.
- Overall goal: **make illegal states unrepresentable.**

### Boundary validation and serialization

TypeScript types disappear at runtime, so every boundary where data enters or
leaves the process needs an explicit contract. For FlashQuery this includes MCP
tool arguments, YAML config, environment variables, Supabase rows, vault
frontmatter, plugin manifests, macro input variables, LLM responses, and
embedding-provider responses.

Best practices:

- Use Zod or an equivalent runtime schema at every external input boundary.
  Prefer `safeParse` when the caller can recover and `parse` only when the
  failure should abort the operation.
- Infer TypeScript types from the schema (`z.infer<typeof Schema>`) so runtime
  validation and static types cannot drift.
- Keep schemas close to the boundary adapter, not scattered through business
  logic. Business logic should receive already-validated domain types.
- Validate both shape and semantics: enums, minimum/maximum lengths, path
  constraints, mutually exclusive fields, pagination limits, and allowed
  side-effect modes.
- Treat serialized data as untrusted on re-read. A file, cache entry, database
  row, tool result, or model response can be stale, user-edited, malformed, or
  malicious even if FlashQuery wrote it originally.
- Avoid passing raw `Record<string, unknown>` deeply into the system. Narrow once
  at the boundary, then pass precise typed values.

### MCP and LLM-facing TypeScript practices

AI-facing TypeScript has one extra standard: types must help the *model* recover
from mistakes, not merely help humans read code. A tool handler's schema,
description, return text, and error shape are all part of the contract.

Best practices:

- Model MCP tool inputs as narrow schemas with explicit enums, bounded strings,
  bounded arrays, and impossible-state prevention. Do not accept broad strings
  and then infer intent inside the handler.
- Separate protocol/server errors from recoverable tool execution errors. The
  model needs actionable domain errors with valid next steps; the host needs
  true protocol failures surfaced as infrastructure failures.
- Every successful tool response should include stable identifiers and key
  metadata needed for follow-up calls: IDs, paths, counts, timestamps, project
  scope, or status.
- Treat retrieved documents, memories, plugin text, macro files, and model
  responses as untrusted content, not instructions. Delimit untrusted content in
  prompts and preserve provenance in summaries or transformed outputs.
- Redact before logging, tracing, embedding, or returning data to a caller.
  Redaction is a boundary concern, not a formatting afterthought.
- Put timeouts, retry budgets, cancellation, and cost/usage accounting around
  model and embedding calls. Unbounded AI calls are both reliability debt and
  cost debt.
- Validate model-generated IDs, paths, citations, and commands against source
  data before using them. Model assertions are hints until checked.

### Illustrative snippets

```ts
// Caught errors: narrow before use
try {
  doWork();
} catch (e) {
  // e is `unknown` under strict mode
  if (e instanceof Error) log(e.message);
  else log("non-error thrown", e);
}

// Exhaustiveness check on a discriminated union
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle": return Math.PI * shape.r ** 2;
    case "square": return shape.size ** 2;
    default: {
      const _exhaustive: never = shape; // compile error if a kind is unhandled
      return _exhaustive;
    }
  }
}
```

---

## Macro level — project organization at scale

### Misuses

1. **One giant compilation.** Pointing a single `tsc` at the whole repo re-checks
   everything on every change — painfully slow exactly at large scale.

2. **Barrel files** (`index.ts` that `export *` from everything). They feel tidy
   but manufacture circular dependencies between unrelated modules, hurt
   tree-shaking, slow builds, and make symbol origins hard to trace.

3. **Organizing by file type** (`controllers/`, `services/`, `utils/`) — fine for
   a small app, but at scale a single feature smears across many folders.

4. **No enforced module boundaries** — when anything can import anything, the
   dependency graph quietly becomes a tangle.

### Best practices

- **Feature-first / domain organization** over layer-by-type once a codebase is
  large. Everything for a feature lives together; ideally a feature is added by
  adding a directory.
- **TypeScript project references + a workspace tool** (pnpm workspaces is the
  common recommendation) for repos at real scale. References *enforce* boundaries
  (cannot import an unreferenced project), prevent cycles, and enable incremental
  builds with `tsc -b`. Worth it for large repos or just to cut CI time; under
  ~10 projects they are overkill.
- **One-directional, acyclic dependencies**; dependency injection to decouple.
- **Reserve barrels** for genuinely cohesive small groups; prefer explicit
  exports over `export *`.
- **Separate type-only modules from runtime modules** (`types/` with no runtime
  code vs `services/`).

---

## Code clarity & style conventions

These are readability and consistency practices — distinct from the type-safety
practices above, and reviewed against the official `code-simplifier` agent (see
Sources). Two distinctions matter for the skill:

- **Broadly applicable readability practices** — safe to enforce anywhere.
- **Project-calibrated style conventions** — defensible either way; the value is
  consistency, so they must be set to match FlashQuery's actual conventions
  rather than asserted as universal truths.

### Readability practices (broadly applicable)

- **No nested ternaries.** Prefer a `switch` or an `if`/`else` chain for multiple
  conditions — a frequent "fewer lines over readability" trap.
- **Clarity over brevity.** Explicit code beats dense one-liners and overly
  clever solutions; optimizing for fewer lines at the cost of debuggability is a
  net loss.
- **Reduce nesting** and eliminate redundant abstractions and dead code.
- **Consolidate related logic;** keep a function or component to one concern.
- **Remove comments that restate the code.** Keep comments that explain *why*,
  not *what*.
- **Avoid over-simplification** — the opposite failure mode. Do not strip helpful
  abstractions or merge too many concerns just to shrink a diff.

### Style conventions (calibrate per project — do not assert as universal)

- `function` keyword vs. arrow functions — pick one for top-level declarations
  and be consistent.
- ES module imports — consistent ordering and explicit file extensions.
- Consistent naming conventions across the codebase.
- React — explicit `Props` types on components; consistent component patterns.
- Explicit return types on top-level functions — consistent with the boundary
  rule above (annotate at public boundaries; internal inference is fine).

---

## tsconfig reference

`strict: true` is a shorthand that enables: `strictNullChecks`,
`strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`,
`noImplicitAny`, `noImplicitThis`, `useUnknownInCatchVariables`, `alwaysStrict`.

Beyond `strict`, enable:

- `noUnusedLocals`, `noUnusedParameters`
- `noFallthroughCasesInSwitch`
- `noUncheckedIndexedAccess` — array/record access returns `T | undefined`;
  catches a real class of bugs `strict` alone misses
- `noImplicitReturns`
- Build/perf: `incremental`, `skipLibCheck`, `isolatedModules`

Module settings (current guidance): `ES2022` target/module is the sweet spot;
`moduleResolution: "bundler"` for Vite / Next 13+ projects.

---

## Tooling & CI

- **Linting:** use typescript-eslint's `recommended-type-checked` or `strict`
  preset rather than hand-picking rules. Key rules: `no-explicit-any`,
  `no-floating-promises`, `no-unused-vars`. Type-checked rules are slower —
  budget for it on large codebases.
- **Formatting:** leave to Prettier or Biome — not ESLint formatting rules.
- **Build/CI separation:** `tsc --noEmit` for type-checking; a fast transpiler
  (esbuild / swc) for emitting JS — run in parallel. Enable `incremental`,
  `skipLibCheck`, `isolatedModules`; cache `.tsbuildinfo`. Reported build-time
  reductions of 40–73% from config alone.
- With project references, use `tsc -b` and cache `node_modules`, `.tsbuildinfo`,
  and `dist` directories in CI.

## Testing practices for TypeScript systems

Good TypeScript reduces a class of bugs; it does not replace tests. The audit
should treat missing tests as debt when the untested behavior crosses a boundary,
handles errors, persists data, calls models, or affects MCP tool output.

- Prefer behavior tests over implementation tests. Tests should describe what
  the caller observes, not which private helper happened to run.
- Add regression tests for every confirmed defect. A cleanup fix is incomplete
  until the original failure mode is locked down.
- Test error paths deliberately: non-`Error` throws, malformed config, invalid
  frontmatter, database failures, filesystem permission failures, timeout and
  cancellation paths, and partial failures.
- Keep unit tests fast and narrow, but do not mistake mocked integration tests
  for real integration coverage. Anything claiming to verify Supabase behavior
  should use a real test database when the environment permits it.
- Use property-like table tests for parsers, validators, path handling, and
  schema coercion where many edge cases share one invariant.
- Avoid snapshots for high-churn prose unless the snapshot is testing a stable
  public contract. For MCP tool output, assert required IDs, status, and recovery
  guidance explicitly.
- Test agent-facing contracts: invalid tool args, recoverable `isError` results,
  destructive-tool guardrails, redaction, prompt-injection fixtures, and
  model-output validation.
- Mark skipped tests as debt with an owner and reason. `.skip` and `.only` are
  audit findings unless intentionally quarantined.

---

## Contested points / nuances

A good skill encodes judgment, not slogans. These are not settled:

- **"Always annotate return types" is over-stated.** Real rule: annotate at
  public/module boundaries (where a wrong inference silently propagates and
  refactors get risky); internal inference is fine and reduces noise.
- **Enums are not categorically evil.** String-literal unions are the better
  default (no JS output, no import coupling, easier to serialize from API data),
  but enums are reasonable when iterating over the value set is needed. Enum
  behavior has improved in recent TypeScript versions.
- **`type` vs `interface`** — consistency within the repo matters more than the
  choice. `type` is the safer default; `interface` when extensibility /
  declaration merging for a public object shape is specifically wanted.
- **Barrel files are not universally bad** — acceptable for small, genuinely
  cohesive groups (e.g. a `models` folder). The harm is wildcard re-exports
  spanning unrelated modules.

---

## How this reference is organized

The standard groups into seven buckets, which line up with the
`flashquery-codebase-audit` detection taxonomy:

1. **Type-system hygiene** — `any`/`unknown`, assertions, discriminated unions,
   `catch` narrowing, Result pattern.
2. **Boundary validation** — schema validation (Zod is de facto standard) for
   every external input: API responses, user input, `process.env`, file/DB reads.
3. **MCP and LLM contracts** — tool schemas, error/result semantics, redaction,
   prompt-injection resistance, model-output validation, and usage budgets.
4. **Project structure & build** — project references, feature folders, tsconfig
   flags, CI separation.
5. **Tooling baseline** — ESLint preset, formatter, the strict flag set.
6. **Test quality** — behavior-focused tests, real integration coverage,
   regression tests, and agent-facing contract tests.
7. **Code clarity & style** — readability practices and project-calibrated
   conventions (see Code clarity & style conventions above).

Each rule should carry, so the audit can act rather than lecture:

- the **rule** (one line)
- the **why**
- a **bad example** and a **good example**
- a **detection method** — an ESLint rule, a tsconfig flag, or a grep pattern —
  so the audit can flag violations, not just describe them

**Prior art:** Anthropic's official `code-simplifier` agent (see Sources) covers
the readability/clarity bucket well and operates autonomously on recently
modified code. `flashquery-codebase-audit` should align with it rather than
duplicate it — the audit focuses on type-safety, structure, and the
FlashQuery-specific risk surfaces, and leaves clarity refactors to
`code-simplifier`.

---

## Open items / to expand

- **Boundary validation** section now has a first pass, but needs calibration
  against FlashQuery's actual schema modules and MCP registration helpers.
- **Testing practices** now have a first pass, but need calibration against
  FlashQuery's unit/integration/e2e/scenario split and `COVERAGE.md`.
- **Generics** — deeper guidance on constraints and inference beyond "keep code
  DRY".
- **FlashQuery-specific calibration:** this research was kept general by request.
  Before authoring the skill, inspect the three FlashQuery repos to set
  FlashQuery-specific defaults — current tsconfig contents, monorepo-with-project-
  references vs. three separate repos, existing barrel usage, and the coding-
  standard conventions in each repo's CLAUDE.md (function-vs-arrow, import
  ordering, naming). Generic defaults should be replaced with what the codebase
  actually needs.

---

## Sources

Research conducted 2026-05-23.

- [TypeScript Strict Mode: The Complete 2026 Guide](https://codingdunia.com/blog/typescript-strict-mode-guide/)
- [How to Configure tsconfig.json: Best Practices for 2026](https://reintech.io/blog/how-to-configure-tsconfig-json-best-practices-2026)
- [14 Advanced TSConfig Settings You Should Enable In Every Project](https://blog.webdevsimplified.com/2026-04/advanced-tsconfig-settings/)
- [TypeScript: TSConfig Reference](https://www.typescriptlang.org/tsconfig/)
- [9 TypeScript Best Practices & Common Mistakes to Avoid in 2026](https://testomat.io/blog/typescript-best-practices-common-mistakes-how-avoid-them/)
- [Common Anti-Patterns in TypeScript](https://softwarepatternslexicon.com/ts/anti-patterns/common-anti-patterns-in-typescript/)
- [16 Bad TypeScript Habits You Need to Break](https://blog.rsroshi.dev/16-bad-typescript-habits-you-need-to-break-in-2025/)
- [Avoid using Type Assertions in TypeScript](https://www.allthingstypescript.dev/p/avoid-using-type-assertions-in-typescript)
- [When to use TypeScript unknown vs any](https://www.benmvp.com/blog/when-use-typescript-unknown-versus-any/)
- [Tidy TypeScript: Prefer union types over enums](https://fettblog.eu/tidy-typescript-avoid-enums/)
- [Why TypeScript Enums Are Terrible But Union Types Are Great](https://medium.com/totally-typescript/why-typescript-enums-are-terrible-but-union-types-are-great-83324f571eba)
- [The Ultimate Guide to TypeScript Monorepos](https://dev.to/mxro/the-ultimate-guide-to-typescript-monorepos-5ap7)
- [Managing TypeScript Packages in Monorepos (Nx)](https://nx.dev/blog/managing-ts-packages-in-monorepos)
- [Everything You Need to Know About TypeScript Project References (Nx)](https://nx.dev/blog/typescript-project-references)
- [Taming Circular Dependencies in TypeScript](https://medium.com/inkitt-tech/taming-circular-dependencies-in-typescript-d63df1ec8c80)
- [Best Practices with Zod (Steve Kinney)](https://stevekinney.com/courses/full-stack-typescript/zod-best-practices)
- [TypeScript vs Zod: Clearing up validation confusion (LogRocket)](https://blog.logrocket.com/when-use-zod-typescript-both-developers-guide/)
- [How to Handle Discriminated Unions in TypeScript](https://oneuptime.com/blog/post/2026-01-24-typescript-discriminated-unions/view)
- [typescript-eslint: Shared Configs](https://typescript-eslint.io/users/configs/)
- [TypeScript Best Practices for Large-Scale Applications in 2026](https://www.abhs.in/blog/typescript-best-practices-large-scale-applications-2026)
- [TypeScript Interface vs Type: Best Practices and Key Differences](https://www.netguru.com/blog/typescript-interface-vs-type)
- [Recommended Folder Structure for Node (TS)](https://dev.to/pramod_boda/recommended-folder-structure-for-nodets-2025-39jl)
- [TypeScript Performance Optimization 2026](https://dev.to/_d7eb1c1703182e3ce1782/typescript-performance-optimization-2026-compile-speed-runtime-efficiency-and-type-safety-48ch)
- [8 TypeScript CI Tweaks That Shave Off Seconds](https://medium.com/@ThinkingLoop/8-typescript-ci-tweaks-that-shave-off-seconds-23a4ec02305b)
- [Anthropic `code-simplifier` agent (claude-plugins-official)](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md)
- [Model Context Protocol: Tools specification](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)
- [OWASP Top 10 for Large Language Model Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/)
- [OpenTelemetry Semantic Conventions](https://opentelemetry.io/docs/specs/otel/semantic-conventions/)
- [OpenTelemetry Exception Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/)
