---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: low
test_id: mtf-d-34-argument-passthrough
test_file: cases/dispatch/34-argument-passthrough.yml
covers: ["MTF-D-103"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T12:28:17.631Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (outcome, return_result, side_effects.tool_calls.length) that the production evaluator computes directly. The embedded `golden_snapshot.state_notes` is present but does not clearly corroborate the expected value; the production-engine signal is still the strongest classification but operator review is recommended. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "outcome",
    "expected": "success",
    "actual": "error",
    "detail": "payload.error = \"tool_call_failed\"; payload = {\"error\":\"tool_call_failed\",\"message\":\"Unknown builtin: true\",\"details\":{\"reason\":\"unknown_builtin\",\"name\":\"true\",\"line\":1}}"
  },
  {
    "field": "return_result",
    "expected": {
      "ok": true
    }
  },
  {
    "field": "side_effects.tool_calls.length",
    "expected": 1,
    "actual": 0,
    "detail": "actual call log: []"
  }
]
```

Production engine's structured return envelope:

```json
{
  "error": "tool_call_failed",
  "message": "Unknown builtin: true",
  "details": {
    "reason": "unknown_builtin",
    "name": "true",
    "line": 1
  }
}
```

## Golden's perspective

```
step | kind        | summary
-----+-------------+--------------------------------------------------------
   1 | permission  | {"kind":"permission","tool":"echo_srv.echo","decision":"allowed"}
   2 | ast         | assignment @ line 2 col 0
```

## Suggested remediation

Investigate the macro engine code path responsible for the outcome, return_result, side_effects.tool_calls.length surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T12:28:17.631Z — auto-classified by flashquery-macro-run (engine-bug, low confidence)
