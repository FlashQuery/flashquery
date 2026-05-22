---
name: call_model
description: "Call configured LLM model aliases or named purposes and return response, usage, cost, latency, trace, and tool-loop diagnostics. Pass {help: true} for full help."
help_hint: "Use call_model when FlashQuery should resolve an LLM model or purpose, hydrate references, and execute a model call."
tier: admin
args:
  resolver: "Required resolver: model, purpose, list_models, list_purposes, search, or help."
  name: "Model alias or purpose name for model/purpose resolvers."
  messages: "OpenAI-style messages for model or purpose calls."
  return_messages: "Optional flag to include hydrated input and assistant output."
  parameters: "Optional provider parameters."
  template_params: "Optional template parameter bindings."
  trace_id: "Optional usage correlation ID."
---

# call_model

## Purpose

Use `call_model` to run a configured LLM model alias or named purpose through FlashQuery. It resolves fallback chains, hydrates document/template references, records usage, and can run tool-enabled purpose loops when configured. Discovery resolvers return model and purpose metadata without making a provider call.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `resolver` | string | yes | none | `model`, `purpose`, `list_models`, `list_purposes`, `search`, or `help`. |
| `name` | string | model/purpose only | none | Model alias or purpose name. Ignored for discovery resolvers. |
| `messages` | array | model/purpose only | none | OpenAI-style chat messages. |
| `return_messages` | boolean | no | `false` | Include hydrated input messages and final assistant message. |
| `parameters` | object | no | `{}` | Provider parameters such as temperature or max tokens. |
| `template_params` | object | no | `{}` | Runtime bindings for template references. |
| `trace_id` | string | no | none | Correlates usage and cumulative trace reporting. |

## Returns

Model and purpose calls return a JSON envelope with `response`, `messages`, and `metadata`. Metadata includes resolver, name, resolved provider/model, fallback position, tokens, cost, latency, optional reference hydration data, optional trace fields, and optional tool diagnostics. Purpose tool loops may include tool diagnostics and tool-call traces. Discovery resolvers return JSON metadata with no provider call. The `help` resolver returns help content before checking whether LLM providers are configured.

## Examples

```json
{ "resolver": "list_purposes" }
```

Lists configured purposes.

```json
{ "resolver": "model", "name": "fast", "messages": [{ "role": "user", "content": "Summarize the plan." }] }
```

Calls a model alias directly.

```json
{ "resolver": "purpose", "name": "summarize", "messages": [{ "role": "user", "content": "Summarize {{ref:Notes/Plan.md}}" }], "trace_id": "briefing-1" }
```

Hydrates a document reference, runs the purpose fallback chain, and records usage under a trace.

## Gotchas

- The LLM provider must be configured for model and purpose calls.
- `list_models`, `list_purposes`, and `search` still require an `llm:` configuration; only `help` works before the unconfigured-provider guard.
- Discovery resolvers ignore `messages`; `search` requires `parameters.query` as a non-empty string.
- Provider parameters are passed through; prompt safety remains the caller's responsibility.
- Caller-provided provider tools are deferred; `parameters.tools` or top-level `tools` return an error.
- `role: "tool"` messages must use `tool_call_id`; a `name` field on tool messages is rejected.
- Recursive model/tool behavior is powerful and intentionally admin-tier.
- Use `get_llm_usage` for usage inspection after calls complete.

## Related Tools

- `get_llm_usage` reports recorded model usage and cost.
- `call_macro` orchestrates deterministic multi-tool workflows.
- `get_document` can read documents directly without invoking a model.
