# LLM Providers, Models, and Purposes

FlashQuery's `llm:` configuration is split into three layers: providers, models, and purposes. This is a small amount of structure, but it gives you a lot of control over routing, cost, fallback behavior, and which tools or templates a delegated model can use.

At a high level:

- A **provider** is where requests go: OpenAI, OpenRouter, a local Ollama server, or another OpenAI-compatible endpoint.
- A **model** is a named alias for one provider's underlying model ID, plus its cost and capabilities.
- A **purpose** is a named reason to call a model, with a model fallback chain and optional defaults, tools, and templates.

Most callers should use purposes. Direct model calls are useful for tests, benchmarks, and cases where you need exact model selection. Purposes are better for everyday workflows because they let FlashQuery choose from an ordered chain, apply consistent defaults, track usage by task type, and expose a controlled tool/template surface.

## Why These Layers Exist

The three-layer split keeps concerns separate:

- Providers hold connection details and secrets. If an endpoint or API key changes, you update one provider.
- Models describe concrete model choices and economics. A model alias can say "this is `gpt-4o-mini`, it costs this much, and it supports tool calling."
- Purposes describe intent. A caller can ask for `summarization`, `researcher`, or `general` without knowing which provider or exact model ID should run today.

That separation is what lets FlashQuery do useful orchestration:

- Cost-aware routing: discovery tools can show each model's configured prices before a call is made.
- Fallback reliability: a purpose can try a primary model first, then fall back to another model on transient failures.
- Stable calling names: users and agents call `general` or `fast`, not raw provider model strings.
- Consistent defaults: a purpose can set temperature, token limits, response format, and loop guardrails once.
- Safer delegation: a purpose can expose only the native tools and templates that make sense for that job.
- Usage reporting: costs and latency can be grouped by purpose, which is much more meaningful than grouping only by provider model ID.

## Minimal Configuration

The `llm:` section is optional. If it is absent, `call_model` is still listed as an MCP tool. `resolver: "help"` still returns protocol help, but model execution and configuration discovery resolvers return an "LLM is not configured" error until `llm:` is configured.

Here is a minimal working language-model configuration:

```yaml
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
      api_key: ${OPENAI_API_KEY}

  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.60

  purposes:
    - name: general
      description: General-purpose language tasks.
      models: [fast]
```

Call that purpose with:

```json
{
  "resolver": "purpose",
  "name": "general",
  "messages": [
    { "role": "user", "content": "Summarize the tradeoffs." }
  ]
}
```

Call the model alias directly with:

```json
{
  "resolver": "model",
  "name": "fast",
  "messages": [
    { "role": "user", "content": "Summarize the tradeoffs." }
  ]
}
```

Some YAML examples below are fragments that focus on one part of the `llm:` section. In `flashquery.yml`, providers, models, and purposes all live under the top-level `llm:` key.

## Providers

A provider tells FlashQuery where to send model requests.

```yaml
llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
      api_key: ${OPENAI_API_KEY}

    - name: local-ollama
      type: ollama
      endpoint: http://localhost:11434
      local: true
```

Provider fields:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Your provider alias. Names are normalized to lowercase and must match `[a-z0-9][a-z0-9_-]*`. |
| `type` | yes | `openai-compatible` or `ollama`. |
| `endpoint` | yes | Provider base URL. Must be a valid URL. |
| `api_key` | no | API key or environment-variable reference such as `${OPENAI_API_KEY}`. |
| `local` | no | Caller-facing metadata surfaced by `list_models`. `type: ollama` is also reported as local. |

Use one provider per endpoint or account boundary. For example, you might have `openai`, `openrouter`, and `local-ollama` providers. Models then point at whichever provider should serve them.

## Models

A model is a FlashQuery alias for a real provider model ID. The alias is what callers use with `resolver: "model"` and what purposes use in their fallback chains.

```yaml
llm:
  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.60
      description: Fast, inexpensive model for routine language work.
      context_window: 128000
      tags: [cheap, fast]
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        strict_tools: true
        parallel_tool_calls: true
        structured_outputs_with_tools: true
```

Model fields:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Your model alias. Names are normalized to lowercase and must match `[a-z0-9][a-z0-9_-]*`. |
| `provider_name` | yes | The provider alias this model uses. Must match a configured provider. |
| `model` | yes | The provider's underlying model ID, such as `gpt-4o-mini` or `llama3.1`. |
| `type` | yes | One of `language`, `reasoning`, `embedding`, `vision`, `code`, `audio`, or `guardian`. |
| `cost_per_million.input` | yes | Input-token cost per million tokens, in USD. Use `0` for local/free models if appropriate. |
| `cost_per_million.output` | yes | Output-token cost per million tokens, in USD. |
| `dimensions` | for embedding models | Embedding vector dimension count. |
| `description` | no | Discovery metadata returned by `list_models`. |
| `context_window` | no | Positive integer context-window size, returned by discovery when declared. |
| `tags` | no | Discovery tags for routing hints, grouping, or user-facing descriptions. |
| `capabilities` | no | Structured capability declarations used for tool-loop admission and diagnostics. |

Model aliases should describe how you want to use a model, not merely repeat the provider ID. Good names are things like `fast`, `smart`, `local-code`, `cheap-reasoning`, or `embeddings`.

## Model Capabilities

Capabilities tell FlashQuery and callers what a model can safely do.

```yaml
capabilities:
  tool_calling: true
  usage_on_tool_calls: true
  strict_tools: true
  parallel_tool_calls: true
  structured_outputs_with_tools: true
```

Capability fields:

| Field | Meaning |
|---|---|
| `tool_calling` | The model can call tools. Required for purposes that expose native tools or template tools. |
| `usage_on_tool_calls` | Tool-call responses include usage data. Required for cost tracking in managed tool loops. |
| `strict_tools` | The provider/model supports strict tool schemas. |
| `parallel_tool_calls` | The model can emit multiple tool calls in one assistant response. |
| `structured_outputs_with_tools` | The model supports `response_format` while tools are available. |

For OpenAI's default provider name (`name: openai`, `type: openai-compatible`), FlashQuery assumes these capabilities are supported unless you override them. Other providers should declare capabilities explicitly when you want to use tool-enabled purposes.

If a purpose exposes model-visible tools or templates and the selected models do not declare the required support, FlashQuery blocks the call before sending a provider request. This keeps agent loops from starting in a configuration that cannot report usage or call tools correctly.

## Purposes

A purpose is a named calling policy. It describes why a model is being called and how FlashQuery should run that job.

```yaml
llm:
  purposes:
    - name: summarization
      description: Concise document and section summaries.
      models:
        - fast
        - smart
      defaults:
        temperature: 0.3
        max_tokens: 1024
```

Purpose fields:

| Field | Required | Description |
|---|---|---|
| `name` | yes | Purpose name used with `resolver: "purpose"`. Names are normalized to lowercase and must match `[a-z0-9][a-z0-9_-]*`. |
| `description` | yes | Human-readable intent. Returned by `list_purposes` and useful for model or user routing decisions. |
| `models` | yes | Ordered model aliases. The first model is primary; later entries are fallbacks. |
| `defaults` | no | Provider parameters and FlashQuery loop controls applied to calls for this purpose. Caller-supplied `parameters` override these values. |
| `tools` | no | Native tool names or tool tiers exposed to the delegated model. |
| `excluded_tools` | no | Tools removed from the `tools` set. Requires `tools` to be present. |
| `templates` | no | Vault template paths exposed as model-visible template tools for this purpose. |

Think of purposes as stable workflow names. Instead of asking callers to decide "Should this use `gpt-4o-mini` or `gpt-4o`?", let them call `summarization`, `reviewer`, or `researcher`. You can later change the purpose's model chain without changing callers.

## Fallback Chains

Purpose model lists are ordered:

```yaml
purposes:
  - name: general
    description: General assistant with fallback.
    models:
      - fast
      - smart
      - local-backup
```

FlashQuery tries the first model. If it encounters a transient failure such as a network error, rate limit, or provider 5xx, it can move to the next model in the chain. Permanent provider errors such as invalid requests or authentication failures stop the call.

In a `call_model` response, `metadata.fallback_position` tells you which model succeeded:

| Value | Meaning |
|---|---|
| `null` | Direct `resolver: "model"` call; no fallback chain. |
| `1` | The purpose's primary model succeeded. |
| `2` | The first fallback model succeeded. |
| `3` | The second fallback model succeeded. |

Cost rates shown by `list_purposes` come from the primary model, because discovery needs a simple estimate before the fallback outcome is known.

## Purpose Defaults

Purpose defaults are merged into provider parameters. Caller-supplied `parameters` win over purpose defaults.

```yaml
purposes:
  - name: drafting
    description: Long-form drafting with warmer output.
    models: [smart]
    defaults:
      temperature: 0.7
      max_tokens: 2048
```

Call-time override:

```json
{
  "resolver": "purpose",
  "name": "drafting",
  "messages": [
    { "role": "user", "content": "Draft the announcement." }
  ],
  "parameters": {
    "temperature": 0.2
  }
}
```

In that call, `temperature` is `0.2`, while `max_tokens` still comes from the purpose default.

FlashQuery preserves provider parameter names inside `defaults`, so OpenAI-style keys such as `max_tokens` are not renamed.

Purpose defaults can also include FlashQuery loop controls for tool-enabled purposes:

| Default | Meaning |
|---|---|
| `timeout_ms` | Whole-loop wall-clock deadline. |
| `max_cost_usd` | Pre-call aggregate cost budget guard. |
| `max_tokens_budget` | Pre-call aggregate token budget guard. |
| `max_iterations` | Maximum model round trips in the managed loop. |
| `result_summary_chars` | Tool-result summary length in metadata calls logs. |

These loop-control values must be numbers when declared in `defaults`.

## Purpose Tools

Purposes can expose FlashQuery native tools to the delegated model. This is what turns a purpose from a one-shot model call into a bounded agentic loop.

```yaml
purposes:
  - name: researcher
    description: Research assistant with read-only vault access.
    models: [fast]
    tools:
      - tier:read-only
```

Supported tiers:

| Tier | Includes |
|---|---|
| `tier:read-only` | Data-category read/list/search tools: `get_document`, `list_vault`, transitional `get_briefing` with its `call_macro` removal gate, `search`, `get_memory`, `get_record`, and `search_records`. Non-data categories are not part of broad delegated tier expansion; for example, `get_llm_usage` is an `llm` tool and is excluded from `tier:read-only`. |
| `tier:read-write` | Everything in `tier:read-only`, plus data-category write/edit/archive/remove tools: `copy_document`, `move_document`, `archive_document`, `remove_document`, `insert_in_doc`, `replace_doc_section`, `apply_tags`, transitional `insert_doc_link` with its `call_macro` removal gate, `write_document`, `archive_memory`, `write_memory`, `write_record`, `archive_record`, and `manage_directory`. |

You can also list explicit delegated native tool names from the same tier-backed allowlist:

```yaml
purposes:
  - name: doc-reader
    description: Can search and retrieve documents only.
    models: [fast]
    tools:
      - search
      - get_document
```

Use `excluded_tools` to remove tools from a tier:

```yaml
purposes:
  - name: careful-editor
    description: Can update documents but cannot archive them.
    models: [fast]
    tools:
      - tier:read-write
    excluded_tools:
      - archive_document
      - manage_directory
```

Some tools are always excluded from delegated model-visible native access, even if listed: `call_model`, `call_macro`, `register_plugin`, `unregister_plugin`, plugin administration tools, and `get_plugin_info`.

Administrative tools are also hard-excluded from delegated native access: `clear_pending_reviews` and `maintain_vault`. Removed legacy administrative names such as `force_file_scan` and `reconcile_documents` are not available as current host tools and are rejected by startup validation when used in purpose tool configuration.

## Purpose Templates

Purposes can expose vault templates as model-visible tools.

These are not top-level MCP tools exposed directly to the host client. They are generated tool definitions made available to the delegated model inside a `call_model` purpose run. From the delegated model's point of view they behave like callable tools; behind the scenes, FlashQuery resolves the generated tool name to a vault template, renders it with the supplied arguments, and returns the rendered content as the tool result.

What this gives you is a practical way to build reusable, parameterized skills in your vault. A template can be ordinary prompt text, a review rubric, a research method, a writing style guide, a troubleshooting checklist, or a multi-step operating procedure. Because it is a template, it can have fields that are filled at the moment of use: a topic, a target document, a desired output format, a customer name, a risk category, or any other context the skill needs.

That makes template-backed skills more flexible than static skills. Instead of loading a long instruction block into every model call, you can expose it to the purpose and let the delegated model request it only when it is useful. Instead of maintaining one skill per variant, you can keep one template and fill it differently each time. The rendered template is then injected into the delegated model's message flow as the tool result, giving the model fresh instructions or context without requiring the host model to read and relay the whole skill text.

There are two pieces to making this work:

1. The purpose lists the template path in `llm.purposes[].templates`.
2. The vault document declares template frontmatter that tells FlashQuery how to expose and render it.

```yaml
templates:
  default_access: restrictive

llm:
  purposes:
    - name: researcher
      description: Research assistant with a curated research template.
      models: [fast]
      templates:
        - Templates/research-brief.md
```

The referenced vault document needs frontmatter like this:

```yaml
---
fq_template: true
fq_expose_as_tool: true
fq_namespace: skill
fq_desc: "Create a focused research brief for a topic using optional source material."
fq_params:
  topic:
    type: string
    required: true
  source_doc:
    type: document
    required: false
  output_format:
    type: string
    default: "concise bullet summary with risks and next steps"
---
```

Frontmatter fields for template tools:

| Field | Required | What it controls |
|---|---|---|
| `fq_template` | yes | Marks the document as a FlashQuery template. Must be `true`. |
| `fq_expose_as_tool` | yes for purpose template tools | Allows FlashQuery to render this template as a model-visible function/tool. Must be `true`. |
| `fq_namespace` | no | Used in the generated function name: `flashquery_<fq_namespace>_<filename_slug>`. Defaults to `template`. |
| `fq_desc` | yes for purpose template tools | Becomes the function/tool description shown to the delegated model. |
| `fq_params` | no | Defines the function/tool input schema and the fields available for template substitution. |

For example, `Templates/research-brief.md` with `fq_namespace: skill` is exposed to the delegated model as a generated function name such as `flashquery_skill_research_brief`. The delegated model sees that function name, the `fq_desc` description, and an argument schema generated from `fq_params`. When it calls the function, FlashQuery renders the Markdown template body with those arguments and returns the rendered content as the tool result.

Template access is covered in more detail in `Document Reference System.md`, but the short version is:

- Direct `{{ref:...}}` references can use any resolvable template; purpose bindings are not required.
- `llm.purposes[].templates` controls which templates appear as callable tools to the delegated model during a managed purpose call.
- Top-level `templates.default_access` controls whether purposes without an explicit template list get all exposed templates (`permissive`, the default) or none (`restrictive`).

## Embedding Purpose

FlashQuery can represent embedding generation through the same LLM structure. When a purpose named `embedding` exists, FlashQuery uses that purpose first for semantic-search embeddings and ignores the legacy top-level `embedding:` provider path for routing.

```yaml
llm:
  models:
    - name: embeddings
      provider_name: openai
      model: text-embedding-3-small
      type: embedding
      dimensions: 1536
      cost_per_million:
        input: 0.02
        output: 0.00

  purposes:
    - name: embedding
      description: Generates vector embeddings for semantic search.
      models:
        - embeddings
```

Embedding models should declare `type: embedding` and `dimensions`. The dimensions must match the actual embedding model. If the `embedding` purpose is missing, FlashQuery falls back to the legacy top-level `embedding:` section when present; if neither path is usable, semantic search is disabled through the null embedding provider.

## Discovery

Use discovery resolvers before delegation when you want callers or agents to make informed routing decisions.

List configured models:

```json
{ "resolver": "list_models" }
```

Returns:

```json
{
  "models": [
    {
      "name": "fast",
      "type": "language",
      "provider": "openai",
      "model_id": "gpt-4o-mini",
      "input_cost_per_million": 0.15,
      "output_cost_per_million": 0.6,
      "description": "Fast, inexpensive model for routine language work.",
      "context_window": 128000,
      "tags": ["cheap", "fast"],
      "capabilities": {
        "tool_calling": true,
        "usage_on_tool_calls": true
      },
      "capability_diagnostics": [
        {
          "capability": "tool_calling",
          "state": "supported",
          "message": "model 'fast' declares tool_calling support"
        }
      ]
    }
  ]
}
```

The real `capability_diagnostics` array includes one entry for each structured capability.

List configured purposes:

```json
{ "resolver": "list_purposes" }
```

Returns purpose names, descriptions, model chains, primary-model cost rates, defaults, native tool diagnostics, template tool diagnostics, and a usage block.

Search discovery metadata:

```json
{ "resolver": "search", "parameters": { "query": "research" } }
```

Discovery calls do not call an LLM provider and do not require `name` or `messages`.

## Validation Rules

FlashQuery validates LLM config on startup:

- Provider, model, and purpose names are normalized to lowercase.
- Names must match `[a-z0-9][a-z0-9_-]*`.
- Names must be unique within each layer after lowercasing.
- Every model's `provider_name` must reference an existing provider.
- Every purpose model entry must reference an existing model alias.
- `excluded_tools` requires `tools`.
- Tool tiers must be known.
- Purpose `tools` and `excluded_tools` entries must be known delegated tool names, known hard-excluded names, or known tiers. Removed legacy tool names are rejected with replacement suggestions.
- Purpose loop-control defaults such as `timeout_ms` and `max_iterations` must be numbers.

If a value is not recognized in a strict section, FlashQuery reports a config error rather than silently accepting it.

## Complete Example

```yaml
templates:
  default_access: restrictive

llm:
  providers:
    - name: openai
      type: openai-compatible
      endpoint: https://api.openai.com
      api_key: ${OPENAI_API_KEY}

    - name: local-ollama
      type: ollama
      endpoint: http://localhost:11434

  models:
    - name: fast
      provider_name: openai
      model: gpt-4o-mini
      type: language
      cost_per_million:
        input: 0.15
        output: 0.60
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true

    - name: smart
      provider_name: openai
      model: gpt-4o
      type: reasoning
      cost_per_million:
        input: 2.50
        output: 10.00
      capabilities:
        tool_calling: true
        usage_on_tool_calls: true
        structured_outputs_with_tools: true

    - name: local-backup
      provider_name: local-ollama
      model: llama3.1
      type: language
      cost_per_million:
        input: 0
        output: 0

  purposes:
    - name: general
      description: General-purpose assistant for routine language tasks.
      models:
        - fast
        - local-backup
      defaults:
        temperature: 0.4

    - name: reviewer
      description: Reviews project documents with read-only vault access.
      models:
        - smart
        - fast
      defaults:
        temperature: 0.2
        max_tokens: 2048
        timeout_ms: 30000
        max_iterations: 4
      tools:
        - tier:read-only
      templates:
        - Templates/document-review.md
```

This configuration gives callers:

- `resolver: "model", name: "fast"` for exact model selection.
- `resolver: "purpose", name: "general"` for routine calls with fallback.
- `resolver: "purpose", name: "reviewer"` for a tool-enabled review workflow with a curated template.

## Practical Guidance

- Start with one provider, one language model alias, and one `general` purpose.
- Add model aliases when you need different cost, capability, or provider behavior.
- Add purposes when you have stable workflows worth naming, tracking, and tuning.
- Prefer purpose calls for production workflows; they give you fallback, defaults, and usage grouped by intent.
- Use direct model calls for controlled experiments, diagnostics, and cases where fallback would hide the behavior you are testing.
- Keep purpose descriptions specific. They are used by humans and agents deciding which purpose to call.
- Declare capabilities explicitly for non-OpenAI providers when using tools or templates.
- Put expensive models behind specific purposes rather than making every caller choose them manually.
