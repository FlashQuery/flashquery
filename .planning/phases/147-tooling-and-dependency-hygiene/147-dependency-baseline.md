# Phase 147 Dependency Baseline

**Plan:** 147-01  
**Captured:** 2026-05-24T16:18:47Z  
**Purpose:** Record npm audit and wanted-version drift before dependency metadata changes, then record the post-`npm update` state for the non-major update lane.

## Scope Guard

This first lane intentionally applies only wanted non-major updates through `npm update`.

- `chevrotain` remains on the 11.x line in this plan. The `chevrotain` 12 major upgrade is deferred to the isolated Phase 147 parser lane.
- `@modelcontextprotocol/sdk` is not updated in this plan. MCP SDK handling is deferred to the later Phase 147 decision lane, after or with typed/static visibility for `registerTool` drift.
- `npm audit fix --force` was not used.

## T-C-001: `npm audit` Pre-Update

- **Command:** `npm audit`
- **Timestamp:** 2026-05-24T16:18:47Z
- **Exit code:** 1
- **Result:** 13 vulnerabilities: 7 moderate, 6 high.

### Advisory Summary

| Package | Severity | Notes |
|---------|----------|-------|
| `brace-expansion` | moderate | Large numeric range DoS. |
| `fast-uri` | high | Percent-encoded path traversal and host-confusion advisories. |
| `hono` | moderate | Multiple JSX/JWT/cache/body-limit advisories. |
| `ip-address` / `express-rate-limit` | moderate | HTML-emitting method XSS through `ip-address`. |
| `lodash-es` / `@chevrotain/*` / `chevrotain` | high | Fix requires `chevrotain@12.0.0`, a breaking major update deferred out of this lane. |
| `qs` | moderate | `qs.stringify` DoS advisory. |
| `simple-git` | high | Remote code execution advisory, fix available within wanted non-major range. |
| `uuid` | moderate | Missing bounds check advisory, fix available within wanted non-major range. |
| `ws` | moderate | Uninitialized memory disclosure advisory. |

### JSON Metadata Snapshot

```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 7,
    "high": 6,
    "critical": 0,
    "total": 13
  },
  "advisoryNames": [
    "@chevrotain/cst-dts-gen",
    "@chevrotain/gast",
    "brace-expansion",
    "chevrotain",
    "express-rate-limit",
    "fast-uri",
    "hono",
    "ip-address",
    "lodash-es",
    "qs",
    "simple-git",
    "uuid",
    "ws"
  ]
}
```

## T-C-002: `npm audit --omit=dev` Pre-Update

- **Command:** `npm audit --omit=dev`
- **Timestamp:** 2026-05-24T16:18:47Z
- **Exit code:** 1
- **Result:** 12 production-tree vulnerabilities: 6 moderate, 6 high.

### Advisory Summary

Production-tree advisories were the full-tree advisory set minus dev-only `brace-expansion`.

```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 6,
    "high": 6,
    "critical": 0,
    "total": 12
  },
  "advisoryNames": [
    "@chevrotain/cst-dts-gen",
    "@chevrotain/gast",
    "chevrotain",
    "express-rate-limit",
    "fast-uri",
    "hono",
    "ip-address",
    "lodash-es",
    "qs",
    "simple-git",
    "uuid",
    "ws"
  ]
}
```

## T-C-003: `npm outdated` Pre-Update

- **Command:** `npm outdated`
- **Timestamp:** 2026-05-24T16:18:47Z
- **Exit code:** 1
- **Result:** Wanted drift was present for 13 packages; `chevrotain` had no wanted drift but latest was v12.

| Package | Current | Wanted | Latest | Lane |
|---------|---------|--------|--------|------|
| `@supabase/supabase-js` | 2.100.0 | 2.106.1 | 2.106.1 | non-major wanted |
| `@types/node` | 25.5.0 | 25.9.1 | 25.9.1 | non-major wanted |
| `chevrotain` | 11.2.0 | 11.2.0 | 12.0.0 | deferred major |
| `dotenv` | 17.3.1 | 17.4.2 | 17.4.2 | non-major wanted |
| `eslint` | 10.1.0 | 10.4.0 | 10.4.0 | non-major wanted |
| `pg` | 8.20.0 | 8.21.0 | 8.21.0 | non-major wanted |
| `prettier` | 3.8.1 | 3.8.3 | 3.8.3 | non-major wanted |
| `simple-git` | 3.33.0 | 3.36.0 | 3.36.0 | non-major wanted |
| `tsx` | 4.21.0 | 4.22.3 | 4.22.3 | non-major wanted |
| `typescript` | 6.0.2 | 6.0.3 | 6.0.3 | non-major wanted |
| `typescript-eslint` | 8.59.0 | 8.59.4 | 8.59.4 | non-major wanted |
| `uuid` | 13.0.0 | 13.0.2 | 14.0.0 | non-major wanted; latest major deferred |
| `vitest` | 4.1.1 | 4.1.7 | 4.1.7 | non-major wanted |
| `zod` | 4.3.6 | 4.4.3 | 4.4.3 | non-major wanted |

## After-Update Evidence

### Command Sequence

| Command | Exit code | Notes |
|---------|-----------|-------|
| `npm update` | 0 | Refreshed wanted non-major dependency graph and `package-lock.json`. |
| `npm install @modelcontextprotocol/sdk@1.27.1` | 0 | Corrected `npm update` refreshing the MCP SDK lockfile entry within the existing semver range; this preserves the plan's SDK deferral. |

`package.json` direct ranges did not change. `package-lock.json` remains `lockfileVersion: 3`.

### Changed Direct Package Installations

| Package | Pre-update installed | Post-update installed | Notes |
|---------|----------------------|-----------------------|-------|
| `@supabase/supabase-js` | 2.100.0 | 2.106.1 | wanted non-major |
| `dotenv` | 17.3.1 | 17.4.2 | wanted non-major |
| `pg` | 8.20.0 | 8.21.0 | wanted non-major |
| `simple-git` | 3.33.0 | 3.36.0 | resolves the pre-update `simple-git` high advisory |
| `uuid` | 13.0.0 | 13.0.2 | resolves the pre-update `uuid` moderate advisory; latest v14 remains out of scope |
| `zod` | 4.3.6 | 4.4.3 | wanted non-major |
| `@types/node` | 25.5.0 | 25.9.1 | wanted non-major |
| `eslint` | 10.1.0 | 10.4.0 | wanted non-major |
| `prettier` | 3.8.1 | 3.8.3 | wanted non-major |
| `tsx` | 4.21.0 | 4.22.3 | wanted non-major |
| `typescript` | 6.0.2 | 6.0.3 | wanted non-major |
| `typescript-eslint` | 8.59.0 | 8.59.4 | wanted non-major |
| `vitest` | 4.1.1 | 4.1.7 | wanted non-major |

### Deferred Direct Packages

| Package | Installed after update | Wanted | Latest | Rationale |
|---------|------------------------|--------|--------|-----------|
| `@modelcontextprotocol/sdk` | 1.27.1 | 1.29.0 | 1.29.0 | Deferred to later Phase 147 MCP SDK decision lane. |
| `chevrotain` | 11.2.0 | 11.2.0 | 12.0.0 | Deferred to isolated Phase 147 major parser lane. |
| `uuid` | 13.0.2 | 13.0.2 | 14.0.0 | Wanted drift is clear; latest-major drift remains intentionally out of this lane. |

### T-C-001: `npm audit` Post-Update

- **Command:** `npm audit`
- **Timestamp:** 2026-05-24T16:24:00Z
- **Exit code:** 1
- **Result:** 4 high vulnerabilities remain, all through the deferred Chevrotain 11 dependency chain.

```json
{
  "vulnerabilities": {
    "info": 0,
    "low": 0,
    "moderate": 0,
    "high": 4,
    "critical": 0,
    "total": 4
  },
  "advisoryNames": [
    "@chevrotain/cst-dts-gen",
    "@chevrotain/gast",
    "chevrotain",
    "lodash-es"
  ]
}
```

### T-C-002: `npm audit --omit=dev` Post-Update

- **Command:** `npm audit --omit=dev`
- **Timestamp:** 2026-05-24T16:24:00Z
- **Exit code:** 1
- **Result:** Same 4 high vulnerabilities remain in the production tree, all through the deferred Chevrotain 11 dependency chain.

### T-C-003: `npm outdated` Post-Update

- **Command:** `npm outdated`
- **Timestamp:** 2026-05-24T16:24:00Z
- **Exit code:** 1
- **Result:** Wanted drift remains only for `@modelcontextprotocol/sdk`, which is intentionally deferred by this plan. Latest-major drift remains for `chevrotain` and `uuid`.

| Package | Current | Wanted | Latest | Rationale |
|---------|---------|--------|--------|-----------|
| `@modelcontextprotocol/sdk` | 1.27.1 | 1.29.0 | 1.29.0 | deferred MCP SDK lane |
| `chevrotain` | 11.2.0 | 11.2.0 | 12.0.0 | deferred major parser lane |
| `uuid` | 13.0.2 | 13.0.2 | 14.0.0 | latest-major only after wanted remediation |
