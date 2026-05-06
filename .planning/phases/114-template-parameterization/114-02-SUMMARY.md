---
phase: 114-template-parameterization
plan: 02
subsystem: llm
tags: [reference_resolver, template_params, fq_template, vitest]

requires:
  - phase: 114-template-parameterization
    provides: RED resolver template contracts from Plan 01
provides:
  - Path-keyed fq_template rendering in resolveReferences
  - String and document template parameter validation with typed failures
  - Escape-aware single-pass template substitution and additive injected reference metadata
affects: [reference-resolver, call_model, template-parameterization]

tech-stack:
  added: []
  patterns: [resolver-owned template rendering, additive metadata widening, one-pass right-to-left substitution]

key-files:
  created:
    - .planning/phases/114-template-parameterization/114-02-SUMMARY.md
  modified:
    - src/llm/reference-resolver.ts
    - src/llm/types.ts

key-decisions:
  - "Kept template rendering inside src/llm/reference-resolver.ts and reused resolveAndBuildDocument for document params."
  - "Requested frontmatter during body reference resolution so only fq_template true documents enter template rendering."

patterns-established:
  - "Template params are path-keyed or alias-keyed and reserved fields are stripped before declaration validation."
  - "Template placeholder rendering scans original template body once, then applies replacements right-to-left."

requirements-completed: [TMPL-01, TMPL-03, TMPL-04]

duration: 6m26s
completed: 2026-05-06
---

# Phase 114 Plan 02: Template Parameterization Resolver Summary

**Path-keyed fq_template rendering with required/default/type validation, document param hydration, escape-aware single-pass substitution, and template metadata**

## Performance

- **Duration:** 6m26s
- **Started:** 2026-05-06T00:41:42Z
- **Completed:** 2026-05-06T00:48:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Extended `resolveReferences` with optional `templateParams?: TemplateParamsInput` and resolver-owned template helpers.
- Implemented `fq_template: true` detection, `fq_params` normalization, required/default/type validation, and `document` param resolution through `resolveAndBuildDocument`.
- Added `renderTemplateContent` with escape parity, right-to-left single-pass replacement, and non-recursive substitution behavior.
- Widened `CallModelMetadata.injected_references` to `InjectedReferenceMetadata[]` while preserving `ref`, `chars`, and `resolved_to`.

## Task Commits

1. **Task 1: Add resolver template contracts and metadata types** - `e495184` (feat)
2. **Task 2: Implement path-keyed template rendering and param validation** - `e495184` (feat)

**Plan metadata:** pending final docs commit

## Files Created/Modified

- `src/llm/reference-resolver.ts` - Added template contracts, metadata shaping, template detection, param validation, document param hydration, alias/list handling, and one-pass rendering.
- `src/llm/types.ts` - Widened `CallModelMetadata.injected_references` to the new metadata type without staging unrelated local message-type refinements.
- `.planning/phases/114-template-parameterization/114-02-SUMMARY.md` - Execution summary.

## Verification

- `npm test -- tests/unit/reference-resolver.test.ts` - passed, 74 tests.
- Acceptance grep checks passed for exported template contracts, optional resolver argument, metadata widening, failure reasons, `fq_template`/`fq_params`, string/document handling, and right-to-left replacement.

## Decisions Made

- Plain documents branch only when `fq_template === true`; otherwise `templateParams` are ignored and existing body reference behavior is preserved.
- Document params are resolved through the existing document ladder with `effectiveInclude: ['body']`; failures are mapped to `template_param_doc_not_found`.
- Reserved `_template`, `_items`, and `_separator` fields are stripped before param validation and metadata generation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added fallback for stale replacement spans**
- **Found during:** Task 2 (template rendering verification)
- **Issue:** A Plan 01 alias test supplied a replacement span that was off by one, leaving a literal `{` in hydrated content.
- **Fix:** `hydrateMessages` now validates that a position span still points at the expected placeholder before using it; otherwise it falls back to placeholder lookup.
- **Files modified:** `src/llm/reference-resolver.ts`
- **Verification:** `npm test -- tests/unit/reference-resolver.test.ts`
- **Committed in:** `e495184`

---

**Total deviations:** 1 auto-fixed (Rule 1)
**Impact on plan:** The fix preserves existing position-aware hydration while making it tolerant of stale caller/test spans.

## Issues Encountered

- Task 1 and Task 2 landed in one implementation commit because the exported metadata contracts, resolver signature, helper functions, and rendering path were tightly coupled by TypeScript and the RED tests. No unrelated dirty hunks were staged.

## Known Stubs

None. The scan found `placeholder` only in resolver comments, field names, and template placeholder handling code.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Plan 03 can build on path-keyed template resolution. Alias/list behavior is already partially implemented by the resolver tests, while MCP `call_model.template_params` schema/wiring remains for a later Phase 114 plan.

## Self-Check: PASSED

- Created summary exists: `.planning/phases/114-template-parameterization/114-02-SUMMARY.md`
- Task commit found: `e495184`
- No tracked file deletions were introduced by the task commit.

---
*Phase: 114-template-parameterization*
*Completed: 2026-05-06*
