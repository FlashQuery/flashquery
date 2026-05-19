---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-l-805-exists-varref-in-if-direct
test_file: cases/lifecycle/805-exists-varref-in-if-direct.yml
covers: ["MTF-L-101", "MTF-L-102", "MTF-L-103"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T14:09:00.995Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-140850-mtf-l-805-exists-varref-in-if-direct.md"]
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
    "detail": "payload.error = \"parse_error\"; payload = {\"error\":\"parse_error\",\"message\":\"Expected \\\"then\\\" after if condition.\",\"details\":{\"reason\":\"missing_then\",\"at_line\":3,\"near_token\":\"(\"}}"
  },
  {
    "field": "return_result",
    "expected": {
      "v": "present"
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "parse_error",
  "message": "Expected \"then\" after if condition.",
  "details": {
    "reason": "missing_then",
    "at_line": 3,
    "near_token": "("
  }
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the outcome, return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T14:09:00.995Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
