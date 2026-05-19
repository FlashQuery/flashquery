---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-d-910-smoke-failover-primary-reachable
test_file: cases/dispatch/910-smoke-failover-primary-reachable.yml
covers: ["MTF-L-101", "MTF-S-101", "MTF-D-101", "MTF-C-009"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T17:29:10.557Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (outcome, return_result) that the production evaluator computes directly. No `golden_snapshot.state_notes` embedded, so the engine-bug call rests on the structural-field signal alone — low confidence. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "outcome",
    "expected": "success",
    "actual": "error",
    "detail": "payload.error = \"unknown_server\"; payload = {\"error\":\"unknown_server\",\"message\":\"Unknown tool server 'backup_srv'.\",\"details\":{\"server\":\"backup_srv\",\"unknown\":[\"backup_srv.fetch\"]}}"
  },
  {
    "field": "return_result",
    "expected": {
      "path": "primary",
      "data": {
        "records": 42,
        "status": "ok"
      },
      "backup_needed": false
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "unknown_server",
  "message": "Unknown tool server 'backup_srv'.",
  "details": {
    "server": "backup_srv",
    "unknown": [
      "backup_srv.fetch"
    ]
  }
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the outcome, return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T17:29:10.557Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
