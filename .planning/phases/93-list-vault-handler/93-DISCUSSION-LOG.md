# Phase 93: `list_vault` Handler — Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 93-list-vault-handler
**Areas discussed:** Plan Structure

---

## Plan Structure

| Option | Description | Selected |
|--------|-------------|----------|
| 1 plan (like Phase 92) | Single PLAN.md covering unit tests → handler → directed tests in sequence | |
| 2 plans | Plan 1: unit tests + handler (3A+3B). Plan 2: directed scenario tests (3C, ~60 steps) | ✓ |
| 3 plans (TDD-strict) | Plan 1: unit tests only. Plan 2: handler. Plan 3: directed tests | |

**User's choice:** 2 plans
**Notes:** Plan 1 covers unit tests for internal logic + handler implementation (TDD ordering: tests first, then make them pass). Plan 2 covers all 7 directed scenario test files. F-51 un-skip included in Plan 2.

---

## Pre-resolved from Documentation

All items below were resolved in the requirements doc and dev plan before the discussion session:

| Decision | Resolution |
|----------|-----------|
| Write lock needed? | No — read operation (OQ-1 pattern) |
| Supabase access pattern | `supabaseManager.getClient()` inside handler; no signature change |
| Non-existent path behavior | `isError: true` — behavior change from old `list_files` |
| Target dir in results? | No — follows `ls`/`readdir` semantics (OQ-3) |
| `limit` applies to combined list? | Yes — sort everything, take first N (OQ-6) |
| DB enrichment batch size | Chunks of 100 (OQ-4) |
| `extensions` with `show: "directories"` | Silently ignored with debug log |
| Invalid date string handling | `null` from parseDateFilter → `isError: true` (OQ-2 fix) |
| F-51 activation | Remove skip annotation in Plan 2 |

## Claude's Discretion

- Recursive walk implementation (generator, recursive, or queue-based)
- Whether to extract internal helpers (walk, enrich, sort, serialize) into named functions
- Filter composition approach (one pass vs. separate passes)

## Deferred Ideas

None.
