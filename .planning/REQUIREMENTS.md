# Requirements: FlashQuery Core v3.5 MCP Broker

**Defined:** 2026-05-17
**Core Value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.

## Milestone Goal

FlashQuery becomes a stdio MCP broker. Host LLM sessions and delegated `call_model` purposes can see a unified flat tool surface mixing FlashQuery-native tools with brokered external MCP server tools, while FlashQuery remains the intermediary for discovery, filtering, dispatch, tracing, and safety.

**Source requirements:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Requirements.md`
**Source test plan:** `/Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-product/Roadmap/Features/MCP Broker/MCP Broker Test Plan.md`

## v3.5 Requirements

### Configuration

- [x] **REQ-001**: Top-level `mcp_servers:` map parses against the schema in source spec §6.6.
- [x] **REQ-002**: Per-server `cost_per_call` defaults to `0` when unset.
- [x] **REQ-003**: Per-tool `cost_per_call` override resolves before server default.
- [x] **REQ-004**: Per-tool `description_override` substitutes the description seen by every downstream consumer.
- [x] **REQ-005**: `host:` section is optional; absence means FQ-native-only host surface.
- [x] **REQ-006**: Empty `host: {}` is valid and equivalent to absent.
- [x] **REQ-007**: `host.mcp_servers` lists server IDs that must exist in the top-level `mcp_servers:` map.
- [x] **REQ-008**: `purposes.<name>.mcp_servers` follows the same strictness as REQ-007.
- [x] **REQ-009**: `host.tool_search` defaults to `disabled`.
- [x] **REQ-010**: `host.tool_search: enabled` builds a host index at startup.
- [x] **REQ-011**: `purposes.<name>.tool_search: enabled` builds a per-invocation index at `call_model` engine-init time.
- [x] **REQ-012**: Hot-reload of `flashquery.yml` is not supported in v1.

### Broker Foundation

- [x] **REQ-013**: Lazy spawn per server on first reference.
- [x] **REQ-014**: Per-server promise-lock prevents cold-spawn races.
- [x] **REQ-015**: Stdio transport is the only v1 transport.
- [x] **REQ-016**: `env` substitution from `process.env` is supported.
- [x] **REQ-017**: `tools/list` discovery runs on connect.
- [x] **REQ-018**: Per-call timeout defaults to 30 seconds and is configurable per server.
- [x] **REQ-019**: Shutdown grace timeout defaults to 5 seconds, then SIGKILL.
- [x] **REQ-020**: Process-death detection performs one restart attempt.
- [x] **REQ-021**: Client capabilities are `{}` with no advertised reverse-request capabilities.
- [x] **REQ-022**: Stderr is captured and surfaced on connect failure.
- [x] **REQ-023**: Stderr lines are not interleaved into responses.
- [x] **REQ-024**: Connection lifetime is session-scoped.
- [x] **REQ-025**: Reconnect within the same FlashQuery session preserves TOFU map state.
- [x] **REQ-026**: Server config change between FlashQuery starts resets TOFU for that server.

### Registry And Dispatch

- [x] **REQ-027**: Registry is keyed by `(serverId, toolName)` with one `RegistryKey` string form.
- [x] **REQ-028**: `parseMacroRef(ref)` splits on the first dot only.
- [x] **REQ-029**: `makeRegistryKey(serverId, toolName)` produces the LLM-facing tool name.
- [x] **REQ-030**: FQ-native tools are not registry-keyed with an `fq__` prefix.
- [x] **REQ-031**: A single registry supports per-consumer filtered views.
- [x] **REQ-032**: Tool-name collisions across servers retain unique registry keys.
- [ ] **REQ-033**: `tool-dispatcher.ts` routes brokered registry keys to `Broker.callTool`.
- [ ] **REQ-034**: Brokered `CallToolResult` values are wrapped as `NativeToolResponse` for the agent loop.
- [ ] **REQ-035**: Dispatch routing respects consumer visibility.
- [x] **REQ-036**: Concurrent brokered calls to the same server are safe.
- [ ] **REQ-037**: Arguments pass through without engine-side type coercion.

### TOFU And Safety

- [ ] **REQ-038**: TOFU hash is SHA-256 over canonical JSON of `{name, description, inputSchema}`.
- [ ] **REQ-039**: TOFU storage is in-memory and FlashQuery-process-scoped.
- [ ] **REQ-040**: First observation of a `(server, tool)` pair is silently trusted.
- [ ] **REQ-041**: Hash mismatch on subsequent observation triggers re-approval.
- [ ] **REQ-042**: Re-approval payload carries old schema, new schema, and diff summary.
- [ ] **REQ-043**: Approval replaces the hash and re-adds the tool to the indexer.
- [ ] **REQ-044**: Rejection preserves the old hash and removes the tool from the registry.
- [ ] **REQ-045**: `notifications/tools/list_changed` supports bulk re-approval.
- [ ] **REQ-046**: Every TOFU approval or rejection is audit-logged.
- [ ] **REQ-047**: TOFU map entries are retained when tools are removed.
- [ ] **REQ-048**: No re-approval prompt rate limiting exists in v1.
- [ ] **REQ-049**: If no interactive chat session exists, schema drift records an event, blocks the tool, and does not prompt.
- [x] **REQ-058**: Sampling capability is not advertised or handled.
- [x] **REQ-059**: Elicitation capability is not advertised or handled.
- [x] **REQ-060**: Brokered tools cannot trigger `needs_user_input` in v1.

### Errors, Health, Notifications, And Observability

- [x] **REQ-050**: Every broker-emitted error normalizes through `formatToolError(input)`.
- [x] **REQ-051**: `ToolErrorKind` discriminated union is the canonical taxonomy.
- [x] **REQ-052**: `experimental_tasks_required` subkind is emitted when the SDK error matches the required regex.
- [x] **REQ-053**: `raw` is stripped before any process-boundary egress.
- [x] **REQ-054**: `Broker.isConnected(serverId, opts)` is a live probe.
- [x] **REQ-055**: Default connection-health mode is deep probe.
- [x] **REQ-056**: Shallow probe is opt-in.
- [x] **REQ-057**: Future HTTP brokers use protocol-level `tools/list` no-op probing.
- [ ] **REQ-061**: Subscribe to `notifications/tools/list_changed` at every brokered server connect.
- [ ] **REQ-062**: Diff routing handles new, changed, and removed tools.
- [ ] **REQ-063**: Indexer updates from `list_changed` are synchronous in the notification handler.
- [ ] **REQ-064**: Diff classification utility is reusable.
- [ ] **REQ-065**: Per-`call_model` trace records gain a `tool_calls` array.
- [ ] **REQ-066**: Host-initiated brokered calls also produce `tool_calls` entries.
- [ ] **REQ-067**: Host-invoked macros inherit the host trace scope.
- [ ] **REQ-068**: Rejected reverse requests are audit-logged.
- [ ] **REQ-069**: `search_tools` invocations are audit-logged.
- [ ] **REQ-070**: TOFU approvals and rejections are audit-logged.

### Diagnostic CLI

- [ ] **REQ-071**: `flashquery list-tools <server>` connects to the configured server, calls `tools/list`, and exits.
- [ ] **REQ-072**: CLI output is paste-ready YAML under `mcp_servers.<server>.tool_overrides:`.
- [ ] **REQ-073**: CLI failures surface stderr.

### BM25 Tool Search

- [ ] **REQ-074**: Indexer interface is fixed and algorithm parameters are pinned.
- [ ] **REQ-075**: Indexer is pure TypeScript with zero external dependency.
- [ ] **REQ-076**: `build(tools)` is idempotent.
- [ ] **REQ-077**: `addTools(tools)` is idempotent.
- [ ] **REQ-078**: `removeTools(keys)` tolerates nonexistent keys.
- [ ] **REQ-079**: `search(query, k)` returns up to `k` ranked results and empty query returns empty array.
- [ ] **REQ-080**: `getStats()` reports live counts, not tombstones.
- [ ] **REQ-081**: The four NTS correctness invariants are unit tests in production.
- [ ] **REQ-082**: `fq.search_tools` MCP tool surface is implemented.
- [ ] **REQ-083**: `has_help` and `help_hint` are populated only for FQ-native results.
- [ ] **REQ-084**: `SearchResult.description` reflects `description_override` when set.
- [ ] **REQ-085**: `tool_search: enabled` purposes inject only `fq.search_tools` up front.
- [ ] **REQ-086**: `tool_search: disabled` purposes keep existing flat-list behavior.
- [ ] **REQ-087**: Host index covers FQ-native and brokered tools visible to the host.
- [ ] **REQ-088**: BM25 POC test-data fixtures graduate to production.

### Help Convention And Description Overrides

- [ ] **REQ-089**: Each FQ-native tool has one `.tool.md` file at `src/mcp/tools/<tool_name>.tool.md`.
- [ ] **REQ-090**: `.tool.md` frontmatter shape is enforced.
- [ ] **REQ-091**: Help-page body structure follows the 500-1500 word soft guideline.
- [ ] **REQ-092**: `TOOL_META` registry is built at startup from `*.tool.md`.
- [ ] **REQ-093**: `help: true` sentinel handler returns help pages.
- [ ] **REQ-094**: Canonical default `help_hint` string is used.
- [ ] **REQ-095**: Build-time validation rules are blocking.
- [ ] **REQ-096**: FQ-native errors include the Layer 2 help hint footer.
- [ ] **REQ-097**: `call_macro` description and help hint use the required verbatim strings.
- [ ] **REQ-098**: `help: true` against brokered tools forwards transparently upstream.
- [ ] **REQ-099**: Hot-reload of `.tool.md` files is out of scope.
- [ ] **REQ-100**: `description_override` is substituted before any downstream consumer.
- [ ] **REQ-101**: TOFU hashes the upstream description, not the override.
- [ ] **REQ-102**: Removing or changing `description_override` does not trigger TOFU re-approval.

### Macro Extensions And Host Surface

- [ ] **REQ-103**: `_self` engine binding is available for `source_ref` macros.
- [ ] **REQ-104**: `continue` and `break` loop-control statements are supported.
- [ ] **REQ-105**: `needs_user_input` macro exit reason is supported.
- [x] **REQ-106**: `CallToolResult` coercion rule includes the `isError` carve-out.
- [x] **REQ-107**: Brokered-tool errors propagate fail-fast by default.
- [x] **REQ-108**: Macro object arguments pass through without coercion.
- [ ] **REQ-109**: `<server>._exists()` uses deep probe.
- [ ] **REQ-110**: Concurrent macro execution against shared brokered servers is safe.
- [ ] **REQ-111**: Brokered tools have no broker-side tier classification.
- [ ] **REQ-112**: Macro pre-scan continues to use the agent-loop native-tool tier system unchanged.
- [ ] **REQ-113**: `host:` section design follows source spec §6.6.
- [ ] **REQ-114**: Consumer context is inherited across nested macro frames.
- [ ] **REQ-115**: `ConsumerContext` is established once at the outermost frame.
- [ ] **REQ-116**: `Broker.listToolsForConsumer(ctx)` returns the filtered view.
- [ ] **REQ-117**: Lazy spawn is unified across host and delegated consumers.
- [ ] **REQ-118**: TOFU pins are shared across consumers.

## Future Requirements

- Streamable HTTP transport and OAuth/DCR support for remote MCP servers.
- MCP resources, prompts, sampling, and elicitation forwarding.
- Persistent TOFU across FlashQuery restarts.
- Semantic vector tool routing beyond BM25.
- Fine-grained per-tool subsetting inside `host.mcp_servers` and `purposes.<name>.mcp_servers`.
- Server-side rate limiting beyond macro budgets and upstream server controls.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Streamable HTTP transport | v3.5 is stdio-first; HTTP can land without changing the broker architecture. |
| OAuth 2.1 / Dynamic Client Registration | Tied to future HTTP transport. |
| MCP resources and prompts | Vault remains FlashQuery's passive-read surface for this milestone. |
| Sampling and elicitation forwarding | Broker v1 does not advertise or handle reverse-request capabilities. |
| Multi-tenant gateway behavior | FlashQuery remains single-user/local-first. |
| Semantic vector tool routing | BM25 is the selected v1 strategy at FlashQuery-scale tool counts. |
| Hot-reload of `flashquery.yml` or `.tool.md` | Restart-required is explicit v1 behavior. |
| Persistent TOFU across restarts | In-memory, process-scoped TOFU is the selected v1 tradeoff. |
| Broker-side tool tier classification | Brokered visibility is controlled by configured server membership. |

## Traceability

| Requirement Range | Phase | Status |
|-------------------|-------|--------|
| REQ-001..037, REQ-050..060, REQ-106..108 | Phase 139 | Pending |
| REQ-038..049, REQ-061..064, REQ-068, REQ-070, REQ-105 | Phase 140 | Pending |
| REQ-074..102, REQ-011, REQ-085..087 | Phase 141 | Pending |
| REQ-005..010, REQ-031, REQ-035, REQ-065..067, REQ-113..118 | Phase 142 | Pending |
| REQ-071..073, REQ-103..104, REQ-109..110 | Phase 143 | Pending |

**Coverage:**
- v3.5 requirements: 118 total
- Mapped to phases: 118
- Unmapped: 0

---
*Requirements defined: 2026-05-17*
*Last updated: 2026-05-17 after milestone initialization*
