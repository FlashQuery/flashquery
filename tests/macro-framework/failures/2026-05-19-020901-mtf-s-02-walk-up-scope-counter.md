---
type: macro-framework-failure
status: invalidated
classification: engine-bug
confidence: medium
test_id: mtf-s-02-walk-up-scope-counter
test_file: cases/semantics/02-walk-up-scope-counter.yml
covers: ["MTF-S-001", "MTF-S-002", "MTF-C-001", "MTF-S-003"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T02:09:01.563Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (return_result) that the production evaluator computes directly. The embedded `golden_snapshot.state_notes` shows the golden reaching the expected value, so the divergence is on the production-engine side. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "return_result",
    "expected": {
      "total": 16,
      "n_iters": 5
    },
    "actual": {
      "total": 15,
      "n_iters": 5
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "6a240f3b-f3a0-45d5-b4c9-8257fc57df2c",
  "result": {
    "total": 15,
    "n_iters": 5
  },
  "trace": [
    {
      "kind": "exit",
      "result": {
        "total": 15,
        "n_iters": 5
      },
      "at": "2026-05-19T02:09:01.562Z"
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
   3 | ast         | assignment @ line 3 col 0
   4 | binding     | set: n_iters = 0 (local)
   5 | loop        | for/for_loop_1 iter=0 var=i value=1
   6 | ast         | for_iter @ line 4 col 0
   7 | binding     | shadow: i = 1 (local)
   8 | ast         | assignment @ line 5 col 0
   9 | binding     | update: total = 1 (outer)
  10 | ast         | assignment @ line 6 col 0
  11 | binding     | update: n_iters = 1 (outer)
  12 | loop        | for/for_loop_1 iter=1 var=i value=2
  13 | ast         | for_iter @ line 4 col 0
  14 | binding     | shadow: i = 2 (local)
  15 | ast         | assignment @ line 5 col 0
  16 | binding     | update: total = 3 (outer)
  17 | ast         | assignment @ line 6 col 0
  18 | binding     | update: n_iters = 2 (outer)
  19 | loop        | for/for_loop_1 iter=2 var=i value=3
  20 | ast         | for_iter @ line 4 col 0
  21 | binding     | shadow: i = 3 (local)
  22 | ast         | assignment @ line 5 col 0
  23 | binding     | update: total = 6 (outer)
  24 | ast         | assignment @ line 6 col 0
  25 | binding     | update: n_iters = 3 (outer)
  26 | loop        | for/for_loop_1 iter=3 var=i value=4
  27 | ast         | for_iter @ line 4 col 0
  28 | binding     | shadow: i = 4 (local)
  29 | ast         | assignment @ line 5 col 0
  30 | binding     | update: total = 10 (outer)
  31 | ast         | assignment @ line 6 col 0
  32 | binding     | update: n_iters = 4 (outer)
  33 | loop        | for/for_loop_1 iter=4 var=i value=5
  34 | ast         | for_iter @ line 4 col 0
  35 | binding     | shadow: i = 5 (local)
  36 | ast         | assignment @ line 5 col 0
  37 | binding     | update: total = 15 (outer)
  38 | ast         | assignment @ line 6 col 0
  39 | binding     | update: n_iters = 5 (outer)
```

## Suggested remediation

Investigate the macro engine code path responsible for the return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T02:09:01.563Z — auto-classified by flashquery-macro-run (engine-bug, medium confidence)
- 2026-05-19T02:09:30.000Z — invalidated: this record was produced as part of Phase 6 Scenario B validation (temporary edit of test's `expect.return_result.total` from 15 to 16, keeping `golden_version: "0.3.0"`). The pilot was reverted; the classification heuristic worked as designed (engine-bug chosen since hand-authored + golden in sync + structural finding on `return_result`). Record preserved as historical evidence per §9.6 lifecycle.
- 2026-05-19T02:10:29.031Z — re-triage via flashquery-macro-run: test now PASSES (golden v0.3.0)
