---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-d-1277-coerce-then-field-access
test_file: cases/dispatch/1277-coerce-then-field-access.yml
covers: ["MTF-C-009", "MTF-D-101"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T22:57:48.181Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (outcome, return_result, side_effects.tool_call_count) that the production evaluator computes directly. No `golden_snapshot.state_notes` embedded, so the engine-bug call rests on the structural-field signal alone — low confidence. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "outcome",
    "expected": "success",
    "actual": "error",
    "detail": "payload.error = \"parse_error\"; payload = {\"error\":\"parse_error\",\"message\":\"Expected a newline between macro statements.\",\"details\":{\"reason\":\"unexpected_token\",\"at_line\":1,\"near_token\":\".\"}}"
  },
  {
    "field": "return_result",
    "expected": {
      "v": "on"
    }
  },
  {
    "field": "side_effects.tool_call_count",
    "expected": 1,
    "actual": 0
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "parse_error",
  "message": "Expected a newline between macro statements.",
  "details": {
    "reason": "unexpected_token",
    "at_line": 1,
    "near_token": "."
  }
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the outcome, return_result, side_effects.tool_call_count surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T22:57:48.181Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
