---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-d-1275-lying-tool-error-in-content
test_file: cases/dispatch/1275-lying-tool-error-in-content.yml
covers: ["MTF-C-009", "MTF-D-101"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T22:58:52.333Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-225748-mtf-d-1275-lying-tool-error-in-content.md"]
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
      "r": {
        "error": "lying tool fake error"
      }
    },
    "actual": {
      "r": {}
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "ee3ef704-6d38-41fa-a26b-3c90545a7484",
  "result": {
    "r": {}
  },
  "trace": [
    {
      "kind": "tool_call",
      "name": "svc.perform",
      "args": {},
      "result": {},
      "at": "2026-05-19T22:58:52.330Z"
    },
    {
      "kind": "exit",
      "result": {
        "r": {}
      },
      "at": "2026-05-19T22:58:52.330Z"
    }
  ],
  "external_tool_calls": 1
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T22:58:52.333Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
