---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-e-1120-runtime-chained-through-null
test_file: cases/errors/1120-runtime-chained-through-null.yml
covers: ["MTF-E-005"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T22:49:53.933Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (error.code) that the production evaluator computes directly. No `golden_snapshot.state_notes` embedded, so the engine-bug call rests on the structural-field signal alone — low confidence. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "error.code",
    "expected": "type_error",
    "actual": "tool_call_failed"
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "tool_call_failed",
  "message": "Cannot access .subfield on null.",
  "details": {
    "reason": "invalid_field_target",
    "field": "subfield"
  }
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the error.code surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T22:49:53.933Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
