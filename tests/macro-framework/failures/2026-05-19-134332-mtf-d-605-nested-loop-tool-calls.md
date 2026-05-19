---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-d-605-nested-loop-tool-calls
test_file: cases/dispatch/605-605-nested-loop-tool-calls.yml
covers: ["MTF-D-101"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T13:43:32.055Z"
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
      "total": 30
    },
    "actual": {
      "total": 20
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "46997cc8-462c-48b2-a921-3aaf699c119a",
  "result": {
    "total": 20
  },
  "trace": [
    {
      "kind": "tool_call",
      "name": "jt.get",
      "args": {},
      "result": {
        "n": 10
      },
      "at": "2026-05-19T13:43:32.054Z"
    },
    {
      "kind": "tool_call",
      "name": "jt.get",
      "args": {},
      "result": {
        "n": 10
      },
      "at": "2026-05-19T13:43:32.054Z"
    },
    {
      "kind": "exit",
      "result": {
        "total": 20
      },
      "at": "2026-05-19T13:43:32.054Z"
    }
  ],
  "external_tool_calls": 2
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T13:43:32.055Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
