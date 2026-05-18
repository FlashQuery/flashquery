---
name: get_llm_usage
description: "Inspect aggregated LLM usage and cost records by summary, purpose, model, or recent trace-filtered calls. Pass {help: true} for full help."
help_hint: "Use get_llm_usage after call_model activity to inspect token, cost, latency, purpose, model, and trace usage."
tier: read-only
args:
  mode: "Required aggregation mode."
  period: "Optional 24h, 7d, 30d, or all shortcut."
  from_date: "Optional inclusive lower date bound."
  to_date: "Optional inclusive upper date bound."
  purpose_name: "Optional purpose filter."
  model_name: "Optional model filter."
  trace_id: "Optional trace filter."
  limit: "Optional recent-mode limit."
---

# get_llm_usage

## Purpose

Use `get_llm_usage` to inspect recorded LLM activity from the `fqc_llm_usage` table. It reports aggregate totals, per-purpose breakdowns, per-model breakdowns, or recent individual records. It is an inspection tool only; it never calls an LLM.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `mode` | string | yes | none | `summary`, `by_purpose`, `by_model`, or `recent`. |
| `period` | string | no | `7d` | `24h`, `7d`, `30d`, or `all`; overridden by explicit dates. |
| `from_date` | string | no | period-derived | Inclusive ISO lower bound. |
| `to_date` | string | no | period-derived | Inclusive ISO upper bound. |
| `purpose_name` | string | no | none | Filter to one lowercased purpose. |
| `model_name` | string | no | none | Filter to one lowercased model alias. |
| `trace_id` | string | no | none | Filter to one correlated trace. |
| `limit` | number | recent only | `20` | Maximum recent rows, capped at 1000. |

## Returns

Returns JSON text with pre-aggregated usage data. Summary mode includes totals and optional prior-period comparison. Purpose and model modes group calls, tokens, cost, and latency. Recent mode returns newest-first usage records.

## Examples

```json
{ "mode": "summary", "period": "7d" }
```

Shows total usage for the last seven days.

```json
{ "mode": "by_purpose", "period": "30d" }
```

Breaks usage down by purpose, including direct calls separately.

```json
{ "mode": "recent", "trace_id": "briefing-1", "limit": 10 }
```

Shows recent rows for one trace.

## Gotchas

- Supabase must be configured because usage lives in the database.
- Date-only `to_date` values are treated as end-of-day inclusive.
- `limit` only applies to `recent` mode.
- Fire-and-forget usage recording can land shortly after a model response.

## Related Tools

- `call_model` creates the usage rows reported here.
- `call_macro` can produce model usage when macros call model-capable tools.
- `search_tools` helps discover model-adjacent tools without invoking a model.
