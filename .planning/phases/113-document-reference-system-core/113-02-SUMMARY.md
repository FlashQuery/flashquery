---
phase: 113-document-reference-system-core
plan: 02
subsystem: llm
tags: [reference-resolver, span-scanner, hydration, metadata]
requires:
  - phase: 113-document-reference-system-core
    provides: 113-01 reference resolver contract tests
provides:
  - Span-aware reference scanner with escape parity
  - Typed reference parse and resolution failure mapping
  - Non-recursive hydration helpers and injected reference metadata
affects: [call-model, phase-114-templates, phase-120-validation]
tech-stack:
  added: []
  patterns: [span-captured replacements, fail-fast typed failure mapping]
key-files:
  created: []
  modified: [src/llm/reference-resolver.ts, src/llm/types.ts]
key-decisions:
  - "Only {{ref:...}} creates active references; legacy {{id:...}} is ignored by the scanner."
  - "Hydration replaces captured spans instead of searching placeholder text globally."
  - "Unknown resolver errors fall back to unknown_reference_error and are logged."
patterns-established:
  - "Reference failure reasons are normalized at the resolver boundary."
requirements-completed: [REF-01, REF-02, REF-03, REF-04, REF-05, REF-06, REF-07, REF-08, VAL-113]
duration: unknown
completed: 2026-05-05
---

# Phase 113-02: Resolver Core Summary

**Span-aware `{{ref:...}}` resolver with typed failures and non-recursive hydration**

## Accomplishments

- Replaced regex placeholder discovery with an explicit scanner that records spans and escape parity.
- Implemented parser rejection for invalid alias/section/pointer combinations and malformed operators.
- Mapped document resolution failures to stable `ReferenceFailureReason` values with `detail`.
- Added metadata support for resolved identifiers and `resolved_to` pointer targets.

## Task Commits

1. **Resolver core implementation** - `c4df206` (feat)

## Verification

- `npm test -- tests/unit/reference-resolver.test.ts tests/unit/resolve-document.test.ts` passed 78/78.

## Deviations from Plan

None - implementation stayed inside the resolver and type contracts.
