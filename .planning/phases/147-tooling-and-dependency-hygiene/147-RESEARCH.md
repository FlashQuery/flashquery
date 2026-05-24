# Phase 147: Tooling and Dependency Hygiene - Research

**Researched:** 2026-05-24  
**Domain:** Node.js dependency hygiene, npm audit/outdated remediation, Chevrotain parser upgrade, Knip static analysis baseline  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
### Source-of-Truth Documents
- Downstream planning and implementation agents MUST read the requirements specification and companion test plan listed in `<canonical_refs>` before making implementation choices.
- If this context and the source docs disagree, the source docs win. If the source docs leave an implementation detail open, follow existing FlashQuery code patterns and AGENTS.md.
- Implementation agents should answer their own questions from the two source docs first; only escalate unresolved ambiguity after checking those documents.

### REQ-006: Dependency Vulnerabilities And Wanted-Version Drift
- At implementation start, run and record current `npm audit` and `npm outdated` output before modifying `package.json` or `package-lock.json`.
- Apply non-major wanted updates through `npm update` or an equivalent lockfile/package refresh and keep the resulting lockfile churn reviewable.
- Treat `chevrotain` 11 to 12 as a separately reviewable step or commit because macro parser behavior is SemVer-major risk.
- Run macro parser and framework regression coverage after the Chevrotain upgrade.
- The MCP SDK update must happen only after or with REQ-007 static-analysis work unless Phase 148 has already landed the typed wrapping path; if typed wrapping has not landed, document the deferral rather than forcing an unsafe SDK bump.
- Completion requires `npm audit` and `npm audit --omit=dev` to report no actionable vulnerabilities, or every remaining advisory to be explicitly documented with rationale.

### REQ-007: Knip Baseline And Preflight Reachability
- Add a project-specific `knip` configuration and `npm run knip` script.
- The config must exclude `.claude/worktrees/**`, `src/node_modules/**`, and `src/dist/**`.
- The config must document whether it checks production reachability only or includes test entrypoints.
- Known intentional exports or false positives must be ignored explicitly in config or adjacent documentation; do not bury them in noisy output.
- Preflight must include knip, or a package script called by preflight, unless there is a documented false-positive gate requiring staged rollout.
- If staged rollout is needed, the plan must specify the exact staged script and documentation proving why full preflight gating is deferred.

### Required Tests And Checks
- T-U-013: macro parser/unit regression coverage after dependency updates.
- T-U-014: `npm run test:macro-framework` after dependency updates, especially after Chevrotain 12.
- T-C-001: `npm audit`.
- T-C-002: `npm audit --omit=dev`.
- T-C-003: `npm outdated`, with empty wanted drift or explicit documentation.
- T-C-004: `npm run typecheck && npm run lint`.
- T-C-005: `npm run knip`.
- T-C-006: `npm run preflight`.
- T-U-015: static/unit assertion for knip exclusions if the selected config format can be tested reasonably; otherwise a source assertion in the plan summary is acceptable.

### the agent's Discretion
- The exact `knip` config format is open; prefer the format that is easiest to validate and maintain in this ESM TypeScript repo.
- The initial committed `knip` policy may be production-surface-only if that policy is documented in config or package scripts.
- The specific package update command sequence is open, but it must preserve reviewability around the Chevrotain major upgrade and the MCP SDK decision.

### Deferred Ideas (OUT OF SCOPE)
- Phase 148 owns typed MCP server wrapping and request-drain lifecycle work. Only update the MCP SDK in Phase 147 if typed wrapping risk has already been addressed or the update is made type-visible and verified here without duplicating Phase 148.
- Broader test-hygiene audit remains out of scope.
- REQ-001 through REQ-005 and REQ-008 through REQ-012 are out of scope except where dependency/tooling changes require tiny incidental adjustments.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-006 | Dependency vulnerabilities and wanted-version drift are remediated. | Current `npm audit`, `npm audit --omit=dev`, and `npm outdated` baselines identify the exact remediation lanes; Chevrotain and MCP SDK risks are mapped to required command gates. [VERIFIED: npm registry] [CITED: mandatory requirements] |
| REQ-007 | `knip` is configured for actionable local and preflight use. | Knip official docs support ESM/TS config, `ignore`, `ignoreDependencies`, `entry`/`project`, and production mode; package legitimacy checks approve `knip` as the standard tool. [VERIFIED: npm registry] [CITED: knip.dev] |
</phase_requirements>

## Summary

Phase 147 should be planned as package/tooling work only: first capture immutable command baselines, then apply wanted non-major updates, then isolate the Chevrotain 12 major upgrade with macro parser and macro framework gates, and finally decide the MCP SDK update only after the Knip/type surface makes `registerTool` drift visible. [CITED: mandatory requirements] [VERIFIED: codebase grep]

Current root state is not clean: `npm audit` reports 13 advisories and `npm audit --omit=dev` reports 12, with direct production advisories on `chevrotain`, `simple-git`, and `uuid`; `npm outdated` reports wanted drift for 10 packages plus Chevrotain latest-major drift. [VERIFIED: npm audit] [VERIFIED: npm outdated]

Use `knip` as a dev dependency with a committed typed ESM config, preferably `knip.ts`, because this repo is ESM TypeScript and T-U-015 can import or statically assert the config. Start with a documented production-surface run if full project analysis is too noisy; preflight must either run that staged script or explain the exact false-positive gate. [CITED: knip.dev] [CITED: mandatory requirements] [VERIFIED: AGENTS.md]

**Primary recommendation:** Plan two reviewable lanes: dependency remediation with Chevrotain isolated, and Knip baseline/preflight integration with explicit exclusions and staged policy documentation. [CITED: mandatory requirements]

## Project Constraints (from AGENTS.md)

- Node.js >= 20 is required; current local Node is v24.7.0 and npm is 11.5.1. [VERIFIED: shell] [CITED: AGENTS.md]
- FlashQuery is strict TypeScript and ESM; new config/source should use ESM imports/exports, not CommonJS. [CITED: AGENTS.md]
- The MCP SDK package is `@modelcontextprotocol/sdk`; do not use nonexistent `@modelcontextprotocol/server`. [CITED: AGENTS.md]
- Do not build a web UI; this phase is CLI/MCP/package tooling only. [CITED: AGENTS.md] [CITED: mandatory requirements]
- Use Zod for external input validation; MCP handlers should catch failures and return `isError: true` where relevant. [CITED: AGENTS.md]
- Unit tests are Vitest under `tests/unit`; macro framework is `npm run test:macro-framework`; preflight is `npm run preflight`. [CITED: AGENTS.md] [VERIFIED: package.json]
- Do not use `npm link` for local development. [CITED: AGENTS.md]
- Project skills relevant to this phase: `pre-push` requires `npm run preflight` before any push; macro framework work should respect the framework README and run `npm run test:macro-framework`. [VERIFIED: .agents/skills] [VERIFIED: tests/macro-framework/README.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| npm dependency remediation | Build / Tooling | Runtime package metadata | `package.json` and `package-lock.json` own dependency ranges and installed graph; runtime code should change only if updates expose type/API drift. [VERIFIED: package.json] |
| Chevrotain parser upgrade | Build / Tooling | Macro runtime source | Root macro lexer imports Chevrotain in `src/macro/tokens.ts`; parser behavior is validated through unit and macro framework tests. [VERIFIED: codebase grep] |
| MCP SDK update decision | API / Backend | Build / Tooling | MCP registration and tool response types live in backend MCP server modules, but the package update is dependency metadata. [VERIFIED: codebase grep] |
| Knip baseline | Build / Static Analysis | Package scripts / preflight | Knip runs from npm scripts and analyzes entry/project reachability; preflight decides whether it gates commits. [CITED: knip.dev] [VERIFIED: package.json] |
| Audit/outdated recording | Build / Security tooling | Documentation | The acceptance criteria require command output to be recorded before package edits and after remediation. [CITED: mandatory requirements] |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `npm` | 11.5.1 local | Audit, outdated, install/update, lockfile refresh | Existing package manager and lockfile format; `npm audit`/`npm outdated` are explicitly required. [VERIFIED: shell] [CITED: mandatory requirements] |
| `chevrotain` | 12.0.0 latest; root current 11.2.0 | Lexer/parser toolkit used by macro tokens | Required major upgrade path for the vulnerable Chevrotain 11 tree. [VERIFIED: npm registry] [VERIFIED: codebase grep] |
| `knip` | 6.14.2 latest | Unused files/dependencies/exports analysis | Official docs support TypeScript config, production mode, and explicit ignore controls needed by REQ-007. [VERIFIED: npm registry] [CITED: knip.dev] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@modelcontextprotocol/sdk` | 1.29.0 latest; root current 1.27.1 | MCP server registration API | Update only after or with static/type visibility for `registerTool`, or defer to Phase 148. [VERIFIED: npm registry] [CITED: MCP TypeScript SDK docs] [CITED: mandatory requirements] |
| `vitest` | 4.1.7 latest; root current 4.1.1 | Unit and macro framework tests | Non-major wanted update and required regression gate runner. [VERIFIED: npm outdated] [VERIFIED: package.json] |
| `typescript` | 6.0.3 wanted/latest; root current 6.0.2 | Typecheck | Non-major wanted update and required `npm run typecheck` gate. [VERIFIED: npm outdated] |
| `eslint` / `typescript-eslint` | 10.4.0 / 8.59.4 wanted/latest | Lint gate | Non-major wanted updates and required `npm run lint` gate. [VERIFIED: npm outdated] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `knip` | `depcheck`, custom `rg` scripts | Rejected because REQ-007 names Knip and requires a Knip script/config. [CITED: mandatory requirements] |
| `npm update` | Manual `npm install pkg@version` per package | Manual installs are useful for Chevrotain/MCP reviewability, but non-major drift should use `npm update` or equivalent lockfile refresh. [CITED: mandatory requirements] |
| Immediate MCP SDK bump | Deferral note until Phase 148 | Use deferral if typed wrapper work has not landed; forcing the SDK update risks hidden `registerTool` drift. [CITED: mandatory requirements] [CITED: MCP TypeScript SDK docs] |

**Installation:**
```bash
npm install --save-dev knip
npm update
npm install chevrotain@^12.0.0
# Only if typed wrapping risk is addressed or made type-visible:
npm install @modelcontextprotocol/sdk@^1.29.0
```

**Version verification:** Versions above were verified with `npm view <pkg> version`, `npm outdated --json`, and npm registry metadata on 2026-05-24. [VERIFIED: npm registry] [VERIFIED: npm outdated]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `knip` | npm | created 2022-10-09; modified 2026-05-22 | 8,542,591/wk | github.com/webpro-nl/knip | OK | Approved for devDependency. [VERIFIED: npm registry] |
| `chevrotain` | npm | created 2015-05-30; modified 2026-03-13 | 9,723,233/wk | github.com/Chevrotain/chevrotain | OK | Approved, but major upgrade must be isolated. [VERIFIED: npm registry] |
| `@modelcontextprotocol/sdk` | npm | created 2024-11-11; modified 2026-03-30 | 36,697,953/wk | github.com/modelcontextprotocol/typescript-sdk | OK | Approved, but update may be deferred until Phase 148 risk is closed. [VERIFIED: npm registry] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: slopcheck]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: slopcheck]

Note: local `slopcheck` 0.6.1 does not support `--json`; text output reported `[OK]` for all three packages. The `install` subcommand also invoked `npm install`; incidental `package.json`/`package-lock.json` changes were reverted before writing this file. [VERIFIED: shell]

## Current Dependency Baseline

### `npm audit`
| Scope | Total | Moderate | High | Direct notable advisories |
|-------|-------|----------|------|---------------------------|
| Full tree | 13 | 7 | 6 | `chevrotain`, `simple-git`, `uuid`. [VERIFIED: npm audit] |
| `--omit=dev` | 12 | 6 | 6 | Same production-relevant direct packages. [VERIFIED: npm audit] |

Key remediation mapping:
- `chevrotain` 11.2.0 is vulnerable through `lodash-es` and Chevrotain internal packages; npm reports the available fix as `chevrotain@12.0.0` and SemVer-major. [VERIFIED: npm audit]
- `simple-git` current 3.33.0 has wanted/latest 3.36.0; audit reports high severity RCE fixed by available update. [VERIFIED: npm audit] [VERIFIED: npm outdated]
- `uuid` current 13.0.0 has wanted 13.0.2 and latest 14.0.0; audit fix is available without requiring latest major. [VERIFIED: npm audit] [VERIFIED: npm outdated]
- Transitive advisories include `brace-expansion`, `express-rate-limit`, `fast-uri`, `hono`, `ip-address`, `qs`, and `ws`; most should resolve through non-major root or transitive lockfile updates. [VERIFIED: npm audit]

### `npm outdated`
Wanted drift on 2026-05-24:
- `@types/node` 25.5.0 -> 25.9.1. [VERIFIED: npm outdated]
- `dotenv` 17.3.1 -> 17.4.2. [VERIFIED: npm outdated]
- `eslint` 10.1.0 -> 10.4.0. [VERIFIED: npm outdated]
- `prettier` 3.8.1 -> 3.8.3. [VERIFIED: npm outdated]
- `simple-git` 3.33.0 -> 3.36.0. [VERIFIED: npm outdated]
- `tsx` 4.21.0 -> 4.22.3. [VERIFIED: npm outdated]
- `typescript` 6.0.2 -> 6.0.3. [VERIFIED: npm outdated]
- `typescript-eslint` 8.59.0 -> 8.59.4. [VERIFIED: npm outdated]
- `uuid` 13.0.0 -> 13.0.2 wanted, 14.0.0 latest. [VERIFIED: npm outdated]
- `vitest` 4.1.1 -> 4.1.7. [VERIFIED: npm outdated]
- `chevrotain` 11.2.0 has no wanted drift but latest is 12.0.0. [VERIFIED: npm outdated]

Nested package note: `tests/macro-framework/macro-golden-model/package.json` is a private nested package with its own `chevrotain` 11 dependency; running `npm audit` in that directory reports 4 high advisories. The planner should include an explicit decision task: update the nested golden model Chevrotain package with the same macro gates, or document why the private fixture package is out of root acceptance scope. [VERIFIED: shell] [VERIFIED: codebase grep]

## Architecture Patterns

### System Architecture Diagram

```text
Developer / implementation agent
  |
  v
Record baseline commands
  |--> npm audit / npm audit --omit=dev -> remediation list
  |--> npm outdated -> wanted/latest drift list
  v
Non-major update lane
  |--> npm update or targeted npm install within existing ranges
  |--> package-lock refresh
  |--> typecheck + lint + macro parser smoke
  v
Chevrotain major lane
  |--> npm install chevrotain@^12.0.0
  |--> inspect src/macro/tokens.ts + parser behavior
  |--> npm test -- macro parser + npm run test:macro-framework
  v
Knip lane
  |--> npm install --save-dev knip
  |--> knip.ts with explicit entry/project/ignore policy
  |--> npm run knip
  |--> add preflight gate or staged preflight script
  v
MCP SDK decision point
  |--> typed wrapper already landed? update + type/lint/e2e smoke
  |--> otherwise document deferral to Phase 148
  v
Final gates
  npm audit && npm audit --omit=dev && npm outdated && npm run typecheck && npm run lint && npm run knip && npm run preflight
```

### Recommended Project Structure

```text
.
├── knip.ts                         # Typed ESM Knip config and documented policy
├── package.json                    # Add knip and possibly preflight:knip scripts
├── package-lock.json               # Refreshed lockfile from approved updates
├── tests/unit/knip-config.test.ts  # T-U-015 if config import/static assertion is practical
└── tests/macro-framework/macro-golden-model/
    ├── package.json                # Explicitly decide/update nested Chevrotain state
    └── package-lock.json
```

### Pattern 1: Typed ESM Knip Config

**What:** Use `knip.ts` with `KnipConfig` typing, explicit `entry`, `project`, and ignore lists. [CITED: knip.dev]  
**When to use:** Always for this phase; JSON is valid, but TS config is easier to assert in Vitest and matches repo conventions. [VERIFIED: AGENTS.md]

**Example:**
```typescript
// Source: https://knip.dev/reference/dynamic-configuration and https://knip.dev/reference/configuration
import type { KnipConfig } from 'knip';

const config: KnipConfig = {
  entry: ['src/index.ts!'],
  project: ['src/**/*.ts!'],
  ignore: ['.claude/worktrees/**', 'src/node_modules/**', 'src/dist/**', 'dist/**'],
};

export default config;
```

### Pattern 2: Staged Preflight Script

**What:** Add `knip` plus either `preflight:knip` or direct `npm run knip` in `preflight`. [CITED: mandatory requirements]  
**When to use:** Use direct preflight gating if output is actionable; use staged script only with documented false positives. [CITED: mandatory requirements]

**Example:**
```json
{
  "scripts": {
    "knip": "knip --production",
    "preflight:knip": "npm run knip",
    "preflight": "npm run lint && npm run typecheck && npm run preflight:knip && npm run preflight:test && npm run preflight:pack && npm run preflight:docker"
  }
}
```

### Pattern 3: Reviewable Dependency Lanes

**What:** Do non-major wanted updates separately from Chevrotain 12 and separately from MCP SDK decision. [CITED: mandatory requirements]  
**When to use:** Always; the acceptance criteria require Chevrotain major reviewability and MCP SDK risk coordination. [CITED: mandatory requirements]

**Example command order:**
```bash
npm audit --json > .planning/phases/147-tooling-and-dependency-hygiene/npm-audit-before.json
npm outdated --json > .planning/phases/147-tooling-and-dependency-hygiene/npm-outdated-before.json
npm update
npm run typecheck && npm run lint
npm test -- --run tests/unit/macro-parser.test.ts
npm install chevrotain@^12.0.0
npm test -- --run tests/unit/macro-parser.test.ts
npm run test:macro-framework
```

### Anti-Patterns to Avoid

- **Running `npm audit fix --force` as the main strategy:** It can combine SemVer-major changes and hide the Chevrotain risk REQ-006 requires to isolate. [CITED: mandatory requirements] [CITED: npm docs]
- **Adding Knip with broad ignores only:** Knip docs recommend tuning `entry`/`project` and using targeted ignore options instead of hiding broad issue classes. [CITED: knip.dev]
- **Updating MCP SDK before wrapper risk is visible:** Current `src/mcp/server.ts` still has broad casts around `registerTool`; Phase 148 owns typed wrapping unless this phase closes that risk. [VERIFIED: codebase grep] [CITED: mandatory requirements]
- **Forgetting nested macro golden model state:** The nested private package has its own Chevrotain 11 lockfile and audit findings; leaving it unmentioned creates ambiguity. [VERIFIED: shell]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Vulnerability inventory | Custom advisory scraper | `npm audit` and `npm audit --omit=dev` | Required by test plan and backed by npm registry advisories. [CITED: npm docs] [CITED: mandatory test plan] |
| Wanted/latest drift | Manual registry diff script | `npm outdated --json` | Reports current/wanted/latest against package ranges; required by test plan. [CITED: npm docs] [CITED: mandatory test plan] |
| Unused dependency/export analysis | `rg`-only heuristics | `knip` | Knip understands package scripts, TS project files, and production mode. [CITED: knip.dev] |
| Parser regression confidence | Spot-checking examples manually | Existing Vitest parser tests and macro framework | `tests/unit/macro-parser.test.ts` plus 510-pilot macro framework are the project regression surface. [VERIFIED: tests/macro-framework/README.md] |

**Key insight:** This phase is about making package drift observable and reviewable, not inventing new analysis infrastructure. [CITED: mandatory requirements]

## Common Pitfalls

### Pitfall 1: Lockfile Churn Hides the Risky Upgrade
**What goes wrong:** `npm audit fix --force` or a broad install updates Chevrotain, MCP SDK, and transitive packages in one diff. [CITED: mandatory requirements]  
**Why it happens:** npm can apply SemVer-major fixes when forced. [CITED: npm docs]  
**How to avoid:** Record baselines, run non-major update first, then Chevrotain 12 in a separate step, then make an MCP SDK decision. [CITED: mandatory requirements]  
**Warning signs:** Package-lock diff changes `chevrotain`, `@modelcontextprotocol/sdk`, and unrelated transitive packages together. [ASSUMED]

### Pitfall 2: Knip Scans Build, Worktree, or Vendor Noise
**What goes wrong:** Output is unactionable because it includes `.claude/worktrees/**`, `src/node_modules/**`, `src/dist/**`, `dist/**`, generated files, or nested fixture packages. [CITED: mandatory requirements]  
**Why it happens:** Default Knip mode can analyze all project code and config/test files. [CITED: knip.dev]  
**How to avoid:** Configure explicit project boundaries and required ignores; document production-only vs full-project policy. [CITED: knip.dev] [CITED: mandatory requirements]  
**Warning signs:** `npm run knip` reports generated/package output instead of source reachability. [ASSUMED]

### Pitfall 3: MCP SDK Drift Is Hidden By Casts
**What goes wrong:** SDK update compiles because casts erase the `registerTool` signature, but runtime registration behavior changed. [CITED: mandatory requirements] [VERIFIED: codebase grep]  
**Why it happens:** `src/mcp/server.ts` currently uses broad casts in wrapper code, while `tool-catalog.ts` already has a typed `McpServer['registerTool']` pattern. [VERIFIED: codebase grep]  
**How to avoid:** Defer MCP SDK update unless typed wrapping has landed or this phase adds type-visible coverage without taking over Phase 148. [CITED: mandatory requirements]  
**Warning signs:** Package diff updates `@modelcontextprotocol/sdk` without new wrapper/type tests or explicit deferral note. [ASSUMED]

### Pitfall 4: Nested Package Audit Gap
**What goes wrong:** Root audit becomes clean but the macro golden model private package still carries Chevrotain 11 advisories. [VERIFIED: shell]  
**Why it happens:** Nested `tests/macro-framework/macro-golden-model/package.json` has its own dependency graph and lockfile. [VERIFIED: codebase grep]  
**How to avoid:** Add a plan task to either update that nested package or document why root `npm audit` acceptance excludes it. [VERIFIED: shell]  
**Warning signs:** Root `npm audit` passes while `cd tests/macro-framework/macro-golden-model && npm audit` fails. [VERIFIED: shell]

## Code Examples

### Knip Config Static Assertion
```typescript
// Source: project Vitest pattern + Knip TS config docs
import { describe, expect, it } from 'vitest';
import config from '../../knip.js';

describe('knip config', () => {
  it('T-U-015 excludes required noisy paths', () => {
    expect(config.ignore).toEqual(
      expect.arrayContaining(['.claude/worktrees/**', 'src/node_modules/**', 'src/dist/**'])
    );
  });
});
```

If TS config import is awkward under Vitest resolution, use a static file-read assertion instead; the test plan allows a source assertion when config format makes direct import impractical. [CITED: mandatory test plan]

### Production-Surface Knip Policy Comment
```typescript
// Source: https://knip.dev/features/production-mode
// Phase 147 policy: `npm run knip` checks production reachability first.
// Tests remain covered by Vitest and macro-framework gates; full-project Knip
// can be added after intentional exports are triaged.
```

### MCP SDK Update Decision Record
```markdown
MCP SDK decision: deferred to Phase 148.
Reason: `src/mcp/server.ts` still contains untyped registerTool wrapping, and
REQ-006 requires the SDK update after typed wrapping risk is addressed.
Current latest checked: @modelcontextprotocol/sdk 1.29.0 on 2026-05-24.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Chevrotain 11 in root macro lexer | Chevrotain 12 latest | 12.0.0 published by 2026-03-13 registry metadata | Major upgrade required to clear Chevrotain/lodash advisories. [VERIFIED: npm registry] |
| Knip default all-project analysis | Optional production mode with `pattern!` entries and `--production`/`--strict` | Current Knip docs crawled 2026-05-23 | Lets Phase 147 start with actionable production reachability and avoid test/tooling noise. [CITED: knip.dev] |
| MCP `server.tool()` examples | `server.registerTool(name, config, callback)` with object config and Zod schema | Current MCP TypeScript SDK docs | Reinforces why SDK update must be type-visible around `registerTool`. [CITED: MCP TypeScript SDK docs] |

**Deprecated/outdated:**
- Chevrotain 11 dependency tree is vulnerable in this repo and should not remain without explicit documented rationale. [VERIFIED: npm audit]
- `server.tool` wrapping in `src/mcp/server.ts` is already marked as no-production-caller by requirements, but removal belongs to Phase 148 unless needed for MCP SDK update safety. [CITED: mandatory requirements] [VERIFIED: codebase grep]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Package-lock diffs that combine Chevrotain, MCP SDK, and unrelated transitive updates are harder to review and diagnose. | Common Pitfalls | Planner may over-split or under-split update tasks. |
| A2 | Knip output containing generated/package output is less actionable than source reachability output. | Common Pitfalls | Planner might allow a noisy baseline that still technically runs. |
| A3 | Updating MCP SDK without wrapper/type tests may hide runtime registration drift. | Common Pitfalls | Planner may defer unnecessarily if Phase 148 already landed. |
| A4 | Phase ordering can change after this research. | Open Questions | Planner may include an unnecessary MCP SDK deferral checkpoint if Phase 148 lands first. |
| A5 | Actual Knip false positives are unknown until Knip runs on the final updated tree. | Open Questions | Planner may choose production-only staging when full-project gating would have passed. |

## Open Questions

1. **Should the nested macro golden model package be updated in Phase 147?**
   - What we know: it has its own `chevrotain` 11 dependency and `npm audit` reports 4 high advisories there. [VERIFIED: shell]
   - What's unclear: REQ-006 acceptance explicitly names root `npm audit` commands, not nested package audit. [CITED: mandatory test plan]
   - Recommendation: include a planner task to decide and document this before final acceptance.

2. **Has Phase 148 typed MCP wrapping already landed by implementation time?**
   - What we know: current `src/mcp/server.ts` still has broad casts around `registerTool`. [VERIFIED: codebase grep]
   - What's unclear: Phase ordering can change after research. [ASSUMED]
   - Recommendation: at implementation start, grep for typed wrapper changes; if absent, defer MCP SDK update with a documented rationale.

3. **Should `npm run knip` be production-only or full-project on first landing?**
   - What we know: user decisions allow production-surface-only if documented. [CITED: CONTEXT.md]
   - What's unclear: actual false positives are unknown until Knip runs on the final updated tree. [ASSUMED]
   - Recommendation: plan production-first with a checkpoint to promote to full-project only if output is clean and actionable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | npm scripts, TypeScript, Vitest, Knip | Yes | v24.7.0 | Project minimum is >=20. [VERIFIED: shell] |
| npm | audit/outdated/install/update | Yes | 11.5.1 | None; required commands are npm-specific. [VERIFIED: shell] |
| Local package bins via `npm exec` | `tsx`, `tsc`, `vitest` | Yes | tsx 4.21.0, TypeScript 6.0.2, Vitest 4.1.1 | Use npm scripts, not global binaries. [VERIFIED: shell] |
| Docker | `npm run preflight` docker compose validation | No | — | Existing script skips compose validation when Docker is absent. [VERIFIED: shell] [VERIFIED: scripts/preflight-docker.sh] |
| `.env.test` | macro framework / integration setup | Yes | file present | Missing or incomplete credentials may skip Supabase-backed tests. [VERIFIED: shell] [CITED: AGENTS.md] |
| slopcheck | package legitimacy audit | Yes | 0.6.1 | Text output only; no `--json` support locally. [VERIFIED: shell] |

**Missing dependencies with no fallback:** none identified for planning. [VERIFIED: shell]  
**Missing dependencies with fallback:** Docker is absent; preflight script exits 0 with a skip message. [VERIFIED: scripts/preflight-docker.sh]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.1 current, 4.1.7 wanted/latest. [VERIFIED: npm outdated] |
| Config file | `tests/config/vitest.unit.config.ts`, `tests/config/vitest.macro-framework.config.ts`, `tests/config/vitest.preflight.config.ts`. [VERIFIED: codebase read] |
| Quick run command | `npm test -- --run tests/unit/macro-parser.test.ts` plus `npm run typecheck && npm run lint`. [VERIFIED: package.json] |
| Full suite command | `npm run test:macro-framework && npm run preflight`. [VERIFIED: package.json] [CITED: mandatory test plan] |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REQ-006 / T-U-013 | Macro parser remains stable after Chevrotain upgrade | unit | `npm test -- --run tests/unit/macro-parser.test.ts` | Yes. [VERIFIED: codebase read] |
| REQ-006 / T-U-014 | Macro framework remains stable after dependency updates | framework | `npm run test:macro-framework` | Yes. [VERIFIED: tests/macro-framework/README.md] |
| REQ-006 / T-C-001 | Full audit clean or documented | command | `npm audit` | Yes. [CITED: mandatory test plan] |
| REQ-006 / T-C-002 | Production audit clean or documented | command | `npm audit --omit=dev` | Yes. [CITED: mandatory test plan] |
| REQ-006 / T-C-003 | Wanted drift empty or documented | command | `npm outdated` | Yes. [CITED: mandatory test plan] |
| REQ-006 / T-C-004 | Type/lint clean | command | `npm run typecheck && npm run lint` | Yes. [VERIFIED: package.json] |
| REQ-007 / T-C-005 | Knip runs with project config | command | `npm run knip` | No script yet; Wave 0 gap. [VERIFIED: package.json] |
| REQ-007 / T-C-006 | Preflight includes Knip or staged script | command | `npm run preflight` | Script exists, Knip not yet included; Wave 0 gap. [VERIFIED: package.json] |
| REQ-007 / T-U-015 | Knip excludes required paths | unit/static | `npm test -- --run tests/unit/knip-config.test.ts` | Missing; Wave 0 gap if config is testable. [CITED: mandatory test plan] |

### Sampling Rate
- **Per task commit:** `npm run typecheck && npm run lint` and the focused command relevant to the task. [CITED: mandatory test plan]
- **After non-major update lane:** `npm run typecheck && npm run lint && npm test -- --run tests/unit/macro-parser.test.ts`. [CITED: mandatory test plan]
- **After Chevrotain lane:** `npm test -- --run tests/unit/macro-parser.test.ts && npm run test:macro-framework`. [CITED: mandatory test plan]
- **After Knip lane:** `npm run knip && npm run preflight`. [CITED: mandatory test plan]
- **Phase gate:** `npm audit && npm audit --omit=dev && npm outdated && npm run typecheck && npm run lint && npm run knip && npm run preflight`, with documented exceptions for any remaining audit/outdated/preflight issue. [CITED: mandatory test plan]

### Wave 0 Gaps
- [ ] Add `knip` devDependency and `npm run knip`. [CITED: mandatory requirements]
- [ ] Add `knip.ts` or equivalent config with required exclusions and reachability policy. [CITED: mandatory requirements]
- [ ] Add `tests/unit/knip-config.test.ts` if practical; otherwise include a static source assertion in the plan summary. [CITED: mandatory test plan]
- [ ] Decide whether to update or document `tests/macro-framework/macro-golden-model` Chevrotain 11 audit state. [VERIFIED: shell]
- [ ] Decide MCP SDK update vs deferral based on current typed wrapper state at implementation start. [CITED: mandatory requirements]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | No direct auth change | Do not alter MCP auth behavior in this phase. [CITED: mandatory requirements] |
| V3 Session Management | No | MCP remains stateless; no server-side session state. [CITED: AGENTS.md] |
| V4 Access Control | No direct behavior change | Avoid source refactors beyond package/tooling drift. [CITED: mandatory requirements] |
| V5 Input Validation | Yes, indirectly | Use existing TypeScript/Vitest gates; Knip config should be typed if TS. [CITED: knip.dev] |
| V6 Cryptography | No direct crypto change | Do not hand-roll cryptographic or advisory logic; use npm audit. [CITED: npm docs] |
| V14 Configuration | Yes | Add explicit Knip exclusions and preflight/staged rollout policy. [CITED: mandatory requirements] |

### Known Threat Patterns for Node.js Dependency Hygiene

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Known vulnerable dependency remains in production tree | Elevation of Privilege / Tampering | `npm audit --omit=dev`, update direct parents, document any residual advisory. [CITED: npm docs] [CITED: mandatory requirements] |
| Supply-chain package confusion | Tampering | Verify package with official docs/Context7, npm registry metadata, slopcheck, and no suspicious postinstall script. [VERIFIED: npm registry] [VERIFIED: slopcheck] |
| Static analysis noise hides real unused exports/deps | Information Quality / Maintainability | Use explicit Knip config, production mode when needed, and targeted ignore lists. [CITED: knip.dev] |
| Major dependency upgrade changes parser behavior | Tampering / Reliability | Isolate Chevrotain 12 and run macro parser/framework tests. [CITED: mandatory test plan] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/147-tooling-and-dependency-hygiene/147-CONTEXT.md` - locked phase decisions and canonical refs. [VERIFIED: codebase read]
- Mandatory requirements doc - REQ-006/REQ-007 acceptance criteria and phase scope. [VERIFIED: codebase read]
- Mandatory test plan - T-U-013..015 and T-C-001..006. [VERIFIED: codebase read]
- `package.json`, `package-lock.json`, `tests/macro-framework/README.md`, `tests/unit/macro-parser.test.ts` - current scripts, dependencies, and test surface. [VERIFIED: codebase read]
- Context7 `/websites/knip_dev` - Knip production mode, TS config, ignore options, script parsing. [CITED: knip.dev]
- Context7 `/chevrotain/chevrotain` - Chevrotain ESM and breaking changes docs. [CITED: Chevrotain docs]
- Context7 `/modelcontextprotocol/typescript-sdk` - `registerTool` current API examples. [CITED: MCP TypeScript SDK docs]
- npm registry commands and npm downloads API for package versions, metadata, downloads, postinstall checks. [VERIFIED: npm registry]

### Secondary (MEDIUM confidence)
- npm docs search results for `npm audit` and `npm outdated` command behavior. [CITED: docs.npmjs.com]
- Local `.agents/skills/pre-push/SKILL.md`, `.agents/skills/flashquery-directed-run/SKILL.md`, `.agents/skills/flashquery-integration-run/SKILL.md` for project skill conventions. [VERIFIED: codebase read]

### Tertiary (LOW confidence)
- None used as authoritative input.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - package names and versions verified through Context7/official docs, npm registry, slopcheck, and local package state.
- Architecture: HIGH - constrained by mandatory phase docs and current code/package scripts.
- Pitfalls: MEDIUM-HIGH - major risks are verified by requirements and current audit output; output-noise severity depends on the actual first Knip run.

**Research date:** 2026-05-24  
**Valid until:** 2026-05-31 for versions/audit state; 2026-06-23 for architecture constraints if phase docs do not change.
