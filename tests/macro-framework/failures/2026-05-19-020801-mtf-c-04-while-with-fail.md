---
type: macro-framework-failure
status: invalidated
classification: stale-expectations
confidence: high
test_id: mtf-c-04-while-with-fail
test_file: cases/control-flow/04-while-with-fail.yml
covers: ["MTF-C-005", "MTF-C-006", "MTF-S-004"]
golden_version_used: 0.2.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T02:08:01.596Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Test's `golden_version: "0.2.0"` is older than the current golden (`0.3.0`). Per §5.8 this is checked first and is the cheapest classification — the embedded expectations may simply be out of date. No code change anywhere unless refresh confirms a regression.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "error.message_contains",
    "expected": "DELIBERATELY WRONG MESSAGE FOR SCENARIO A",
    "actual": "halt while at 7"
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "macro_aborted",
  "message": "halt while at 7",
  "details": {
    "line": 5
  }
}
```

## Golden's perspective

```
step | kind        | summary
-----+-------------+--------------------------------------------------------
   1 | ast         | assignment @ line 2 col 0
   2 | binding     | set: counter = 0 (local)
   3 | loop        | while/while_loop_3 iter=0 var=? value=undefined
   4 | ast         | assignment @ line 4 col 0
   5 | binding     | update: counter = 1 (outer)
   6 | ast         | if @ line 5 col 0
   7 | loop        | while/while_loop_3 iter=1 var=? value=undefined
   8 | ast         | assignment @ line 4 col 0
   9 | binding     | update: counter = 2 (outer)
  10 | ast         | if @ line 5 col 0
  11 | loop        | while/while_loop_3 iter=2 var=? value=undefined
  12 | ast         | assignment @ line 4 col 0
  13 | binding     | update: counter = 3 (outer)
  14 | ast         | if @ line 5 col 0
  15 | loop        | while/while_loop_3 iter=3 var=? value=undefined
  16 | ast         | assignment @ line 4 col 0
  17 | binding     | update: counter = 4 (outer)
  18 | ast         | if @ line 5 col 0
  19 | loop        | while/while_loop_3 iter=4 var=? value=undefined
  20 | ast         | assignment @ line 4 col 0
  21 | binding     | update: counter = 5 (outer)
  22 | ast         | if @ line 5 col 0
  23 | loop        | while/while_loop_3 iter=5 var=? value=undefined
  24 | ast         | assignment @ line 4 col 0
  25 | binding     | update: counter = 6 (outer)
  26 | ast         | if @ line 5 col 0
  27 | loop        | while/while_loop_3 iter=6 var=? value=undefined
  28 | ast         | assignment @ line 4 col 0
  29 | binding     | update: counter = 7 (outer)
  30 | ast         | if @ line 5 col 0
```

## Suggested remediation

Run `npm run testgen:macro-framework -- --mode=refresh --filter='mtf-c-04-while-with-fail' --auto-accept-identical` to regenerate the embedded snapshot against the current golden. If the refresh diff is structurally identical, the failure auto-resolves. If divergent, escalate as a possible engine-bug or golden-bug.

## Action log

- 2026-05-19T02:08:01.596Z — auto-classified by flashquery-macro-run (stale-expectations, high confidence)
- 2026-05-19T02:08:30.000Z — invalidated: this record was produced as part of Phase 6 Scenario A validation (temporary edit of test's `golden_version` to "0.2.0" + intentionally-wrong `message_contains`). The pilot was reverted; the classification heuristic worked as designed (stale-expectations chosen first, high confidence). Record preserved as historical evidence per §9.6 lifecycle.
