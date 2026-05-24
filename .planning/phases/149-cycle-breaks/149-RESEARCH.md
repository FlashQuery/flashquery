# Phase 149: Cycle Breaks - Research

**Researched:** 2026-05-24  
**Domain:** TypeScript ESM import-cycle remediation, document/plugin utilities, macro runtime helper boundaries  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Source-of-Truth Documents
- Downstream planning and implementation agents MUST read the requirements specification and companion test plan listed in `<canonical_refs>` before making implementation choices.
- If this context and the source docs disagree, the source docs win. If the source docs leave an implementation detail open, follow existing FlashQuery code patterns and AGENTS.md.
- Implementation agents should answer their own questions from the two source docs first; only escalate unresolved ambiguity after checking those documents.
- Every downstream plan must include the two source docs in its `<context>` and each task's `<read_first>` section so executor agents have the audit remediation contract in front of them.

### REQ-010: Document/Plugin Cycle Break
- `src/mcp/utils/resolve-document.ts` MUST NOT import from `src/mcp/tools/documents.ts`.
- `src/services/plugin-propagation.ts`, `src/services/plugin-reconciliation.ts`, and related service modules MUST NOT import document helpers from MCP tool modules.
- Shared helpers such as markdown-file listing, hash computation, and document identity resolution must move to a lower-level module that both services and MCP tools can consume.
- The extraction must preserve existing document hashing, vault-file listing, document lookup, plugin propagation, and plugin reconciliation behavior.
- Avoid catch-all barrels or helper modules that simply recreate the cycle through a different path.

### REQ-011: Macro Cycle Break
- Macro evaluator/type/helper imports must be reorganized so the audited macro cycle cluster no longer appears in cycle output.
- The likely direction is a narrow dependency-light module such as `src/macro/builtin-types.ts`, but exact naming and shape are implementation-owned.
- The extraction MUST NOT change parser, evaluator, permission, cancellation, or hard-exclusion behavior.
- Any new shared macro module must avoid importing high-level evaluator modules and must expose only the narrow type/builtin surface required to break the cycle.

### Required Tests And Checks
- T-U-021: document/plugin behavior remains unchanged after helper extraction, using `tests/unit/document-tools.test.ts`, `tests/unit/plugin-reconciliation.test.ts`, or adjacent focused coverage.
- T-U-022: document/plugin cycle cluster is absent from cycle output, either through `tests/unit/circular-deps.test.ts` or a scripted madge assertion.
- T-I-012: plugin propagation/reconciliation integration coverage remains green after import extraction.
- T-U-023: macro parser, evaluator, session, permission, cancellation, and hard-exclusion behavior remains stable after builtin/type extraction.
- T-U-024: macro cycle cluster is absent from cycle output, either through `tests/unit/circular-deps.test.ts` or a scripted madge assertion.
- T-U-025: `npm run test:macro-framework` remains green.
- Final verification must include `npm run typecheck`, focused unit/integration/framework commands, and `npx --yes madge src --extensions ts --circular` or the project-approved equivalent.

[CITED: .planning/phases/149-cycle-breaks/149-CONTEXT.md]

### the agent's Discretion
- Exact module names and helper boundaries are open; prefer the smallest lower-level extraction that removes the cycle without turning this phase into a large document-tool rewrite.
- The cycle assertion can be a unit test, a package script, or a documented command check, as long as it is reproducible and proves the selected document/plugin and macro clusters are gone.
- If existing integration tests already cover T-I-012, reuse and extend them only where needed to prove the moved helper path remains exercised.
- If `madge` reports unrelated pre-existing cycles after the target clusters are removed, document the remaining cycle output and assert absence of the specific Phase 149 clusters rather than expanding scope.

### Deferred Ideas (OUT OF SCOPE)
- Broad decomposition of `tools/documents.ts` beyond cycle-breaking prerequisites is deferred to the unselected `FQ-AUDIT-0010` follow-up.
- Dependency vulnerability and wanted-version drift remediation belongs to Phase 147 unless implementation discovers a tiny local script adjustment is required for the cycle check.
- MCP registration/shutdown lifecycle work belongs to Phase 148.
- Runtime config metadata typing belongs to Phase 150.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-010 | Document/plugin circular dependency cluster is broken. Shared document primitives move out of MCP tool modules so resolver, plugin propagation, and reconciliation modules no longer depend on `mcp/tools/documents.ts`. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3] | Move `computeHash`, `listMarkdownFiles`, `DocMeta`/`parseDocMeta`, and missing-row reconciliation primitives to lower-level modules consumed by services and MCP tools. [VERIFIED: codebase grep] |
| REQ-011 | Macro circular dependency cluster is broken. Macro evaluator/type/helper imports are reorganized through a narrow dependency-light builtin/types module or equivalent, without parser/evaluator/permission/cancellation drift. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4] | Extract macro runtime value/context/error definitions from `evaluator.ts`; update helper modules to depend on the new primitives instead of evaluator. [VERIFIED: codebase grep] |
</phase_requirements>

## Project Constraints (from AGENTS.md)

- Runtime is Node.js >= 20 LTS, TypeScript strict mode, ESM only. Do not introduce CommonJS. [CITED: AGENTS.md]
- Use `@modelcontextprotocol/sdk`, not nonexistent `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- FlashQuery is CLI + MCP only; do not build a web UI or server-side session state. [CITED: AGENTS.md]
- External inputs use Zod validation; MCP tool handlers catch internally and return `{ content: [{ type: "text", text: "..." }] }` with `isError: true` on failure. [CITED: AGENTS.md]
- Unit tests are Vitest under `tests/unit`, integration tests are Vitest under `tests/integration`, and integration/E2E tests may skip when `.env.test` is absent or incomplete. [CITED: AGENTS.md]
- Files use kebab-case, types/interfaces use PascalCase, variables/functions use camelCase, constants use SCREAMING_SNAKE_CASE, and internal Supabase tables use `fqc_` prefix. [CITED: AGENTS.md]

## Summary

Phase 149 is a source dependency-direction cleanup, not a behavior change. The current baseline command `npx --yes madge src --extensions ts --circular` reports 42 cycles, including the target document/plugin cycles `mcp/utils/document-output.ts > mcp/utils/resolve-document.ts > mcp/tools/documents.ts`, `mcp/utils/resolve-document.ts > mcp/tools/documents.ts`, and macro cycles rooted at `macro/evaluator.ts` importing helper modules that import runtime types/errors back from `macro/evaluator.ts`. [VERIFIED: madge command] [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3-§6.4.4]

The smallest document/plugin extraction is to move file-level document primitives out of `src/mcp/tools/documents.ts`: `computeHash`, `listMarkdownFiles`, `DocMeta`, `parseDocMeta`, and likely `reconcileMissingRow`. `resolve-document.ts`, `scanner.ts`, and `plugin-reconciliation.ts` already consume those primitives from the MCP tool file; services must instead import from `src/storage/document-primitives.ts`, `src/services/document-primitives.ts`, or `src/mcp/utils/document-primitives.ts` as long as the new module does not import MCP tools. [VERIFIED: src/mcp/tools/documents.ts:58-374] [VERIFIED: src/mcp/utils/resolve-document.ts:10,173,220] [VERIFIED: src/services/scanner.ts:11] [VERIFIED: src/services/plugin-reconciliation.ts:15]

The smallest macro extraction is broader than only `builtin-types.ts`: `src/macro/types.ts` imports `MacroInvocationContext` and `MacroValue` from `evaluator.ts`, while helpers such as `builtins.ts`, `budget.ts`, `dispatcher.ts`, `forbidden-flag-scan.ts`, `introspection.ts`, `path-wrapper.ts`, `preflight.ts`, `progress-emitter.ts`, `registry.ts`, `coerce.ts`, `dry-run.ts`, and `task-registry.ts` import runtime types or error classes from `evaluator.ts`. [VERIFIED: codebase grep] A narrow `src/macro/runtime-types.ts` plus `src/macro/runtime-errors.ts` or a combined `src/macro/runtime.ts` should own `MacroValue`, `MacroNamedArgs`, `MacroBuiltin`, progress/task/budget context shapes, and exported macro runtime errors. [VERIFIED: src/macro/evaluator.ts:46-235]

**Primary recommendation:** Plan two refactor slices plus a cycle-test slice: extract document primitives first, extract macro runtime types/errors second, then add `tests/unit/circular-deps.test.ts` or a package script that asserts only the REQ-010/REQ-011 clusters are absent while unrelated existing cycles remain documented. [CITED: 149-CONTEXT.md] [VERIFIED: madge command]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Document file listing and hashing | Database / Storage | API / Backend | These primitives describe vault files and row consistency, so services and MCP tools should both depend downward on them. [VERIFIED: src/services/scanner.ts:11] |
| Document identifier resolution | API / Backend | Database / Storage | Resolution combines request identifiers, Supabase rows, vault file existence, and plugin propagation side effects. Keep resolver outside MCP tool registration. [VERIFIED: src/mcp/utils/resolve-document.ts:82-260] |
| Plugin propagation/reconciliation | API / Backend | Database / Storage | Services own plugin table updates and reconciliation classification; they must not import MCP tool modules. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3] |
| Macro runtime value/types/errors | API / Backend | — | Macro parser/evaluator/helper modules all need shared runtime types; a dependency-light runtime module prevents helper-to-evaluator back edges. [VERIFIED: src/macro/evaluator.ts:46-235] |
| Cycle verification | Build / Tooling | API / Backend | Madge/static tests inspect the source import graph, not runtime behavior. [CITED: https://github.com/pahen/madge#readme] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.2 declared, 6.0.3 installed in local tree | Compile-time type safety for refactor boundaries | Existing project compiler and strict TypeScript stack. [VERIFIED: package.json] [VERIFIED: npm install peer output] |
| Vitest | 4.1.1 | Focused unit/integration/framework regression tests | Existing unit, integration, macro framework, and preflight configs use Vitest. [VERIFIED: package.json] |
| Madge | 8.0.0 latest | Static import-cycle detection | Official README documents circular dependency detection and `--circular`; source docs require madge or equivalent. [CITED: https://github.com/pahen/madge#readme] [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Node.js | v24.7.0 available; project requires >=20 | Runtime and built-in `fs`, `path`, `crypto` primitives | All local command checks; compatible with AGENTS minimum. [VERIFIED: local command] [CITED: AGENTS.md] |
| npm/npx | npm/npx 11.5.1 available | Script runner and temporary madge execution | Use `npx --yes madge@8.0.0` for reproducible cycle command if project does not add madge locally. [VERIFIED: local command] [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Add `madge` to `devDependencies` | Use `npx --yes madge@8.0.0` only | Local install failed under current TypeScript 6 peer graph because `madge@8.0.0` declares peerOptional `typescript@^5.4.4`; npx command still runs and matches phase source docs. [VERIFIED: slopcheck/npm output] |
| Full `documents.ts` decomposition | Move only shared primitives | Broad decomposition is explicitly deferred; moving only primitives satisfies REQ-010 with less behavior risk. [CITED: 149-CONTEXT.md] |
| Move all macro helpers into evaluator | Extract runtime primitives | Consolidation would shrink imports but make evaluator larger and retain high-level ownership; extraction matches the requirement's dependency-light direction. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4] |

**Installation:**

No project dependency install is recommended for Phase 149. Use the existing stack and run:

```bash
npx --yes madge@8.0.0 src --extensions ts --circular
```

`npx --yes madge src --extensions ts --circular` also worked locally, but pinning `madge@8.0.0` makes the command reproducible against the verified latest version. [VERIFIED: local command] [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| madge | npm | created 2012-05-20; modified 2024-08-05 | not recorded in this session | github.com/pahen/madge | OK | Approved for temporary `npx` command; do not add as devDependency unless peer conflict is deliberately resolved. [VERIFIED: npm registry] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck]  
**Note:** `slopcheck install madge --json` is unsupported by local slopcheck 0.6.1; `slopcheck install madge` reported `[OK]` and then attempted `npm install madge`, which failed on the TypeScript peer graph. No package files changed. [VERIFIED: local command] [VERIFIED: git status]

## Architecture Patterns

### System Architecture Diagram

```text
Vault files + fqc_documents rows
        |
        v
document primitives (hash, list, parse, missing-row scan)
        |
        +--> scanner / plugin propagation / plugin reconciliation services
        |
        +--> resolve-document utility --> document-output utility --> MCP document/compound/macro tools

Macro source --> parser/types AST
        |
        v
macro runtime primitives (value/context/error types)
        |
        +--> builtins / shell-verbs / budget / preflight / permission / dispatcher helpers
        |
        +--> evaluator orchestrates helpers without helpers importing evaluator
```

### Recommended Project Structure

```text
src/
├── storage/
│   └── document-primitives.ts        # hash, listMarkdownFiles, DocMeta, parseDocMeta, missing-row file scan
├── mcp/
│   ├── tools/documents.ts            # MCP registrations and document tool orchestration only
│   └── utils/resolve-document.ts     # resolver imports document primitives, not MCP tools
└── macro/
    ├── runtime-types.ts              # MacroValue, MacroBuiltin, invocation/progress/task shapes
    ├── runtime-errors.ts             # exported runtime errors shared by helpers/evaluator
    └── evaluator.ts                  # orchestrator imports helpers and runtime primitives
```

Exact file names are implementation-owned; the critical rule is dependency direction. [CITED: 149-CONTEXT.md]

### Pattern 1: Lower-Level Document Primitive Module

**What:** Move generic file/hash/frontmatter primitives below MCP tools so services and tools import the same module. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3]  
**When to use:** Any helper imported by services, resolver utilities, and MCP tools. [VERIFIED: codebase grep]

**Example:**

```ts
// Source: current src/mcp/tools/documents.ts helpers, moved to a lower-level module.
export function computeHash(rawContent: string): string {
  return createHash('sha256').update(rawContent).digest('hex');
}

export async function listMarkdownFiles(
  vaultRoot: string,
  extensions: string[],
  projectPrefix?: string
): Promise<string[]> {
  // Preserve dotfile filtering and Node 20 Dirent parentPath/path fallback.
}
```

### Pattern 2: Macro Runtime Primitive Extraction

**What:** Move shared runtime value/context/error definitions out of `evaluator.ts`, then make helpers import those primitives instead of importing evaluator. [VERIFIED: src/macro/evaluator.ts:46-235]  
**When to use:** Any helper currently importing `MacroValue`, `MacroInvocationContext`, `MacroBuiltin`, `MacroProgressEntry`, or exported macro runtime errors from `./evaluator.js`. [VERIFIED: codebase grep]

**Example:**

```ts
// Source: current src/macro/evaluator.ts exports, moved to runtime primitives.
export type MacroValue = null | boolean | number | string | MacroValue[] | object;
export type MacroNamedArgs = Record<string, MacroValue>;

export type MacroBuiltin = (
  positional: MacroValue[],
  named: MacroNamedArgs,
  context: MacroInvocationContext
) => MacroValue | Promise<MacroValue>;
```

### Pattern 3: Targeted Cycle Assertion

**What:** Parse madge output and assert absence of exact target clusters instead of requiring zero global cycles. [CITED: 149-CONTEXT.md]  
**When to use:** Current repo has unrelated cycles outside Phase 149; failing on all cycles would expand scope. [VERIFIED: madge command]

**Example:**

```ts
// Source: planned Vitest wrapper around madge CLI output.
const forbiddenFragments = [
  'mcp/utils/resolve-document.ts > mcp/tools/documents.ts',
  'mcp/utils/document-output.ts > mcp/utils/resolve-document.ts > mcp/tools/documents.ts',
  'macro/types.ts > macro/evaluator.ts',
  'macro/evaluator.ts > macro/builtins.ts',
];

for (const fragment of forbiddenFragments) {
  expect(madgeOutput).not.toContain(fragment);
}
```

### Anti-Patterns to Avoid

- **Catch-all barrel module:** It can hide the same cycle behind a new import path. Use direct imports from dependency-light modules. [CITED: 149-CONTEXT.md]
- **Moving service logic into MCP tools:** Services already run below MCP registration; importing tools from services violates the required direction. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3]
- **Changing macro semantics while moving imports:** Parser, evaluator, permission, cancellation, and hard-exclusion behavior must remain unchanged. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4]
- **Adding `madge` locally without resolving peer conflicts:** Local `npm install madge` failed with TypeScript 6 vs `madge@8.0.0` peerOptional TypeScript 5 range. [VERIFIED: local command]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Import graph cycle detection | Custom regex import scanner | `madge --circular` or a small test wrapper around madge output | TypeScript import resolution and dependency traversal have edge cases. [CITED: https://github.com/pahen/madge#readme] |
| Document hashing | New hash algorithm or per-call ad hoc logic | Existing SHA-256 `computeHash` semantics moved intact | Hash drift would change scanner/reconciliation behavior. [VERIFIED: src/mcp/tools/documents.ts:166-172] |
| Vault markdown listing | Multiple local recursive walkers | Existing `listMarkdownFiles` behavior moved intact | It already handles configured extensions, dotfiles, and Node 20 Dirent compatibility. [VERIFIED: src/mcp/tools/documents.ts:212-246] |
| Macro runtime errors | Ad hoc plain `Error` checks in helpers | Shared runtime error classes | Evaluator catches specific classes for expected envelopes, cancellation, fail, exit, and user-input flow. [VERIFIED: src/macro/evaluator.ts:162-235] |

**Key insight:** This phase succeeds by preserving behavior while removing upward imports. The work is not to invent new document or macro semantics; it is to move existing shared primitives to modules that sit below all current consumers. [CITED: 149-CONTEXT.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None tied to this refactor. Supabase rows and vault markdown files are used by tests but no schema/key/name migration is required. [VERIFIED: requirements scope] | None. |
| Live service config | None. Phase changes source import boundaries only; no plugin registry/config UI state changes are specified. [CITED: 149-CONTEXT.md] | None. |
| OS-registered state | None. FlashQuery runs as a CLI/MCP subprocess; no launchd/systemd/task scheduler rename is involved. [CITED: AGENTS.md] | None. |
| Secrets/env vars | `.env.test` may be needed for integration tests, but no env var names change. [CITED: AGENTS.md] | Ensure integration tests skip or run with configured `.env.test`. |
| Build artifacts | `dist/` may become stale after source edits. [ASSUMED] | Run `npm run typecheck`; build only if executor or verification requires packaged output. |

## Common Pitfalls

### Pitfall 1: Removing Only One Document Import

**What goes wrong:** `resolve-document.ts` stops importing `documents.ts`, but `scanner.ts` or `plugin-reconciliation.ts` still imports `computeHash`/`listMarkdownFiles` from MCP tools. [VERIFIED: codebase grep]  
**Why it happens:** The documented smell mentions resolver, but services also import tool helpers. [CITED: Codebase Audit Priority Remediation Requirements.md §5.1]  
**How to avoid:** Plan a grep gate for all production imports from `src/mcp/tools/documents.ts`, allowing MCP tool modules/tests only. [VERIFIED: codebase grep]  
**Warning signs:** `rg "from '../mcp/tools/documents|from '../tools/documents|from './documents'" src/services src/mcp/utils` still returns production service/utility imports. [VERIFIED: local rg]

### Pitfall 2: Macro Type-Only Imports Still Count in Madge

**What goes wrong:** Runtime behavior is unchanged, but madge still reports cycles such as `macro/types.ts > macro/evaluator.ts`. [VERIFIED: madge command]  
**Why it happens:** Current `types.ts` imports `MacroInvocationContext` and `MacroValue` from `evaluator.ts`, and madge reports those edges. [VERIFIED: src/macro/types.ts:1-4]  
**How to avoid:** Put shared macro types in a dependency-light module and update `types.ts` to import from it, not evaluator. [VERIFIED: codebase grep]  
**Warning signs:** `npx --yes madge@8.0.0 src --extensions ts --circular` still contains `macro/types.ts > macro/evaluator.ts`. [VERIFIED: madge command]

### Pitfall 3: Extracting Errors Without Updating Evaluator Catch Logic

**What goes wrong:** Helpers throw a different class instance than evaluator catches, causing expected macro errors to become runtime errors. [ASSUMED]  
**Why it happens:** Duplicate class definitions can pass TypeScript but fail `instanceof` checks. [ASSUMED]  
**How to avoid:** Move error classes once and import the same classes everywhere; do not re-export duplicate wrappers from evaluator unless they are direct exports from the shared module. [VERIFIED: src/macro/evaluator.ts:383-465]  
**Warning signs:** Macro fail/exit/cancellation/user-input tests fail or error envelopes change. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.5.2]

### Pitfall 4: Requiring Zero Cycles Globally

**What goes wrong:** Phase 149 gets pulled into unrelated LLM/config/server cycles. [VERIFIED: madge command]  
**Why it happens:** Baseline madge output has 42 cycles, but Phase 149 only owns documented document/plugin and macro clusters. [CITED: 149-CONTEXT.md]  
**How to avoid:** Assert absence of target fragments and record remaining unrelated cycles. [CITED: 149-CONTEXT.md]

## Code Examples

### Document Primitive Consumer

```ts
// Source: planned import direction based on current service/tool consumers.
import { computeHash, listMarkdownFiles } from '../storage/document-primitives.js';
```

Use this in `src/services/scanner.ts`, `src/services/plugin-reconciliation.ts`, `src/mcp/utils/resolve-document.ts`, and `src/mcp/tools/documents.ts`. [VERIFIED: codebase grep]

### Macro Runtime Consumer

```ts
// Source: planned import direction based on current macro helper consumers.
import type { MacroBuiltin, MacroInvocationContext, MacroValue } from './runtime-types.js';
import { MacroExpectedError, MacroRuntimeError } from './runtime-errors.js';
```

Use this in helpers currently importing from `./evaluator.js`. [VERIFIED: codebase grep]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Services import helper exports from MCP tool modules | Lower-level shared primitives imported by services and MCP tools | Phase 149 planned | Removes service-to-MCP-tool cycles and respects architecture boundaries. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3] |
| Macro helpers import runtime definitions from evaluator | Runtime primitives/errors live outside evaluator | Phase 149 planned | Removes evaluator/helper back edges without changing language behavior. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4] |
| Full madge zero-cycle gate | Target-cluster absence gate with documented unrelated cycles | Phase 149 planned | Avoids expanding scope into unrelated LLM/config/server cycles. [CITED: 149-CONTEXT.md] |

**Deprecated/outdated:**
- Importing `listMarkdownFiles` or `computeHash` from `src/mcp/tools/documents.ts` in services/utilities is deprecated by REQ-010. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.3]
- Importing macro runtime types/errors from `src/macro/evaluator.ts` in helper modules is deprecated by REQ-011. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `dist/` may become stale after source edits and should be rebuilt only if packaging/runtime verification needs it. | Runtime State Inventory | A plan might omit a build command needed by a later packaging check. |
| A2 | Duplicate macro runtime error classes would break evaluator `instanceof` checks. | Common Pitfalls | If wrong, planner may overemphasize single-class import discipline; if right and ignored, macro errors regress. |

## Open Questions

1. **Should Phase 149 add a persistent `cycle` npm script?**
   - What we know: Source docs allow a unit test, package script, or documented command check. [CITED: 149-CONTEXT.md]
   - What's unclear: Whether maintainers want a permanent script despite unrelated existing cycles. [ASSUMED]
   - Recommendation: Add `tests/unit/circular-deps.test.ts` first; add a package script only if it asserts target-cluster absence or documents accepted residual cycles. [VERIFIED: no existing tests/unit/circular-deps.test.ts]

2. **Should `searchDocumentsSemantic` move with document primitives?**
   - What we know: `compound.ts` imports `searchDocumentsSemantic`, `listMarkdownFiles`, and `parseDocMeta` from `./documents.js`; only `listMarkdownFiles` and `parseDocMeta` are pure file metadata helpers. [VERIFIED: src/mcp/tools/compound.ts:20]
   - What's unclear: Whether moving `searchDocumentsSemantic` is necessary after the primitive extraction. [ASSUMED]
   - Recommendation: Do not move it unless madge still shows the target document/plugin cluster. Its embedding/Supabase dependencies make it less primitive. [VERIFIED: src/mcp/tools/documents.ts:331-374]

3. **Should macro runtime types and errors be one module or two?**
   - What we know: Both types and exported errors are imported by helper modules, and both currently live in `evaluator.ts`. [VERIFIED: src/macro/evaluator.ts:46-235]
   - What's unclear: Preferred local naming. [CITED: 149-CONTEXT.md]
   - Recommendation: Prefer two small modules if it keeps imports clear: `runtime-types.ts` and `runtime-errors.ts`. A single `runtime.ts` is acceptable if it remains dependency-light. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Typecheck/test/npx | yes | v24.7.0 | Project minimum is >=20. [VERIFIED: local command] |
| npm | Script execution | yes | 11.5.1 | none needed. [VERIFIED: local command] |
| npx | Madge cycle command | yes | 11.5.1 | Add a package script only if desired. [VERIFIED: local command] |
| madge CLI | Cycle check | not globally/local installed | 8.0.0 via npx | `npx --yes madge@8.0.0 ...` works. [VERIFIED: local command] |
| slopcheck | Package legitimacy check | yes | 0.6.1 | Manual npm/GitHub verification if unavailable. [VERIFIED: local command] |
| Supabase `.env.test` | T-I-012 integration checks | not verified | — | Existing integration tests skip when credentials are absent/incomplete. [CITED: AGENTS.md] |

**Missing dependencies with no fallback:** none for planning. [VERIFIED: local command]  
**Missing dependencies with fallback:** local/global `madge` is absent; use verified npx command. [VERIFIED: local command]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 [VERIFIED: package.json] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.integration.config.ts`, `tests/config/vitest.macro-framework.config.ts` [VERIFIED: codebase] |
| Quick run command | `npm test -- --run tests/unit/circular-deps.test.ts tests/unit/resolve-document.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-cancellation.test.ts` |
| Full suite command | `npm run typecheck && npm test && npm run test:macro-framework` plus integration command when Supabase is available |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-010 / T-U-021 | Document/plugin behavior unchanged after helper extraction | unit | `npm test -- --run tests/unit/document-tools.test.ts tests/unit/resolve-document.test.ts tests/unit/plugin-reconciliation.test.ts tests/unit/plugin-propagation.test.ts tests/unit/scanner-change-detection.test.ts tests/unit/scanner-embed-drain-status.test.ts` | yes |
| REQ-010 / T-U-022 | Document/plugin target cycle cluster absent | unit/static | `npm test -- --run tests/unit/circular-deps.test.ts` or `npx --yes madge@8.0.0 src --extensions ts --circular` with target-cluster assertion | no, Wave 0 |
| REQ-010 / T-I-012 | Plugin propagation/reconciliation remains green | integration | `npm run test:integration -- tests/integration/plugin-propagation.integration.test.ts tests/integration/plugin-reconciliation.integration.test.ts` | yes, but not included in current integration config and `plugin-reconciliation.integration.test.ts` is suite-skipped |
| REQ-011 / T-U-023 | Macro parser/evaluator/session/permission/cancellation/hard-exclusion stable | unit | `npm test -- --run tests/unit/macro-parser.test.ts tests/unit/macro-evaluator.test.ts tests/unit/macro-cancellation.test.ts tests/unit/macro-permission-prescan.test.ts tests/unit/macro-hard-exclusions.test.ts tests/unit/macro-preflight.test.ts tests/unit/macro-builtins.test.ts tests/unit/macro-shell-verbs.test.ts` | yes |
| REQ-011 / T-U-024 | Macro target cycle cluster absent | unit/static | `npm test -- --run tests/unit/circular-deps.test.ts` or `npx --yes madge@8.0.0 src --extensions ts --circular` with target-cluster assertion | no, Wave 0 |
| REQ-011 / T-U-025 | Macro framework remains green | framework | `npm run test:macro-framework` | yes |

### Sampling Rate

- **Per task commit:** Run the focused unit command for touched area plus `npm run typecheck`. [ASSUMED]
- **Per wave merge:** Run focused document/plugin + macro unit commands and `npx --yes madge@8.0.0 src --extensions ts --circular`. [CITED: 149-CONTEXT.md]
- **Phase gate:** Run `npm run typecheck`, focused unit suites, `npm run test:macro-framework`, T-I-012 integration command if credentials are available, and final madge command. [CITED: 149-CONTEXT.md]

### Wave 0 Gaps

- [ ] `tests/unit/circular-deps.test.ts` — covers T-U-022 and T-U-024 target-cluster absence. [VERIFIED: file absent]
- [ ] Integration config decision — T-I-012 candidate files exist, but `tests/integration/plugin-propagation.integration.test.ts` and `tests/integration/plugin-reconciliation.integration.test.ts` are not included in `tests/config/vitest.integration.config.ts`; `plugin-reconciliation.integration.test.ts` currently uses `describe.skip`. [VERIFIED: codebase]
- [ ] Update mocks importing document primitives from `src/mcp/tools/documents.js`, especially `tests/unit/resolve-document.test.ts`, `tests/unit/scanner-embed-drain-status.test.ts`, `tests/unit/scanner-change-detection.test.ts`, and `tests/unit/get-briefing.test.ts`. [VERIFIED: codebase grep]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | No auth behavior change. [CITED: 149-CONTEXT.md] |
| V3 Session Management | no | MCP remains stateless; no server-side session state. [CITED: AGENTS.md] |
| V4 Access Control | yes | Preserve macro permission prescan and hard-exclusion behavior. [CITED: Codebase Audit Priority Remediation Requirements.md §6.4.4] |
| V5 Input Validation | yes | Preserve existing Zod/tool validation and macro preflight behavior; do not broaden accepted inputs. [CITED: AGENTS.md] |
| V6 Cryptography | yes | Preserve SHA-256 `computeHash`; do not invent hashing. [VERIFIED: src/mcp/tools/documents.ts:166-172] |

### Known Threat Patterns for TypeScript Cycle Refactors

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hash semantics drift causing false scanner/reconciliation decisions | Tampering | Move `computeHash` unchanged and cover scanner/reconciliation tests. [VERIFIED: src/services/scanner.ts:201,569,1357] |
| Macro permission/hard-exclusion drift during import rewrite | Elevation of Privilege | Run macro permission, hard-exclusion, evaluator, and framework suites. [CITED: Codebase Audit Priority Remediation Test Plan.md §4.5.2] |
| Path traversal guard regression in resolver | Tampering | Keep resolver path security branches intact and run `resolve-document` tests. [VERIFIED: src/mcp/utils/resolve-document.ts:107-140] |
| Executing unverified network package via npx | Supply Chain | Pin `madge@8.0.0`, record npm/slopcheck verification, and avoid project install unless peer conflict is handled. [VERIFIED: npm registry] [VERIFIED: slopcheck] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/149-cycle-breaks/149-CONTEXT.md` - locked phase scope, discretion, deferred work, test/check requirements.
- `Codebase Audit Priority Remediation Requirements.md` - REQ-010 and REQ-011 acceptance criteria and failure modes.
- `Codebase Audit Priority Remediation Test Plan.md` - T-U-021..025 and T-I-012 required coverage.
- `AGENTS.md` - project architecture, stack, coding conventions, test commands, and forbidden patterns.
- Codebase inspection with `rg`, `sed`, `nl`, and madge baseline command - concrete imports, helper definitions, existing test files, and current cycle output.
- Madge official README at https://github.com/pahen/madge#readme - `--circular`, TypeScript configuration notes, and dependency graph behavior.

### Secondary (MEDIUM confidence)

- npm registry metadata for `madge` - version 8.0.0, repository, modified/created timestamps, no postinstall script returned. [VERIFIED: npm registry]
- slopcheck 0.6.1 output for `madge` - package reported OK before local install failed on peer conflict. [VERIFIED: slopcheck]

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing project scripts/dependencies and madge official/npm/slopcheck checks were verified.
- Architecture: HIGH - import-cycle findings are based on current source and madge output.
- Pitfalls: MEDIUM - target pitfalls are verified, but exact module names remain implementation-owned.

**Research date:** 2026-05-24  
**Valid until:** 2026-06-23 for codebase import facts; re-run madge and npm metadata before implementation if dependencies change.
