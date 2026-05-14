# Document References and Templates

FlashQuery lets you pass vault documents to a model by reference instead of loading the document into your own context first. You write a short placeholder such as `{{ref:Docs/brief.md}}` in a `call_model` message, and FlashQuery replaces that placeholder with the referenced document content before sending the prompt to the configured model or purpose.

Templates use the same mechanism. A template is a vault document with `fq_template: true` in its frontmatter. Its body can contain placeholders such as `{{topic}}` or `{{source_doc}}`, and you supply values through `template_params` or through model-visible template tools.

## Why References Exist

Document references solve a practical orchestration problem: one model often needs another model to work from a document, but the first model should not have to read the entire document and then spend more tokens writing it back out. With references, the caller passes a compact placeholder, and FlashQuery expands the document only for the model that actually needs to use it.

This matters for a few reasons:

- Lower token cost: the host model avoids paying to ingest and relay large documents.
- More usable context: the host model can delegate work even when its own context window is already crowded.
- Selective context: the caller can send only the section, pointer target, or linked document that matters instead of sending the entire source document.
- Better model routing: a fast, cheap, or specialized model can work from exact vault material without the host model becoming a document courier.
- Reusable workflows: templates keep repeated instructions in your vault instead of scattering long prompt text across tool calls.
- Clear provenance: response metadata records which references were injected and how large they were.
- Safer delegation: FlashQuery only hydrates caller-authored references in the original `system` and `user` messages, so delegated models and tool outputs cannot create new vault reads by emitting reference syntax later.

Use references and templates when you want to:

- Ask a cheaper or specialized model to work from vault material without first reading that material into the host AI's context.
- Reuse prompt instructions stored as Markdown files in your vault.
- Fill reusable templates with different parameters on each `call_model` call.
- Give an agentic purpose controlled access to reusable templates as callable tools.

## Quick Start

Inject a document into a model call:

```json
{
  "resolver": "purpose",
  "name": "summarizer",
  "messages": [
    {
      "role": "user",
      "content": "Summarize this document:\n\n{{ref:Docs/product-brief.md}}"
    }
  ]
}
```

Inject one section:

```json
{
  "resolver": "purpose",
  "name": "reviewer",
  "messages": [
    {
      "role": "user",
      "content": "Review the open risks:\n\n{{ref:Docs/product-brief.md#Open Risks}}"
    }
  ]
}
```

Use a parameterized template:

```json
{
  "resolver": "purpose",
  "name": "researcher",
  "messages": [
    {
      "role": "user",
      "content": "{{ref:@brief}}"
    }
  ],
  "template_params": {
    "brief": {
      "_template": "Templates/research-brief.md",
      "topic": "local-first AI data layers",
      "depth": "deep"
    }
  }
}
```

## `call_model` Inputs

The `call_model` tool supports two execution resolvers and four discovery resolvers.

Execution resolvers:

| Resolver | Required fields | What it does |
|---|---|---|
| `model` | `name`, `messages` | Calls a configured model alias directly. |
| `purpose` | `name`, `messages` | Calls a configured purpose and uses its model fallback chain. If the purpose exposes tools or templates, FlashQuery may run a managed tool loop. |

Discovery resolvers:

| Resolver | Required fields | What it returns |
|---|---|---|
| `list_models` | none | Configured model aliases and capability diagnostics. |
| `list_purposes` | none | Configured purposes, native tools, template tools, diagnostics, and a usage summary. |
| `search` | `parameters.query` | Matching model, purpose, capability, tool, template, and help metadata. |
| `help` | none | The full current `call_model` protocol help payload. |

Common fields:

| Field | Applies to | Description |
|---|---|---|
| `resolver` | all calls | One of `model`, `purpose`, `list_models`, `list_purposes`, `search`, or `help`. |
| `name` | `model`, `purpose` | Model alias or purpose name. |
| `messages` | `model`, `purpose` | OpenAI-style messages. References are hydrated only in original `system` and `user` message content. |
| `parameters` | `model`, `purpose`, `search` | Provider parameters such as `temperature`, plus FlashQuery loop controls such as `timeout_ms`, `max_iterations`, `max_tokens_budget`, and `max_cost_usd`. For `search`, use `parameters.query`. |
| `template_params` | `model`, `purpose` | Template values keyed by template identifier or alias. Ignored by discovery resolvers. |
| `return_messages` | `model`, `purpose` | When `true`, returns post-hydration messages plus the final assistant message. |
| `trace_id` | `model`, `purpose` | Correlates usage rows and returns cumulative trace totals in metadata. |

Successful `model` and `purpose` calls return a JSON envelope:

```json
{
  "response": "The model's final text response.",
  "messages": [],
  "metadata": {
    "resolver": "purpose",
    "name": "summarizer",
    "resolved_model_name": "fast",
    "provider_name": "openai",
    "fallback_position": 1,
    "tokens": { "input": 1200, "output": 300 },
    "cost_usd": 0.00036,
    "latency_ms": 1800
  }
}
```

Discovery calls return raw JSON for that discovery resolver, not the normal `response/messages/metadata` envelope.

## Reference Syntax

A reference placeholder has this form:

```text
{{ref:<identifier>}}
```

The identifier can be a vault-relative path, a filename shorthand, or an `fq_id` UUID. FlashQuery decides how to resolve it:

| Identifier shape | How FlashQuery resolves it |
|---|---|
| UUID format | Looks up a document by `fq_id`. |
| Contains `/` or ends with a configured Markdown extension such as `.md` | Treats it as a vault-relative path. |
| Anything else | Searches for a matching filename in the vault. The match must be unique. |

The only active reference prefix is `{{ref:...}}`. Legacy `{{id:...}}` text is treated as ordinary literal text.

### Full Document

```text
{{ref:Docs/product-brief.md}}
{{ref:product-brief}}
{{ref:550e8400-e29b-41d4-a716-446655440000}}
```

### Section Extraction

Use `#` to inject one heading section from a document:

```text
{{ref:Docs/product-brief.md#Open Risks}}
{{ref:550e8400-e29b-41d4-a716-446655440000#Decision Log}}
```

The section name must match a Markdown heading. Whitespace inside the section name is allowed. Whitespace around `#` is not:

```text
{{ref:Docs/product-brief.md#Open Risks}}   valid
{{ref:Docs/product-brief.md # Open Risks}} invalid
```

### Frontmatter Pointer Dereferencing

Use `->` to follow a string value in a document's frontmatter and inject the document it points to.

Source document frontmatter:

```yaml
---
projections:
  summary: Docs/.projections/product-brief-summary.md
---
```

Reference:

```text
{{ref:Docs/product-brief.md->projections.summary}}
```

FlashQuery reads `Docs/product-brief.md`, follows `projections.summary`, resolves the value as a document identifier, and injects the target document body.

`#` and `->` are mutually exclusive in one reference. To dereference and then extract a section, first discover the target path, then use a direct section reference to that target:

```text
{{ref:Docs/.projections/product-brief-summary.md#Key Decisions}}
```

### Late-Bound Aliases

Use `@` when the message should contain a reusable slot and the actual document or template is supplied through `template_params`:

```json
{
  "messages": [
    {
      "role": "user",
      "content": "Use this brief:\n\n{{ref:@brief}}"
    }
  ],
  "template_params": {
    "brief": {
      "_template": "Templates/research-brief.md",
      "topic": "local-first data layers"
    }
  }
}
```

The alias key is `brief`; the placeholder is `{{ref:@brief}}`. FlashQuery looks up `template_params.brief`, resolves `_template`, and injects the rendered result.

Alias placeholders do not support `#` or `->` on the outer placeholder. These are invalid:

```text
{{ref:@brief#Section}}
{{ref:@brief->pointer.path}}
```

If you need sections or pointer dereferences in a variable list, use `_items` as described below.

### Escaping References

Use a backslash when you want to pass reference syntax literally:

```text
\{{ref:Docs/product-brief.md}}
```

The model receives:

```text
{{ref:Docs/product-brief.md}}
```

Escaped references are not resolved and do not appear in `metadata.injected_references`.

Backslashes use a parity rule:

| Input | Result |
|---|---|
| `\{{ref:doc.md}}` | Literal `{{ref:doc.md}}`; no resolution. |
| `\\{{ref:doc.md}}` | Literal `\` plus hydrated document content. |
| `\\\{{ref:doc.md}}` | Literal `\{{ref:doc.md}}`; no resolution. |

Malformed openers without a closing `}}`, such as `{{ref:doc.md`, are treated as literal text.

## Templates

A template is a Markdown vault document with `fq_template: true` in frontmatter.

Templates are reusable, parameterized prompt material stored in your vault. They can be simple prompt snippets, full skills, review rubrics, research methods, style guides, checklists, or operating procedures. The important difference from a plain document is that a template can declare fields, and FlashQuery can fill those fields at the moment the template is used.

That gives you two useful ways to use the same template:

- Direct injection: the caller references the template with `{{ref:...}}` or `{{ref:@alias}}`, supplies `template_params`, and FlashQuery injects the rendered content before the model call.
- Delegated tool use: a purpose exposes the template as a generated function/tool inside a `call_model` purpose run, and the delegated model chooses when to call it.

In both cases, FlashQuery reads the backing Markdown file, validates the parameters declared in frontmatter, substitutes those values into the body, and sends the rendered result to the model that needs it.

```yaml
---
fq_template: true
fq_namespace: skill
fq_expose_as_tool: true
fq_desc: "Create a focused research brief for a given topic."
fq_params:
  topic:
    type: string
    required: true
  depth:
    type: string
    default: standard
  source_doc:
    type: document
    required: false
---
```

Template body:

```markdown
# Research Brief: {{topic}}

Depth: {{depth}}

Source material:

{{source_doc}}
```

Template frontmatter fields:

| Field | Required | Description |
|---|---|---|
| `fq_template` | yes | Must be `true` for FlashQuery to treat the document as a template. |
| `fq_params` | no | Parameter declarations. Supported types are `string` and `document`. |
| `fq_desc` | required for template tools | Human-readable description used as the function/tool description shown to the delegated model. |
| `fq_expose_as_tool` | required for template tools | When `true`, the template can be exposed to eligible purposes as a generated function/tool. |
| `fq_namespace` | no | Used in generated function/tool names. Defaults to `template`. Must use lowercase letters, numbers, and underscores, starting with a letter. |

Template placeholders use `{{name}}`, where `name` matches a declared parameter. Placeholder names must match `[A-Za-z_][A-Za-z0-9_]*`.

Use a backslash when a template body should output a placeholder literally:

```markdown
\{{topic}}
```

Template placeholder escaping uses the same parity rule as document references: an odd number of preceding backslashes escapes the placeholder, and an even number leaves one literal backslash before the substituted value.

Supported parameter types:

| Type | Input value | What FlashQuery substitutes |
|---|---|---|
| `string` | A string | The string value. |
| `document` | A document identifier string | The resolved document body. |

Parameter behavior:

- Required parameters must be supplied unless they have a default.
- Optional parameters without a value and without a default become an empty string and produce a warning.
- Unknown supplied parameters are ignored and produce a warning.
- Template substitution is single-pass. Values that contain `{{ref:...}}` or `{{placeholder}}` are inserted literally and are not processed again.
- Undeclared placeholders are left literal and produce a warning.
- A referenced template is read fresh for each `call_model` invocation.

## Supplying Template Parameters

For a template referenced directly by path, key `template_params` by that same template identifier:

```json
{
  "resolver": "purpose",
  "name": "reviewer",
  "messages": [
    {
      "role": "user",
      "content": "{{ref:Templates/document-review.md}}"
    }
  ],
  "template_params": {
    "Templates/document-review.md": {
      "target_doc": "Docs/product-brief.md",
      "criteria": "clarity, completeness, and unresolved risks"
    }
  }
}
```

If a template has all required values supplied by defaults, you can reference it without a matching `template_params` entry.

If the referenced document is not a template, any matching `template_params` entry is ignored for that reference.

## Reusing One Template Multiple Times

Use aliases when you need to render the same template more than once with different values:

```json
{
  "resolver": "purpose",
  "name": "analyst",
  "messages": [
    {
      "role": "user",
      "content": "Compare these two reviews.\n\nReview A:\n{{ref:@review_a}}\n\nReview B:\n{{ref:@review_b}}"
    }
  ],
  "template_params": {
    "review_a": {
      "_template": "Templates/document-review.md",
      "target_doc": "Docs/product-brief.md",
      "criteria": "completeness"
    },
    "review_b": {
      "_template": "Templates/document-review.md",
      "target_doc": "Docs/launch-plan.md",
      "criteria": "internal consistency"
    }
  }
}
```

Reserved alias fields:

| Field | Meaning |
|---|---|
| `_template` | The document or template to load for this alias. |
| `_items` | An ordered list of documents or template entries to inject at one alias slot. |
| `_separator` | String used to join `_items`. Defaults to a blank line. |

Reserved fields are consumed by FlashQuery and are not passed to the template as parameters.

## Injecting Multiple Documents With `_items`

Use `_items` when one prompt slot should expand into a variable-length list of documents or rendered templates.

```json
{
  "resolver": "purpose",
  "name": "synthesizer",
  "messages": [
    {
      "role": "user",
      "content": "Synthesize this background material:\n\n{{ref:@background}}"
    }
  ],
  "template_params": {
    "background": {
      "_items": [
        "Docs/product-brief.md",
        "Docs/launch-plan.md#Open Risks",
        "Docs/research-notes.md->projections.summary",
        {
          "_template": "Templates/review-context.md",
          "target_doc": "Docs/customer-notes.md",
          "focus_area": "sales objections"
        }
      ],
      "_separator": "\n\n---\n\n"
    }
  }
}
```

List rules:

- `_items` must be an array.
- An empty `_items` array is valid and resolves to an empty string.
- String items use reference inner syntax without the outer `{{ref:` and `}}`.
- String items may use `#Section` or `->frontmatter.path`.
- String items cannot start with `@`; nested aliases are not supported.
- Object items must include `_template` and may include parameters for that template.
- `_separator`, when present, must be a string.

## Exposing Templates as Model-Visible Tools

Direct references are chosen by the caller before the model call starts. Template tools are different: they let a delegated model choose a template during a FlashQuery-managed tool loop.

Template tools are not top-level MCP tools that appear directly in the host client's MCP tool list. They are generated tool definitions inside a `call_model` purpose call. The delegated model sees them as callable tools during that managed loop, and FlashQuery dispatches those calls by reading and rendering the backing vault templates.

This is what turns a template into a dynamic skill. The template frontmatter supplies the generated function name, description, and argument schema. The template body supplies the instruction text that will be rendered and returned when the delegated model calls that function.

A template can become a model-visible tool when:

1. The vault document has `fq_template: true`.
2. The vault document has `fq_expose_as_tool: true`.
3. The template is available to the active purpose through the template access rules.
4. The active purpose uses a model/provider that supports tool calling.

The relevant frontmatter fields are:

| Field | How it is used for generated tools |
|---|---|
| `fq_template: true` | Marks the backing document as a template. |
| `fq_expose_as_tool: true` | Allows the template to be rendered as a generated function/tool. |
| `fq_namespace` | Provides the middle part of the generated name: `flashquery_<fq_namespace>_<filename_slug>`. |
| `fq_desc` | Becomes the function/tool description shown to the delegated model. |
| `fq_params` | Becomes the function/tool argument schema and controls template substitution. |

Template tool names are generated like this:

```text
flashquery_<fq_namespace>_<filename_slug>
```

Examples:

| Template path | Namespace | Generated tool name |
|---|---|---|
| `Templates/Research-Skill.md` | `skill` | `flashquery_skill_research_skill` |
| `Templates/Document Review.md` | `review` | `flashquery_review_document_review` |
| `Templates/Weekly Checklist.md` | omitted | `flashquery_template_weekly_checklist` |

When the model calls a template tool, FlashQuery:

1. Looks up the generated tool name in the current call's template registry.
2. Reads the template from the vault.
3. Uses the tool arguments as template parameters.
4. Resolves `document` parameters.
5. Returns the hydrated template content as a `tool` message.

Template tool failures are recoverable inside the tool loop. For example, if the model omits a required parameter, FlashQuery returns a tool error payload and the model may retry with corrected arguments. This differs from caller-authored references in the original `messages`, which fail the whole `call_model` call before any provider request is made.

## Configuring Template Tool Access

The top-level `templates` block controls the default availability of template tools:

```yaml
templates:
  default_access: permissive
```

| Value | Behavior |
|---|---|
| `permissive` | Purposes without an explicit `templates` list can see all discovered templates with `fq_expose_as_tool: true`. This is the default. |
| `restrictive` | Purposes without an explicit `templates` list see no template tools. |

Purpose-level template bindings live in `llm.purposes[].templates`:

```yaml
llm:
  purposes:
    - name: researcher
      description: Research assistant with access to reusable research templates.
      models: [fast]
      templates:
        - Templates/Research-Skill.md
        - Templates/Source-Review.md

    - name: general
      description: General assistant.
      models: [fast]
```

Direct `{{ref:...}}` references do not require a purpose template binding. Bindings only control which templates are exposed as model-visible tools during a managed tool loop.

Use `resolver: "list_purposes"` to see which template tools a purpose can use:

```json
{ "resolver": "list_purposes" }
```

Each purpose may include:

- `template_tools`: generated template tools that are usable by that purpose.
- `template_tool_warnings`: templates that could not be exposed, with a reason.
- `template_tool_conflicts`: generated tool-name collisions.
- `dangling_template_paths`: configured template paths that are unavailable.

## Response Metadata for References

When references are resolved successfully, `metadata.injected_references` and `metadata.prompt_chars` are present.

```json
{
  "response": "Done.",
  "messages": [],
  "metadata": {
    "resolver": "purpose",
    "name": "reviewer",
    "resolved_model_name": "fast",
    "provider_name": "openai",
    "fallback_position": 1,
    "tokens": { "input": 2200, "output": 400 },
    "cost_usd": 0.00052,
    "latency_ms": 2100,
    "prompt_chars": 8421,
    "injected_references": [
      {
        "ref": "{{ref:@review}}",
        "chars": 7900,
        "resolved_to": "Templates/document-review.md",
        "template": true,
        "template_path": "Templates/document-review.md",
        "template_params_used": {
          "target_doc": {
            "type": "document",
            "input": "Docs/product-brief.md",
            "resolved_to": "Docs/product-brief.md",
            "chars": 6200
          },
          "criteria": {
            "type": "string",
            "chars": 31
          }
        }
      }
    ]
  }
}
```

Metadata fields:

| Field | Description |
|---|---|
| `ref` | The literal placeholder from the original message. |
| `chars` | Character count of the injected content. |
| `resolved_to` | Actual resolved path when useful, such as aliases, pointer dereferences, or filename/UUID resolution. |
| `template` | Present and `true` when the injected content came from a template. |
| `template_path` | The resolved template path. |
| `template_params_used` | Structured summaries of parameters that were applied. |
| `template_warnings` | Non-fatal template warnings. |
| `resolved_to_count` | Number of `_items` entries rendered for a list alias. |
| `items` | Per-item metadata for `_items` list aliases. |
| `prompt_chars` | Total character count of all message content after reference hydration. |

If there are no active references in the original `system` or `user` messages, `injected_references` and `prompt_chars` are absent.

## Reference Errors

Caller-authored reference errors fail before any model request is sent. The MCP tool returns `isError: true` with a JSON text payload:

```json
{
  "error": "reference_resolution_failed",
  "failed_references": [
    {
      "ref": "{{ref:Docs/missing.md}}",
      "reason": "document_not_found",
      "detail": "Document 'Docs/missing.md' was not found"
    }
  ]
}
```

Common failure reasons:

| Reason | Meaning |
|---|---|
| `invalid_reference_syntax` | The placeholder grammar is invalid. |
| `document_not_found` | The identifier did not resolve to a vault document. |
| `ambiguous_document_identifier` | A filename shorthand matched multiple active documents. Use a path or `fq_id`. |
| `read_error` | The document resolved but could not be read. |
| `section_not_found` | The requested heading was not found. |
| `occurrence_out_of_range` | Section occurrence selection was out of range. |
| `reference_path_not_found` | A `->` frontmatter path does not exist. |
| `reference_path_not_string` | A `->` frontmatter path exists but is not a string. |
| `pointer_target_not_found` | A `->` value did not resolve to a document. |
| `template_missing_required_param` | A required template parameter was not supplied and has no default. |
| `template_param_invalid_type` | A supplied template parameter has the wrong type. |
| `template_param_doc_not_found` | A `document` parameter did not resolve to one document. |
| `alias_template_not_found` | An alias `_template` value did not resolve to a document. |
| `alias_missing_template_field` | An alias entry has neither `_template` nor `_items`. |
| `alias_key_not_found` | `{{ref:@alias}}` was used, but `template_params.alias` is missing. |
| `multi_ref_invalid_value` | A list alias has an invalid shape. |
| `multi_ref_item_failed` | One item in a list alias failed to resolve. |
| `unknown_reference_error` | FlashQuery could not classify the failure. |

When multiple references fail, FlashQuery reports the failures together so the caller can fix them in one pass.

## Safety and Resolution Boundaries

FlashQuery intentionally resolves only references authored by the caller in the original `call_model.messages` array.

Current boundaries:

- Only `system` and `user` message content is scanned.
- `assistant` messages, `tool` messages, tool-call arguments, tool results, and model responses are not scanned.
- Injected document or template content is not scanned recursively.
- Template parameter values are not scanned recursively.
- Caller-provided provider tools are not accepted by `call_model`; use configured FlashQuery native tools and template tools through purposes.

These boundaries prevent delegated models or tool outputs from smuggling new vault reads by emitting reference syntax.

## Practical Patterns

Use a direct reference when the caller already knows the exact document:

```text
{{ref:Docs/product-brief.md}}
```

Use a section reference when the model should see only part of a large document:

```text
{{ref:Docs/product-brief.md#Open Risks}}
```

Use a pointer when the source document owns a durable link to derived material:

```text
{{ref:Docs/product-brief.md->projections.summary}}
```

Use an alias when a reusable prompt should decide content at call time:

```text
{{ref:@brief}}
```

Use `_items` when the number of background documents varies:

```json
{
  "background": {
    "_items": ["Docs/a.md", "Docs/b.md#Risks", "Docs/c.md->summary"],
    "_separator": "\n\n---\n\n"
  }
}
```

Use a template tool when the delegated model should decide whether and when to load a reusable instruction template during an agentic purpose call.

## Limitations

- `{{id:...}}` is literal text. Use `{{ref:<fq_id>}}` for UUID-based lookup.
- One reference can use either `#` or `->`, not both.
- Alias placeholders cannot use `#` or `->` on the outer placeholder.
- References do not support nested or recursive hydration.
- Filename shorthand must resolve to exactly one active document.
- Template tools require tool-capable model configuration.
