// Mock brokered MCP server entries.
//
// These demonstrate that the macro engine's namespaced-dispatch model
// supports first-class tool calls into *external* MCP servers — not just
// FlashQuery's own. The same `ServerEntry` shape that holds `fq` (the
// in-process FlashQuery broker) also holds these brokered servers.
//
// Tier 2 (v0.2.0) — brokered handlers return `CallToolResult` envelopes
// (per REQ-106 / REQ-107). The macro engine detects the envelope shape
// (presence of `content` / `structuredContent` / `isError` fields with
// the canonical CallToolResult contract) and applies the five-step
// coercion rule before binding the value to the macro. Native `fq.*`
// handlers continue to return plain `Value` (no coercion is applied —
// REQ-106 step 0).
//
// In production:
// - `brave_search` would be the real Brave Search MCP server, reached via
//   whatever transport the broker config specifies (stdio for the local
//   `@brave/brave-search-mcp-server` package; streamable HTTP for a hosted
//   endpoint).
// - `web_fetch` would be a generic page-fetching MCP server (e.g.,
//   `@modelcontextprotocol/server-fetch`), again with the transport chosen
//   at config time.
// - `coerce_demo` is a synthetic brokered server invented for Example 23
//   that returns each of the five CallToolResult shapes from a single
//   server — used to validate the coercion paths end-to-end without
//   needing five real servers.
//
// The macro engine doesn't see any of that. From the engine's perspective,
// each brokered server is just a `ServerEntry` whose handlers take a JSON
// object and return a value. The transport choice (stdio vs. streamable
// HTTP vs. anything else) is encapsulated in the broker layer that
// constructs these entries — not in the macro engine.

import type { CallToolResult } from "./broker.ts";
import type { ServerEntry, Value } from "./types.ts";
import { stringifyValue } from "./evaluator.ts";

// ----- Mock Brave Search server -----
//
// Real tool surface (from @brave/brave-search-mcp-server):
//   brave_web_search    — broad web search
//   brave_local_search  — local business / POI search
//
// We mock only `web_search` here; it's enough to demonstrate the pattern.

const cannedHits = [
  {
    url: "https://example.com/flashquery-overview",
    title: "FlashQuery: A document-first MCP server",
    description: "Overview of FlashQuery's design and the macro language project.",
  },
  {
    url: "https://example.com/macro-language-deep-dive",
    title: "Deep dive on the FlashQuery macro language",
    description: "Surface syntax, dispatch model, and the inline-ASM analogy.",
  },
  {
    url: "https://example.com/mcp-brokers-pattern",
    title: "The MCP broker pattern in practice",
    description: "How FlashQuery brokers external MCP servers into delegated-model tool belts.",
  },
];

export const braveSearchServer: ServerEntry = {
  label: "Brave Search MCP (mock)",
  tools: {
    // brave_search.web_search({ query, count? })
    // -> array of { url, title, description }
    //
    // Tier 2: returns a `CallToolResult` envelope (REQ-106). The macro
    // engine applies the five-step coercion rule; the results land in
    // `structuredContent`, which binds directly per step 2.
    web_search: (arg, ctx) => {
      const query = String(arg.query ?? "");
      const requested = typeof arg.count === "number" ? Math.max(1, Math.min(10, arg.count)) : 3;
      const results = cannedHits.slice(0, Math.min(requested, cannedHits.length));
      ctx.log(`[brave_search] web_search(${stringifyValue(arg)}) -> ${results.length} hits for "${query}"`);
      const envelope: CallToolResult = {
        structuredContent: results as unknown as Value,
        content: [{ type: "text", text: JSON.stringify(results) }],
      };
      return envelope as unknown as Value;
    },
  },
};

// ----- Mock web-fetch server -----
//
// Demonstrates loading a specific URL and returning page content. In a real
// deployment this would be the @modelcontextprotocol/server-fetch package
// or an equivalent. The mock returns canned content keyed by URL so the
// research example produces a deterministic, inspectable trace.

const cannedPages: Record<string, { content: string; content_type: string }> = {
  "https://example.com/flashquery-overview": {
    content: "FlashQuery is a document-first MCP server. The macro language enables...",
    content_type: "text/markdown",
  },
  "https://example.com/macro-language-deep-dive": {
    content: "The macro language has two consistent layers: shell-style control flow plus...",
    content_type: "text/markdown",
  },
  "https://example.com/mcp-brokers-pattern": {
    content: "Brokers let FlashQuery present a uniform tool surface to delegated models...",
    content_type: "text/markdown",
  },
};

export const webFetchServer: ServerEntry = {
  label: "Web fetch MCP (mock)",
  tools: {
    // web_fetch.fetch({ url })
    // -> { url, status, content, content_type, fetched_at }
    //
    // Tier 2: returns a `CallToolResult` envelope. The macro engine
    // applies coercion — happy-path lands in `structuredContent` (step 2).
    fetch: (arg, ctx) => {
      const url = String(arg.url ?? "");
      const canned = cannedPages[url];
      if (!canned) {
        ctx.log(`[web_fetch] fetch(${stringifyValue(arg)}) -> 404 not found`);
        // REQ-107: fail-fast on `isError`. The macro frame raises `fail`;
        // the macro author's existing `_exists()` guard does NOT cover
        // per-call failures — those flow through this envelope.
        const errEnv: CallToolResult = {
          isError: true,
          content: [{ type: "text", text: `web_fetch: no canned page for ${url}` }],
        };
        return errEnv as unknown as Value;
      }
      ctx.log(`[web_fetch] fetch(${stringifyValue(arg)}) -> 200 ${canned.content.length} chars`);
      const okEnv: CallToolResult = {
        structuredContent: {
          url,
          status: 200,
          content: canned.content,
          content_type: canned.content_type,
          fetched_at: new Date().toISOString(),
        } as unknown as Value,
      };
      return okEnv as unknown as Value;
    },
  },
};

// ----- Mock coercion-demo server (Tier 2 / REQ-106) -----
//
// Synthetic server invented for Example 23 to demonstrate all five
// coercion paths from a single, controlled source. Each tool returns a
// CallToolResult crafted to land in one specific path.
//
// PROD-NOTE: production should ship integration tests against real
// brokered servers exhibiting these shapes (probe-derived fixtures). The
// golden's synthetic server is a teaching tool for testgen authors —
// when writing a coercion-path test, fan it through these handlers and
// inspect the `coerce` state_note to confirm the path taken.

export const coerceDemoServer: ServerEntry = {
  label: "Coerce-demo brokered server (synthetic)",
  tools: {
    // coerce_demo.structured: returns structuredContent only — coerce
    // path "structured_content" (REQ-106 step 2).
    structured: (_arg, ctx) => {
      ctx.log(`[coerce_demo] structured() -> structuredContent path`);
      const env: CallToolResult = {
        structuredContent: { kind: "structured", payload: [1, 2, 3] } as unknown as Value,
      };
      return env as unknown as Value;
    },

    // coerce_demo.json_text: returns content[0].text with a JSON-parseable
    // string. Coerce path "json_text" (REQ-106 step 3).
    json_text: (_arg, ctx) => {
      ctx.log(`[coerce_demo] json_text() -> json_text path`);
      const env: CallToolResult = {
        content: [
          { type: "text", text: JSON.stringify({ parsed: true, numbers: [4, 5, 6] }) },
        ],
      };
      return env as unknown as Value;
    },

    // coerce_demo.raw_string: returns content[0].text with non-JSON text.
    // Coerce path "raw_string" (REQ-106 step 4).
    raw_string: (_arg, ctx) => {
      ctx.log(`[coerce_demo] raw_string() -> raw_string path`);
      const env: CallToolResult = {
        content: [{ type: "text", text: "hello, world (not JSON)" }],
      };
      return env as unknown as Value;
    },

    // coerce_demo.multimodal: returns content with no `text` items (the
    // multimodal case). Coerce path "passthrough" (REQ-106 step 5).
    multimodal: (_arg, ctx) => {
      ctx.log(`[coerce_demo] multimodal() -> passthrough path`);
      const env: CallToolResult = {
        content: [{ type: "image" } as { type: string }],
      };
      return env as unknown as Value;
    },

    // coerce_demo.is_error: returns isError:true. Coerce path "is_error"
    // — engine raises `fail` BEFORE coercion (REQ-106 step 1 + REQ-107).
    is_error: (_arg, ctx) => {
      ctx.log(`[coerce_demo] is_error() -> isError raises fail`);
      const env: CallToolResult = {
        isError: true,
        content: [{ type: "text", text: "synthetic upstream failure: demo isError path" }],
      };
      return env as unknown as Value;
    },

    // coerce_demo.needs_user_input: returns a needs_user_input envelope
    // shape (REQ-105 nested propagation). When the macro engine sees this
    // shape, it raises `MacroNeedsUserInputError` instead of binding the
    // value — demonstrating the broker-emit path.
    needs_user_input: (_arg, ctx) => {
      ctx.log(`[coerce_demo] needs_user_input() -> propagate as macro exit`);
      const env: CallToolResult = {
        structuredContent: {
          event: "needs_user_input",
          question: "Upstream needs to confirm: which workspace?",
          answer_shape: "frontmatter.workspace",
          options: ["personal", "team"],
        } as unknown as Value,
      };
      return env as unknown as Value;
    },
  },
};
