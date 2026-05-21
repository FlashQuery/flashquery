import { REFERENCE_FAILURE_REASONS } from '../constants/reference-failures.js';

export const CALL_MODEL_RESOLVERS = ['model', 'purpose', 'list_models', 'list_purposes', 'search', 'help'] as const;

export const CALL_MODEL_USAGE_RESOLVER_ORDER = ['purpose', 'model', 'list_purposes', 'list_models', 'search', 'help'] as const;

export const CALL_MODEL_HELP_ERROR_CODES = ['reference_resolution_failed', 'tool_registry_collision'] as const;

export type CallModelResolver = typeof CALL_MODEL_RESOLVERS[number];

export interface CallModelHelpOptions {
  configured?: boolean;
}

export function buildCallModelUsageContent(): Record<string, unknown> {
  return {
    reference_syntax: '{{ref:<template_identifier>}}',
    template_params_example: {
      template_params: {
        topic: 'value',
        output_doc: 'value',
      },
    },
    resolvers: {
      purpose: "Call a named purpose fallback chain. Requires name and messages.",
      model: "Call a configured model alias directly. Requires name and messages.",
      list_purposes: "List configured purposes, tool/template diagnostics, and this usage block.",
      list_models: "List configured models and structured capability diagnostics.",
      search: "Search model, purpose, capability, tool, template, and help metadata. Requires parameters.query.",
      help: "Return the full call_model protocol help contract.",
    },
    note: "Use list_purposes first to discover purpose names, tool/template availability, and the next call_model request grammar.",
  };
}

function buildSummary(configured: boolean): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    tool: 'call_model',
    version: 'v1',
    purpose: configured
      ? 'Delegate language-model work through configured models or purposes, with raw discovery resolvers for planning calls.'
      : 'FlashQuery LLM is not configured. Add an llm: section to flashquery.yml to use this tool.',
    raw_discovery_resolvers: ['list_models', 'list_purposes', 'search', 'help'],
    llm_execution_resolvers: ['model', 'purpose'],
  };

  if (!configured) {
    summary['configuration_example'] = {
      filename: 'flashquery.yml',
      yaml: [
        'llm:',
        '  providers:',
        '    - name: openai',
        '      type: openai-compatible',
        '      endpoint: https://api.openai.com',
        '      api_key_env: OPENAI_API_KEY',
        '  models:',
        '    - name: fast',
        '      provider_name: openai',
        '      model: gpt-4o-mini',
        '      type: language',
        '      cost_per_million:',
        '        input: 0.15',
        '        output: 0.6',
        '      capabilities:',
        '        tool_calling: true',
        '        usage_on_tool_calls: true',
        '  purposes:',
        '    - name: general',
        '      description: General assistant',
        '      models: [fast]',
      ].join('\n'),
    };
  }

  return summary;
}

export function buildCallModelHelpContent(options: CallModelHelpOptions = {}): Record<string, unknown> {
  const configured = options.configured ?? true;
  return {
    summary: buildSummary(configured),
    reference_syntax: {
      prefix: '{{ref:...}}',
      forms: [
        { syntax: '{{ref:path/to/doc.md}}', behavior: 'Inject a vault document by path, filename, or fq_id.' },
        { syntax: '{{ref:path/to/doc.md#Section}}', behavior: 'Inject one heading section from the resolved document.' },
        { syntax: '{{ref:path/to/doc.md->frontmatter.path}}', behavior: 'Follow a frontmatter pointer and inject the referenced document content.' },
        { syntax: '{{ref:@alias}}', behavior: 'Resolve a late-bound alias from template_params.' },
      ],
      escape: {
        syntax: '\\{{ref:path/to/doc.md}}',
        behavior: 'Passes literal reference syntax through without hydration.',
      },
      safety: {
        scanned_messages: ['system', 'user'],
        non_recursive: true,
        failure_error: 'reference_resolution_failed',
      },
    },
    template_bindings: {
      template_params: {
        location: 'top-level call_model parameter',
        keyed_by: ['template path', 'alias name'],
        alias_fields: {
          _template: 'Template/document identifier used by {{ref:@alias}}.',
          _items: 'Ordered list of document/template identifiers injected at one alias slot.',
          _separator: 'String placed between _items outputs.',
        },
      },
      parameter_types: ['string', 'document'],
      template_frontmatter: {
        fq_template: true,
        fq_params: 'Parameter declarations with type, required, and default fields.',
        fq_expose_as_tool: 'When true and purpose-bound, the template can appear as a Mode 2 template tool.',
        fq_namespace: 'Namespace used in generated provider-safe tool names.',
        fq_desc: 'Description surfaced in template tool definitions and discovery diagnostics.',
      },
    },
    modes: {
      mode_1: {
        resolver_values: ['model', 'purpose'],
        required: ['name', 'messages'],
        behavior: 'Hydrates host-authored references, calls one configured model or purpose fallback chain, and returns a CallModelEnvelope.',
      },
      mode_2: {
        resolver_value: 'purpose',
        required: ['name', 'messages'],
        enabled_by: ['purpose.tools', 'purpose.templates', 'template access policy'],
        behavior: 'Runs a FlashQuery-managed model-visible tool loop for eligible purposes.',
        tools: {
          tools: 'Purpose-level native tool allowlist or tier names such as tier:read-only.',
          excluded_tools: 'Purpose-level removals from the expanded native tool set.',
          templates: 'Purpose-bound vault templates exposed as generated flashquery_<namespace>_<slug> tools.',
        },
        controls: {
          timeout_ms: 'Whole-loop wall-clock deadline.',
          max_iterations: 'Maximum model round trips in the managed loop.',
          max_tokens_budget: 'Pre-call aggregate token budget guard.',
          max_cost_usd: 'Pre-call aggregate cost budget guard.',
          result_summary_chars: 'Tool-result summary length for calls_log entries.',
        },
      },
    },
    envelope: {
      model_and_purpose_calls: 'Successful model/purpose calls return CallModelEnvelope with response, messages, and metadata.',
      discovery_calls: 'Discovery and help calls return raw JSON only, outside CallModelEnvelope.',
      return_messages: 'Ignored by discovery/help; for model/purpose calls, true returns post-hydration messages plus final assistant output.',
      metadata_tools: 'Present only for Mode 2 and includes native_tool_names, template_tool_names, diagnostics, calls_log, stop_reason, and aggregate_usage.',
    },
    errors: {
      codes: [...CALL_MODEL_HELP_ERROR_CODES],
      validation: [
        "name is required for resolver='model' or resolver='purpose'",
        "messages is required (non-empty array) for resolver='model' or resolver='purpose'",
        'search requires parameters.query (non-empty string)',
      ],
      reference_failure_reasons: [...REFERENCE_FAILURE_REASONS],
      reference_resolution_failed: 'Returned before any model call when host-authored references cannot be parsed or hydrated.',
      mode_2_ineligible: 'Returned when purpose/model capabilities or response_format constraints cannot support tool use.',
      provider_errors: ['http_error', 'network_error', 'fallback_exhausted'],
    },
    discovery: {
      resolvers: [...CALL_MODEL_RESOLVERS],
      list_models: {
        required_input: { resolver: 'list_models' },
        returns: ['models', 'capability_diagnostics'],
      },
      list_purposes: {
        required_input: { resolver: 'list_purposes' },
        returns: [
          'purposes',
          'native_tools',
          'native_tool_diagnostics',
          'template_tools (top-level in permissive mode, per-purpose in restrictive mode)',
          'template_tool_warnings',
          'template_tool_conflicts',
          'dangling_template_paths',
        ],
      },
      search: {
        required_input: { resolver: 'search', parameters: { query: 'string' } },
        indexed_metadata: [
          'model names',
          'model descriptions',
          'capability keys and states',
          'purpose names',
          'purpose descriptions',
          'native/tool/template diagnostic keys',
          'resolver names',
          'help section keys',
        ],
      },
      help: {
        required_input: { resolver: 'help' },
        returns: ['summary', 'reference_syntax', 'template_bindings', 'modes', 'envelope', 'errors', 'discovery', 'examples'],
      },
    },
    examples: {
      direct_model: {
        resolver: 'model',
        name: 'fast',
        messages: [{ role: 'user', content: 'Summarize {{ref:Docs/brief.md}}' }],
      },
      purpose_mode_1: {
        resolver: 'purpose',
        name: 'general',
        messages: [{ role: 'user', content: 'Draft a concise reply.' }],
        parameters: { temperature: 0.2 },
      },
      parameterized_template: {
        resolver: 'purpose',
        name: 'researcher',
        messages: [{ role: 'user', content: '{{ref:@brief}}' }],
        template_params: {
          brief: {
            _template: 'Templates/research-brief.md',
            topic: 'local-first AI data layers',
          },
        },
      },
      mode_2_tools: {
        resolver: 'purpose',
        name: 'agentic_reviewer',
        messages: [{ role: 'user', content: 'Inspect the project documents and return findings.' }],
        parameters: {
          timeout_ms: 30000,
          max_iterations: 4,
          max_tokens_budget: 12000,
          max_cost_usd: 0.25,
        },
      },
      list_models: { resolver: 'list_models' },
      list_purposes: { resolver: 'list_purposes' },
      search: { resolver: 'search', parameters: { query: 'template_tool_conflicts' } },
      help: { resolver: 'help' },
    },
  };
}
