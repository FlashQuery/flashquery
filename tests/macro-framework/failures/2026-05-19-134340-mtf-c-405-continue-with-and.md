---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-c-405-continue-with-and
test_file: cases/control-flow/405-405-continue-with-and.yml
covers: ["MTF-C-101"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T13:43:40.725Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-134332-mtf-c-405-continue-with-and.md"]
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (return_result) that the production evaluator computes directly. No `golden_snapshot.state_notes` embedded, so the engine-bug call rests on the structural-field signal alone — low confidence. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "return_result",
    "expected": {
      "sum": 35
    },
    "actual": {
      "sum": 43
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "222da2de-1ae1-4f3c-97cc-19c5f99cc3aa",
  "result": {
    "sum": 43
  },
  "trace": [
    {
      "kind": "exit",
      "result": {
        "sum": 43
      },
      "at": "2026-05-19T13:43:40.723Z"
    }
  ]
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T13:43:40.725Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
