---
phase: 113-document-reference-system-core
plan: 01
subsystem: testing
tags: [reference-resolver, call-model, validation, vitest]
requires:
  - phase: 112-chat-primitive-envelope-migration
    provides: round-trippable call_model message envelope and return_messages behavior
provides:
  - Reference failure reason constants contract
  - Phase 113 parser, escape, ambiguity, and failure mapping unit tests
affects: [reference-resolver, call-model, phase-114-templates]
tech-stack:
  added: []
  patterns: [contract-first reference resolver tests, stable failure reason taxonomy]
key-files:
  created: [src/constants/reference-failures.ts]
  modified: [tests/unit/reference-resolver.test.ts, tests/unit/resolve-document.test.ts]
key-decisions:
  - "{{id:...}} is literal text for ATL v1; fq_id lookup uses {{ref:<fq_id>}}."
  - "Reference failures expose stable reason codes plus human-readable detail."
patterns-established:
  - "Reference resolver tests pin grammar and span semantics before implementation."
requirements-completed: [REF-01, REF-02, REF-03, REF-04, REF-05, REF-06, REF-07, REF-08, VAL-113]
duration: unknown
completed: 2026-05-05
---

# Phase 113-01: Reference Contract Summary

**Reference failure constants and contract tests for ATL v1 placeholder grammar**

## Accomplishments

- Added the canonical `ReferenceFailureReason` runtime list and TypeScript union.
- Expanded resolver tests for `{{ref:...}}` grammar, escape parity, literal `{{id:...}}`, ambiguity guidance, and typed failure metadata.
- Tightened `resolve-document` ambiguity expectations to require path or `fq_id` guidance.

## Task Commits

1. **Reference constants and unit contracts** - `11d343f` (test)

## Verification

- Initial focused tests failed as expected before implementation.
- Later Phase 113 focused gates passed with these contracts included.

## Deviations from Plan

None - followed the contract-first plan.
