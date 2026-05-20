---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-s-1146-numeric-mod-negative-dividend
test_file: cases/semantics/1146-numeric-mod-negative-dividend.yml
covers: ["MTF-C-009", "MTF-N-005"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T22:52:11.575Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
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
      "n": -1
    },
    "actual": {
      "n": 2
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "ee9af717-c205-46b5-b226-e0e2b4accb5c",
  "result": {
    "n": 2
  },
  "trace": [
    {
      "kind": "exit",
      "result": {
        "n": 2
      },
      "at": "2026-05-19T22:52:11.571Z"
    }
  ]
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T22:52:11.575Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
