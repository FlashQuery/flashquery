---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-s-920-missing-field-returns-null
test_file: cases/semantics/920-missing-field-returns-null.yml
covers: ["MTF-S-102"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T15:11:15.740Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-145355-mtf-s-920-missing-field-returns-null.md", "2026-05-19-145543-mtf-s-920-missing-field-returns-null.md", "2026-05-19-151043-mtf-s-920-missing-field-returns-null.md", "2026-05-19-151052-mtf-s-920-missing-field-returns-null.md"]
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
    "detail": "payload.error = \"tool_call_failed\"; payload = {\"error\":\"tool_call_failed\",\"message\":\"Missing field .does_not_exist.\",\"details\":{\"reason\":\"missing_field\",\"field\":\"does_not_exist\"}}"
  },
  {
    "field": "return_result",
    "expected": {
      "v": null
    }
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "tool_call_failed",
  "message": "Missing field .does_not_exist.",
  "details": {
    "reason": "missing_field",
    "field": "does_not_exist"
  }
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Investigate the macro engine code path responsible for the outcome, return_result surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T15:11:15.740Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
