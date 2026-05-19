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
failed_at: "2026-05-19T13:43:40.770Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-134332-mtf-d-605-nested-loop-tool-calls.md"]
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
  "task_id": "4f6d161c-f472-4682-96b4-2b353c20b74a",
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
      "at": "2026-05-19T13:43:40.769Z"
    },
    {
      "kind": "tool_call",
      "name": "jt.get",
      "args": {},
      "result": {
        "n": 10
      },
      "at": "2026-05-19T13:43:40.769Z"
    },
    {
      "kind": "exit",
      "result": {
        "total": 20
      },
      "at": "2026-05-19T13:43:40.769Z"
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

- 2026-05-19T13:43:40.770Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
