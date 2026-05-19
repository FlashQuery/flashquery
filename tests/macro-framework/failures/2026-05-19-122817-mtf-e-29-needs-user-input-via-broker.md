---
type: macro-framework-failure
status: open
classification: engine-bug
confidence: medium
test_id: mtf-e-29-needs-user-input-via-broker
test_file: cases/errors/29-needs-user-input-via-broker.yml
covers: ["MTF-E-101", "MTF-E-102"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T12:28:17.634Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: []
---

## Triage classification rationale

Hand-authored test (no `generator:` provenance) running against the current golden (v0.3.0). Comparator findings hit structural engine fields (outcome) that the production evaluator computes directly. The embedded `golden_snapshot.state_notes` shows the golden reaching the expected value, so the divergence is on the production-engine side. Per §5.8: expectations valid for the recorded golden_version, engine drift suspected.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "outcome",
    "expected": "needs_user_input",
    "actual": "reason=undefined error=undefined"
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "4470ff6b-7f2d-44e3-a506-82fe026efd84",
  "result": {
    "event": "needs_user_input",
    "question": "Approve publishing this draft?",
    "answer_shape": "yes|no",
    "options": [
      "yes",
      "no"
    ],
    "resume_hint": "Pass --decision=yes/no on resume."
  },
  "trace": [
    {
      "kind": "tool_call",
      "name": "approval_srv.ask",
      "args": {
        "topic": "publish"
      },
      "result": {
        "event": "needs_user_input",
        "question": "Approve publishing this draft?",
        "answer_shape": "yes|no",
        "options": [
          "yes",
          "no"
        ],
        "resume_hint": "Pass --decision=yes/no on resume."
      },
      "at": "2026-05-19T12:28:17.634Z"
    },
    {
      "kind": "exit",
      "result": {
        "event": "needs_user_input",
        "question": "Approve publishing this draft?",
        "answer_shape": "yes|no",
        "options": [
          "yes",
          "no"
        ],
        "resume_hint": "Pass --decision=yes/no on resume."
      },
      "at": "2026-05-19T12:28:17.634Z"
    }
  ],
  "external_tool_calls": 1
}
```

## Golden's perspective

```
step | kind        | summary
-----+-------------+--------------------------------------------------------
   1 | permission  | {"kind":"permission","tool":"approval_srv.ask","decision":"allowed"}
   2 | ast         | assignment @ line 2 col 0
   3 | coerce      | {"kind":"coerce","path":"json_text","raw_summary":"approval_srv.ask bound via json_text"}
```

## Suggested remediation

Investigate the macro engine code path responsible for the outcome surface. Start from the production engine in `flashquery/src/macro/` and trace what differs from the golden's path shown in `golden_snapshot.state_notes`. If a regression is confirmed, fix the engine and re-run.

## Action log

- 2026-05-19T12:28:17.634Z — auto-classified by flashquery-macro-run (engine-bug, medium confidence)
