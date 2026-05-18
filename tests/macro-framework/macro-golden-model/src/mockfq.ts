// Mock FlashQuery MCP tool registry.
//
// Per the OQ #1 resolution (2026-05-12), the macro engine treats FlashQuery
// as an in-process "broker" of its own tools. All FlashQuery tool calls in
// macros take the namespaced JSON-arg form:
//
//     fq.tool_name({ ...JSON matching the tool's input schema... })
//
// This file is the prototype's mock implementation of the `fq` server entry
// in the tool registry. Each tool takes one structured object arg and returns
// a canned value, logging what it would have done. In production, these
// handlers are replaced with real FlashQuery tool implementations — the
// dispatch shape stays identical.
//
// When the MCP Broker feature ships (`Research/MCP-Broker-Support.md`),
// additional server entries appear here for external brokers (`brave_search`,
// `company_db`, etc.) with transport-appropriate handlers — stdio for local
// subprocess MCP servers, streamable HTTP for remote/hosted MCP servers,
// or any other transport the broker layer supports. The macro engine itself
// does not change; it only sees the `ServerEntry.tools` function map.

import type { CallContext, ServerEntry, ToolRegistry, Value } from "./types.ts";
import { setHelpPageProvider, stringifyValue } from "./evaluator.ts";
import { braveSearchServer, coerceDemoServer, webFetchServer } from "./mockbrokers.ts";

// Tier 2 (REQ-094): canonical default `help_hint` string, copied verbatim
// from MCP Broker Requirements §7.13 REQ-094.
export const CANONICAL_HELP_HINT =
  "FlashQuery-native tool. Pass `{help: true}` for full documentation, examples, and common patterns before composing your call if you're uncertain about parameters.";

// Tier 2 (REQ-082..087): per-tool help-page bodies (mock-only — production
// reads these from `*.tool.md` frontmatter+body via `TOOL_META`). Keyed by
// `<server>.<tool>` so the help-page lookup is uniform across servers.
//
// PROD-NOTE: in production, `fq.*` help bodies come from co-located
// `.tool.md` files; brokered help is forwarded upstream per REQ-098.
export const HELP_PAGES: Record<string, string> = {
  "fq.search": "fq.search: Free-text search over the vault. Args: { query, entity_types?, tags? }. Returns a list of matching document summaries.",
  "fq.get_document": "fq.get_document: Read a single document by identifier or path. Args: { identifiers, include? }. Returns the document or { error: 'not_found' }.",
  "fq.write_document": "fq.write_document: Creates or updates a document. Args: { mode: 'create'|'update', path?, identifier?, title?, content?, frontmatter?, tags? }. Returns metadata for the written doc.",
  "fq.move_document": "fq.move_document: Move a document. Args: { identifier, destination_path }.",
  "fq.apply_tags": "fq.apply_tags: Apply tags to one or more documents. Args: { targets, tags }.",
  "fq.archive_document": "fq.archive_document: Soft-archive documents by identifier. Args: { identifiers }.",
  "fq.manage_directory": "fq.manage_directory: Create or remove vault directories. Args: { action: 'create'|'remove', paths }.",
  "fq.insert_in_doc": "fq.insert_in_doc: Insert content at a position in a document. Args: { identifier, position, content, heading? }.",
  "fq.call_model": "fq.call_model: Invoke an LLM. Args: { resolver: 'model'|'purpose'|..., name?, messages?, parameters? }.",
  "fq.search_tools": "fq.search_tools: BM25 search across known tools (FQ-native + brokered). Args: { query, limit?, server_filter? }. Returns SearchResult[].",
};

const idCounters = new Map<string, number>();
function nextId(kind: string): string {
  const n = (idCounters.get(kind) ?? 0) + 1;
  idCounters.set(kind, n);
  return String(n).padStart(3, "0");
}

function quote(s: string): string {
  return `"${s.replace(/"/g, '\\"')}"`;
}

// Canned draft documents returned by fq.search for the demo flows.
function cannedDrafts(): Value[] {
  return [
    { fq_id: "doc_a", title: "Draft A", path: "Drafts/draft-a.md", tags: ["#draft"], frontmatter: { fq_status: "active", related_to: [] } },
    { fq_id: "doc_b", title: "Draft B", path: "Drafts/draft-b.md", tags: ["#draft"], frontmatter: { fq_status: "active", related_to: ["doc_x"] } },
    { fq_id: "doc_c", title: "Draft C", path: "Drafts/draft-c.md", tags: ["#draft"], frontmatter: { fq_status: "active", related_to: [] } },
  ];
}

// The `fq` server entry — FlashQuery as an internal broker.
//
// Each tool receives a single `arg: Record<string, Value>` (the evaluated
// JSON object the macro author wrote inside the parens). The shape mirrors
// what the equivalent MCP tool would expect over the wire.
export const fqServer: ServerEntry = {
  label: "FlashQuery (in-process mock)",
  tools: {
    // fq.search({ query, entity_types?, tags?, ... })
    search: (arg, ctx) => {
      const query = String(arg.query ?? "");
      ctx.log(`[fq] search(${stringifyValue(arg)}) -> 3 canned draft docs`);
      // For the demo we ignore most filters and always return the canned set.
      return cannedDrafts();
    },

    // fq.get_document({ identifiers, include?, ... })
    get_document: (arg, ctx) => {
      const ident = String(arg.identifiers ?? "");
      ctx.log(`[fq] get_document(${stringifyValue(arg)})`);
      // Return a single canned document with the requested fq_id.
      const doc = cannedDrafts().find((d) => {
        const o = d as Record<string, Value>;
        return o.fq_id === ident || o.path === ident;
      });
      if (!doc) {
        // Match the canonical not_found shape from the consolidation doc.
        return {
          error: "not_found",
          message: `No document matches identifier '${ident}'`,
          identifier: ident,
        };
      }
      return doc;
    },

    // fq.write_document({ mode, path?, title?, identifier?, content?, frontmatter?, tags? })
    write_document: (arg, ctx) => {
      const mode = String(arg.mode ?? "");
      if (mode !== "create" && mode !== "update") {
        const err: Record<string, Value> = {
          error: "invalid_input",
          message: `mode is required; use mode: "create" or mode: "update"`,
          identifier: String(arg.path ?? arg.identifier ?? ""),
        };
        return err;
      }
      ctx.log(`[fq] write_document(${stringifyValue(arg)})`);
      const id = mode === "create" ? `doc_${nextId("doc")}` : String(arg.identifier ?? "");
      const ok: Record<string, Value> = {
        identifier: (arg.path ?? arg.identifier ?? id) as Value,
        title: (arg.title ?? "(untitled)") as Value,
        path: (arg.path ?? `Vault/${id}.md`) as Value,
        fq_id: id,
        modified: new Date().toISOString(),
        size: { chars: typeof arg.content === "string" ? arg.content.length : 0 },
        mode,
      };
      return ok;
    },

    // fq.move_document({ identifier, destination_path })
    move_document: (arg, ctx) => {
      ctx.log(`[fq] move_document(${stringifyValue(arg)})`);
      return {
        identifier: arg.destination_path,
        title: "(moved)",
        path: arg.destination_path,
        fq_id: arg.identifier,
        modified: new Date().toISOString(),
        size: { chars: 0 },
      };
    },

    // fq.apply_tags({ targets, tags })
    apply_tags: (arg, ctx) => {
      ctx.log(`[fq] apply_tags(${stringifyValue(arg)})`);
      const targets = Array.isArray(arg.targets) ? arg.targets : [];
      return targets.map((t) => {
        const o = (t as Record<string, Value>) ?? {};
        return {
          identifier: o.identifier,
          fq_id: o.identifier,
          modified: new Date().toISOString(),
          tags_applied: arg.tags,
        };
      });
    },

    // fq.archive_document({ identifiers })
    archive_document: (arg, ctx) => {
      ctx.log(`[fq] archive_document(${stringifyValue(arg)})`);
      const ids = Array.isArray(arg.identifiers) ? arg.identifiers : [arg.identifiers];
      return ids.map((id) => ({
        identifier: id,
        fq_id: id,
        status: "archived",
        archived_at: new Date().toISOString(),
      }));
    },

    // fq.manage_directory({ action, paths })
    manage_directory: (arg, ctx) => {
      const action = String(arg.action ?? "");
      const paths = Array.isArray(arg.paths) ? arg.paths : [];
      ctx.log(`[fq] manage_directory(${stringifyValue(arg)})`);
      if (action !== "create" && action !== "remove") {
        return {
          error: "invalid_input",
          message: `action must be "create" or "remove"`,
          identifier: stringifyValue(arg.paths),
        };
      }
      return paths.map((p) => ({
        path: p,
        action,
        completed_at: new Date().toISOString(),
      }));
    },

    // fq.insert_in_doc({ identifier, position, content, heading?, ... })
    insert_in_doc: (arg, ctx) => {
      ctx.log(`[fq] insert_in_doc(${stringifyValue(arg)})`);
      return {
        identifier: arg.identifier,
        fq_id: arg.identifier,
        modified: new Date().toISOString(),
        size: { chars: typeof arg.content === "string" ? arg.content.length : 0 },
        inserted_at: { position: arg.position, heading: arg.heading ?? null },
      };
    },

    // fq.call_model({ resolver, name?, messages?, parameters?, trace_id?, ... })
    //
    // Per OQ #11 resolution (2026-05-12): model calls inside macros use this
    // tool directly. The earlier `ask`/`ask_json` builtins are dropped — they
    // were an unnecessary rename of call_model.
    //
    // Six resolvers per the actual call_model spec:
    //   "model"          — direct model invocation; requires name + messages
    //   "purpose"        — purpose-based invocation; requires name + messages
    //   "list_models"    — returns configured models; no LLM call
    //   "list_purposes"  — returns configured purposes; no LLM call
    //   "search"         — search models/purposes by name/description
    //   "help"           — returns help content describing the tool
    //
    // No default: caller MUST specify a resolver.
    //
    // For structured output (formerly `ask_json`'s job), pass a
    // response_format inside parameters, e.g.:
    //   parameters: { response_format: { type: "json_schema",
    //                                    schema: { ready: "boolean" } } }
    // The mock here returns canned structured data when it sees such a request.
    call_model: (arg, ctx) => {
      const resolver = String(arg.resolver ?? "");

      if (!resolver) {
        const err: Record<string, Value> = {
          error: "invalid_input",
          message: "call_model requires a resolver",
          identifier: "(missing)",
        };
        return err;
      }

      // Discovery resolvers — no LLM call, return config data
      if (resolver === "list_models") {
        ctx.log(`[fq] call_model({resolver: list_models}) -> 2 canned models`);
        const r: Record<string, Value> = {
          models: [
            { name: "haiku", provider: "anthropic", model_id: "claude-haiku-4-5" },
            { name: "opus",  provider: "anthropic", model_id: "claude-opus-4-6" },
          ],
        };
        return r;
      }
      if (resolver === "list_purposes") {
        ctx.log(`[fq] call_model({resolver: list_purposes}) -> 3 canned purposes`);
        const r: Record<string, Value> = {
          purposes: [
            { name: "summarizer",       model: "haiku", description: "concise summaries" },
            { name: "draft-reviewer",   model: "haiku", description: "assess draft readiness" },
            { name: "spec-synthesizer", model: "opus",  description: "synthesize multiple reviews" },
          ],
        };
        return r;
      }
      if (resolver === "search") {
        const query = String((arg.parameters as Record<string, Value> | undefined)?.query ?? "");
        ctx.log(`[fq] call_model({resolver: search, query: "${query}"}) -> 1 canned hit`);
        const r: Record<string, Value> = {
          matches: [
            { kind: "purpose", name: "summarizer", description: "concise summaries" },
          ],
        };
        return r;
      }
      if (resolver === "help") {
        ctx.log(`[fq] call_model({resolver: help}) -> help text`);
        const r: Record<string, Value> = {
          help: "call_model: invoke an LLM via 'model' or 'purpose' resolver, or use 'list_models'/'list_purposes'/'search' for discovery.",
        };
        return r;
      }

      // Real model invocations (mocked)
      if (resolver !== "model" && resolver !== "purpose") {
        const r: Record<string, Value> = {
          error: "invalid_input",
          message: `unknown resolver: "${resolver}"`,
          identifier: resolver,
        };
        return r;
      }

      const name = String(arg.name ?? "");
      const messages = Array.isArray(arg.messages) ? arg.messages : [];
      if (!name) {
        const r: Record<string, Value> = {
          error: "invalid_input",
          message: `call_model with resolver="${resolver}" requires a name`,
          identifier: "(missing)",
        };
        return r;
      }
      if (messages.length === 0) {
        const r: Record<string, Value> = {
          error: "invalid_input",
          message: `call_model with resolver="${resolver}" requires messages`,
          identifier: name,
        };
        return r;
      }

      // Check for structured-output request
      const params = arg.parameters as Record<string, Value> | undefined;
      const responseFormat = params?.response_format as Record<string, Value> | undefined;
      const wantsStructured = responseFormat?.type === "json_schema";

      autoProgress(ctx, `model_call start: ${resolver}=${name}`);
      ctx.log(`[fq] call_model({resolver: ${resolver}, name: ${name}, messages: [${messages.length} msg]${wantsStructured ? ", structured" : ""}})`);
      autoProgress(ctx, `model_call done:  ${resolver}=${name}`);

      if (wantsStructured) {
        // Canned structured response: alternates "ready" based on the first
        // input message's content, similar to the old mock_ask_json behavior.
        const firstContent = JSON.stringify(messages[0]);
        const ready = !firstContent.includes("doc_b");
        const r: Record<string, Value> = {
          content: JSON.stringify({
            ready,
            reason: ready ? "all sections present" : "missing sign-off section",
          }),
          ready,
          reason: ready ? "all sections present" : "missing sign-off section",
          model_used: resolver === "purpose" ? `${name}->haiku` : name,
          usage: { input_tokens: 120, output_tokens: 30, cost_usd: 0.0001 },
        };
        return r;
      }

      // Canned free-form response
      const r: Record<string, Value> = {
        content: "<canned model response text>",
        model_used: resolver === "purpose" ? `${name}->haiku` : name,
        usage: { input_tokens: 100, output_tokens: 50, cost_usd: 0.0002 },
      };
      return r;
    },

    // ----- Tier 2: fq.search_tools (REQ-082..087) -----
    //
    // Canned single-shot retrieval over known tools. Production uses a
    // BM25 indexer per REQ-074..081; the golden returns a fixed list
    // keyed loosely off the query (substring match on tool name +
    // description). Always populates `has_help` + `help_hint` for
    // FQ-native results per REQ-083 — both fields are omitted for
    // brokered results.
    //
    // Args: { query: string, limit?: number = 8, server_filter?: string }
    // Returns: SearchResult[] per REQ-082.
    search_tools: (arg, ctx) => {
      const query = String(arg.query ?? "").toLowerCase();
      const limit = typeof arg.limit === "number" ? Math.max(1, Math.min(50, arg.limit)) : 8;
      const serverFilter = typeof arg.server_filter === "string" ? arg.server_filter : null;
      ctx.log(`[fq] search_tools(query: "${query}", limit: ${limit}${serverFilter ? `, server_filter: ${serverFilter}` : ""})`);

      // Mock corpus — (server, tool, description, arg_summary) tuples.
      // REQ-082 ac3: `arg_summary` is a short, human-readable summary of
      // the tool's argument shape. Production reads this from the
      // tool's metadata; the mock supplies a canned value per tool.
      type Entry = { server: string; tool: string; description: string; arg_summary: string };
      const corpus: Entry[] = [
        { server: "fq", tool: "search", description: "Free-text search over vault documents.", arg_summary: "query: string, entity_types?: string[], tags?: string[]" },
        { server: "fq", tool: "get_document", description: "Read a single document by identifier or path.", arg_summary: "identifiers: string, include?: string[]" },
        { server: "fq", tool: "write_document", description: "Create or update a document. Modes: create, update.", arg_summary: "mode: string, identifier?: string, path?: string, title?: string, content?: string, frontmatter?: object, tags?: string[]" },
        { server: "fq", tool: "move_document", description: "Move a document to a new path.", arg_summary: "identifier: string, destination_path: string" },
        { server: "fq", tool: "apply_tags", description: "Apply tags to documents.", arg_summary: "targets: object[], tags: string[]" },
        { server: "fq", tool: "archive_document", description: "Soft-archive documents.", arg_summary: "identifiers: string | string[]" },
        { server: "fq", tool: "manage_directory", description: "Create or remove vault directories.", arg_summary: "action: string, paths: string[]" },
        { server: "fq", tool: "insert_in_doc", description: "Insert content at a position inside a document.", arg_summary: "identifier: string, position: string, content: string, heading?: string" },
        { server: "fq", tool: "call_model", description: "Invoke an LLM via resolver: model | purpose | list_models | list_purposes | search | help.", arg_summary: "resolver: string, name?: string, messages?: object[], parameters?: object" },
        { server: "fq", tool: "search_tools", description: "BM25 search across known tools.", arg_summary: "query: string, limit?: number, server_filter?: string" },
        { server: "brave_search", tool: "web_search", description: "Web search via Brave Search MCP.", arg_summary: "query: string, count?: number" },
        { server: "web_fetch", tool: "fetch", description: "Fetch a URL and return its content.", arg_summary: "url: string, max_bytes?: number" },
      ];

      // Naive scorer: count of query tokens present in `tool` + `description`.
      const tokens = query.split(/\s+/).filter((t) => t.length > 0);
      const scored = corpus
        .filter((e) => serverFilter === null || e.server === serverFilter)
        .map((e) => {
          const hay = `${e.tool} ${e.description}`.toLowerCase();
          let score = 0;
          for (const t of tokens) if (hay.includes(t)) score += 1;
          return { entry: e, score };
        })
        .filter((s) => s.score > 0 || tokens.length === 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      const maxScore = scored[0]?.score ?? 1;
      const results: Value[] = scored.map(({ entry, score }) => {
        const r: Record<string, Value> = {
          server: entry.server,
          tool: entry.tool,
          tool_name: `${entry.server}.${entry.tool}`,
          description: entry.description,
          score,
          normalizedScore: maxScore > 0 ? score / maxScore : 0,
          // REQ-082 ac3: every SearchResult carries an `arg_summary`
          // short string describing the tool's argument shape.
          arg_summary: entry.arg_summary,
        };
        // REQ-083: has_help + help_hint populated ONLY for fq-native results.
        if (entry.server === "fq") {
          r.has_help = true;
          r.help_hint = CANONICAL_HELP_HINT;
        }
        return r;
      });

      return results;
    },
  },
};

// REQ-048: honor progress mode. `silent` emits NO progress (stderr or trace);
// `milestones` is treated like `full` for these brokered-tool emissions because
// model-call start/done are inherently milestones (they bracket an external
// call); `full` emits both stderr and a trace step.
function autoProgress(ctx: CallContext, message: string): void {
  const mode = ctx.exec?.progressMode ?? "full";
  if (mode === "silent") return;
  process.stderr.write(`[PROGRESS] ${message}\n`);
  ctx.exec?.taskRegistry.appendTrace({ kind: "progress", message });
}

// The default tool registry shipped with the prototype. Three servers:
//
// - `fq` — FlashQuery's own tools, dispatched in-process. The macro engine
//   treats this as just another broker entry; there's no special-case code
//   path for "native" vs. "brokered."
//
// - `brave_search` — example brokered MCP server for web search. In
//   production this would be reached via stdio (the npm-published
//   `@brave/brave-search-mcp-server` package) or via streamable HTTP if
//   pointing at a hosted endpoint. The macro engine doesn't see the
//   transport choice.
//
// - `web_fetch` — example brokered MCP server for loading specific URLs.
//   Same transport-agnosticism as above.
//
// The macro engine looks up `<server>.<tool>` in this registry and
// dispatches through whichever handler the server entry provides. New
// brokered servers slot in as additional entries without any macro-engine
// changes.
export const defaultToolRegistry: ToolRegistry = {
  fq: fqServer,
  brave_search: braveSearchServer,
  web_fetch: webFetchServer,
  // Tier 2 (v0.2.0): synthetic brokered server demonstrating each of the
  // five CallToolResult coercion paths from REQ-106 plus the
  // needs_user_input nested-propagation path from REQ-105.
  coerce_demo: coerceDemoServer,
};

// Tier 2 (REQ-093 / REQ-098): wire the help-page provider so the macro
// engine can resolve `help: true` sentinel calls without a circular
// import. Production replaces this with a `TOOL_META`-backed lookup that
// reads from `.tool.md` files.
setHelpPageProvider((key: string) => HELP_PAGES[key]);
