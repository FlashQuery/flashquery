---
type: macro-framework-failure
status: invalidated
classification: engine-bug
confidence: low
test_id: mtf-e-10-intentional-mismatch
test_file: cases/errors/_intentional-mismatch-fake-expected-result.yml
covers: ["MTF-E-003", "MTF-FW-001"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-18T23:58:16.730Z"
created_by: macro-framework-runner (Phase 3 draft)
reviewed_by: Phase 6 folder review (2026-05-19)
escalated_to: 
related_failures: []
---

## Triage classification rationale

**INVALIDATED 2026-05-19 (Phase 6 folder review):** Pre-Phase-6 record. Test is now a `comparison: match_some` self-test; declared divergences are expected and per §9.6 no record should be emitted. Phase 6 runner correctly gates record writes behind `!cmp.ok`. Record retained for git history per §9.6 lifecycle policy.

Comparator emitted 1 structured finding(s) (per INV-MTF-07: structured-field comparison only). First-pass heuristic classifies this as engine-bug; Phase 6's run skill will re-classify across the five §5.8 categories.

## Expected vs. Actual

Comparator findings (structured fields only):

```json
[
  {
    "field": "return_result",
    "expected": {
      "sum": 999
    },
    "actual": {
      "sum": 10
    }
  }
]
```

Actual production payload:

```json
{
  "task_id": "1bfa5837-3a02-4e70-8d62-b1ed37cf13ee",
  "result": {
    "sum": 10
  },
  "trace": [
    {
      "kind": "exit",
      "result": {
        "sum": 10
      },
      "at": "2026-05-18T23:58:16.729Z"
    }
  ]
}
```

## Golden's perspective

```
step | kind        | summary
-----+-------------+--------------------------------------------------------
   1 | ast         | assignment @ line 2 col 0
   2 | binding     | set: total = 0 (local)
   3 | loop        | for/for_loop_5 iter=0 var=i value=1
   4 | ast         | for_iter @ line 3 col 0
   5 | binding     | shadow: i = 1 (local)
   6 | ast         | assignment @ line 4 col 0
   7 | binding     | update: total = 1 (outer)
   8 | loop        | for/for_loop_5 iter=1 var=i value=2
   9 | ast         | for_iter @ line 3 col 0
  10 | binding     | shadow: i = 2 (local)
  11 | ast         | assignment @ line 4 col 0
  12 | binding     | update: total = 3 (outer)
  13 | loop        | for/for_loop_5 iter=2 var=i value=3
  14 | ast         | for_iter @ line 3 col 0
  15 | binding     | shadow: i = 3 (local)
  16 | ast         | assignment @ line 4 col 0
  17 | binding     | update: total = 6 (outer)
  18 | loop        | for/for_loop_5 iter=3 var=i value=4
  19 | ast         | for_iter @ line 3 col 0
  20 | binding     | shadow: i = 4 (local)
  21 | ast         | assignment @ line 4 col 0
  22 | binding     | update: total = 10 (outer)
```

## Suggested remediation

Compare the structured payload above to the embedded `expect:` block in the test YAML. Determine whether the divergence is an engine regression (fix engine; keep expectations) or an embedded-expectation drift (refresh via testgen). The comparator finding `field` names point at the exact assertion the production output failed.

## Action log

- 2026-05-18T23:58:16.730Z — auto-classified by macro-framework-runner (Phase 3 draft)
