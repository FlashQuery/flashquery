---
type: macro-framework-failure
status: open
classification: spec-ambiguity
confidence: low
test_id: mtf-d-530-arg-string-passthrough
test_file: cases/dispatch/530-530-arg-string-passthrough.yml
covers: ["MTF-D-103"]
golden_version_used: 0.3.0
golden_version_current: 0.3.0
failed_at: "2026-05-19T13:43:40.756Z"
created_by: flashquery-macro-run
reviewed_by: ""
escalated_to: ""
related_failures: ["2026-05-19-134332-mtf-d-530-arg-string-passthrough.md"]
---

## Triage classification rationale

None of the four primary heuristics fit cleanly: golden_version is current (0.3.0), findings are not on canonical structural fields, and neither the generator-provenance nor the state-notes-contradiction signals triggered. Per §5.8 the residual classification is spec-ambiguity — the spec may be genuinely unclear about this corner. Operator review per §11.6 confirms or routes elsewhere.

## Expected vs. Actual

Comparator findings (structured fields only, per INV-MTF-07):

```json
[
  {
    "field": "return_result_keys",
    "expected": [
      "ok",
      "side_effect",
      "args"
    ],
    "actual": [
      "v"
    ],
    "detail": "missing keys: ok, side_effect, args"
  }
]
```

Production engine's structured return envelope:

```json
{
  "task_id": "c76a26b2-43db-403e-a067-1e92b7e9f9f1",
  "result": {
    "v": {
      "ok": true,
      "side_effect": "echo",
      "args": {
        "msg": "hello world"
      }
    }
  },
  "trace": [
    {
      "kind": "tool_call",
      "name": "echo_srv.run",
      "args": {
        "msg": "hello world"
      },
      "result": {
        "ok": true,
        "side_effect": "echo",
        "args": {
          "msg": "hello world"
        }
      },
      "at": "2026-05-19T13:43:40.754Z"
    },
    {
      "kind": "exit",
      "result": {
        "v": {
          "ok": true,
          "side_effect": "echo",
          "args": {
            "msg": "hello world"
          }
        }
      },
      "at": "2026-05-19T13:43:40.754Z"
    }
  ],
  "external_tool_calls": 1
}
```

## Golden's perspective

_(no `golden_snapshot.state_notes` embedded)_

## Suggested remediation

Manually review the failing assertion against the cited REQ(s). If the spec is unclear, file a spec OQ against the Macro Language Requirements or MCP Broker Requirements. **Spec-doc edits require operator action (§11.6).** Populate the "Spec ambiguity proposal" section of this record with the proposed OQ wording.

## Spec ambiguity proposal

_(Operator: promote this section into a spec OQ in the relevant doc.)_

- **Target spec doc:** `flashquery-product/Roadmap/Features/Macro Testing Framework/` (or Macro Language Requirements / MCP Broker Requirements as applicable)
- **REQ to revisit:** MTF-D-103
- **Proposed OQ wording:** _(draft here; promote into the spec doc and link via `escalated_to:`)_

## Action log

- 2026-05-19T13:43:40.756Z — auto-classified by flashquery-macro-run (spec-ambiguity, low confidence)
