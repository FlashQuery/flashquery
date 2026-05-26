---
gsd_state_version: 1.0
milestone: v3.8
milestone_name: Codebase Audit Remaining Remediation
status: executing
stopped_at: Completed 154-05-PLAN.md
last_updated: "2026-05-26T00:14:34.594Z"
last_activity: 2026-05-25 -- Completed 154-01-PLAN.md
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 13
  completed_plans: 11
  percent: 75
---

# FlashQuery Core — State

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-25)

**Core value:** Any MCP-compatible AI can save and retrieve organized, persistent, searchable data the user owns — across tools, across sessions, with zero vendor lock-in.
**Current focus:** Phase 154 residual import-cycle cleanup

## Current Position

Phase: 154
Plan: 02
Status: Ready to execute
Last activity: 2026-05-25 -- Completed 154-01-PLAN.md

## Accumulated Context

### Roadmap Evolution

- Phase 154 added: Residual Import Cycle Cleanup

## v3.7 Deferred Items

Items acknowledged and deferred at milestone close on 2026-05-25:

| Category | Item | Status |
|----------|------|--------|
| tech_debt | Phase 149 plugin reconciliation integration evidence is fragile because legacy files are outside the normal integration config and one integration suite remains skipped. | deferred |
| tech_debt | Pre-existing plugin reconciliation tenant-boundary issue: missing instance_id filters in plugin reconciliation queries. | deferred |
| tech_debt | Global zero-cycle policy is not met; target REQ-010/REQ-011 cycle fragments are gone, but unrelated baseline cycles remain. | promoted to Phase 154 |
| validation | Nyquist validation files exist for all phases, but several have stale or non-frontmatter metadata. | deferred |

## Performance Metrics

**Velocity:**

- Total plans completed: 24 (this milestone)
- Average duration: — min
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 121 | 3 | - | - |
| 122 | 4 | - | - |
| 123 | 4 | - | - |
| 124 | 7 | - | - |
| 125 | TBD | - | - |
| 126 | 5 | - | - |
| 127 | 6 | - | - |
| 128 | TBD | - | - |
| 129 | 3 | - | - |
| 130 | 2 | - | - |
| 131 | 5 | - | - |
| 132 | 4 | - | - |
| 133 | 3 | - | - |
| 134 | 5 | - | - |
| 135 | 4 | - | - |
| 136 | 4 | - | - |
| 137 | 5 | - | - |
| 138 | 4 | - | - |
| 141 | 11 | - | - |
| 142 | 6 | - | - |
| 143 | 5 | - | - |
| 144 | 0 | - | - |
| 146 | 4 | - | - |
| 147 | 4 | - | - |
| 148 | 4 | - | - |
| 149 | 4 | - | - |
| 150 | 1 | - | - |
| 151 | 2 | - | - |
| 153 | 3 | - | - |

*Updated after each plan completion*
| Phase 107 P04 | 15m | 2 tasks | 9 files |
| Phase 114 P01 | 4m16s | 2 tasks | 3 files |
| Phase 114 P02 | 6m26s | 2 tasks | 3 files |
| Phase 114 P03 | 3m21s | 2 tasks | 4 files |
| Phase 114 P04 | 4m36s | 2 tasks | 2 files |
| Phase 114 P05 | 10m | 3 tasks | 7 files |
| Phase 115 P01 | 7 min | 3 tasks | 3 files |
| Phase 115 P02 | 4 min | 2 tasks | 4 files |
| Phase 115 P04 | 6 min | 3 tasks | 5 files |
| Phase 115 P03 | 7 min | 3 tasks | 4 files |
| Phase 115 P05 | 9 min | 3 tasks | 7 files |
| Phase 116 P01 | 12min | 2 tasks | 2 files |
| Phase 116 P02 | 4m11s | 2 tasks | 4 files |
| Phase 116 P03 | 5m16s | 2 tasks | 2 files |
| Phase 116 P04 | 12min | 3 tasks | 8 files |
| Phase 117 P01 | 12min | 2 tasks | 6 files |
| Phase 117 P02 | 9min | 2 tasks | 5 files |
| Phase 117 P03 | 6m33s | 2 tasks | 6 files |
| Phase 117 P04 | 16min | 2 tasks | 3 files |
| Phase 117 P05 | 13min | 2 tasks | 5 files |
| Phase 118 P05 | 12min | 2 tasks | 10 files |
| Phase 119 P01 | 6min | 3 tasks | 6 files |
| Phase 119 P02 | 5min | 2 tasks | 7 files |
| Phase 119 P03 | 7min | 2 tasks | 7 files |
| Phase 120 P01 | 12 min | 3 tasks | 1 files |
| Phase 120 P02 | 16 min | 3 tasks | 5 files |
| Phase 120 P03 | 52 | 3 tasks | 8 files |
| Phase 120 P04 | 49 | 3 tasks | 5 files |
| Phase 121 P02 | 6min | 3 tasks | 5 files |
| Phase 123 P01 | 6min | 3 tasks | 8 files |
| Phase 123 P02 | 17min | 3 tasks | 13 files |
| Phase 123 P03 | 14min | 3 tasks | 10 files |
| Phase 123 P04 | 17min | 3 tasks | 13 files |
| Phase 125 P01 | 6 min | 4 tasks | 7 files |
| Phase 125 P02 | 18 min | 4 tasks | 7 files |
| Phase 125 P03 | 10 min | 3 tasks | 6 files |
| Phase 125 P04 | 8 min | 3 tasks | 3 files |
| Phase 125 P05 | 20 min | 3 tasks | 6 files |
| Phase 125 P06 | 60 min | 1 task | 10 files |
| Phase 127 P01 | 9min | 3 tasks | 9 files |
| Phase 127 P02 | 10min | 3 tasks | 6 files |
| Phase 127 P03 | 9m26s | 3 tasks | 8 files |
| Phase 127 P04 | 11min | 3 tasks | 9 files |
| Phase 127 P05 | 30min | 3 tasks | 9 files |
| Phase 127 P06 | 12m20s | 3 tasks | 3 files |
| Phase 129 P03 | 24m26s | 3 tasks | 9 files |
| Phase 130 P02 | 4m32s | 2 tasks | 4 files |
| Phase 130 P01 | 8m04s | 3 tasks | 9 files |
| Phase 131 P01 | 20 min | 2 tasks | 6 files |
| Phase 131 P02 | 18 min | 2 tasks | 5 files |
| Phase 131 P03 | 24 min | 3 tasks | 3 files |
| Phase 131 P04 | 16 min | 1 tasks | 19 files |
| Phase 131 P05 | 10 min | 1 tasks | 3 files |
| Phase 135 P01 | 7m19s | 3 tasks | 7 files |
| Phase 135 P02 | 3m15s | 2 tasks | 3 files |
| Phase 135 P03 | 4m29s | 2 tasks | 3 files |
| Phase 135 P04 | 6m14s | 3 tasks | 4 files |
| Phase 136 P01 | 4m | 3 tasks | 4 files |
| Phase 136 P02 | 4m10s | 2 tasks | 3 files |
| Phase 136 P03 | 3m13s | 2 tasks | 4 files |
| Phase 136 P04 | 14m37s | 3 tasks | 9 files |
| Phase 138 P01 | 5min | 3 tasks | 3 files |
| Phase 138 P02 | 8min | 3 tasks | 6 files |
| Phase 138 P03 | 13m09s | 2 tasks | 5 files |
| Phase 138 P04 | 51m | 3 tasks | 35 files |
| Phase 139 P01 | 5m05s | 2 tasks | 5 files |
| Phase 139 P02 | 5m23s | 3 tasks | 6 files |
| Phase 139 P03 | 28m43s | 3 tasks | 10 files |
| Phase 139 P04 | 13m34s | 5 tasks | 14 files |
| Phase 139 P05 | 14m12s | 2 tasks | 5 files |
| Phase 139 P06 | 36min | 2 tasks | 11 files |
| Phase 140 P01 | 5m45s | 3 tasks | 7 files |
| Phase 140 P02 | 12m09s | 3 tasks | 5 files |
| Phase 140 P03 | 7m23s | 3 tasks | 8 files |
| Phase 140 P04 | 9m26s | 3 tasks | 2 files |
| Phase 140 P05 | 26m13s | 2 tasks | 8 files |
| Phase 140 P06 | 9m12s | 2 tasks | 3 files |
| Phase 142 P01 | 3m02s | 2 tasks | 4 files |
| Phase 142 P02 | 8m | 2 tasks | 7 files |
| Phase 142 P03 | 18m48s | 2 tasks | 13 files |
| Phase 142 P04 | 5m04s | 2 tasks | 4 files |
| Phase 142 P5 | 23m30s | 2 tasks | 10 files |
| Phase 142 P6 | 14m29s | 2 tasks | 6 files |
| Phase 146 P1 | 7m55s | 3 tasks | 6 files |
| Phase 147 P01 | 4m12s | 2 tasks | 2 files |
| Phase 147 P2 | 6m15s | 3 tasks | 6 files |
| Phase 147 P3 | 4m49s | 3 tasks | 5 files |
| Phase 147 P4 | 4m11s | 3 tasks | 3 files |
| Phase 150 P01 | 23 min | 3 tasks | 3 files |
| Phase 151 P01 | 3 min | 2 tasks | 5 files |
| Phase 151 P02 | 4 min | 2 tasks | 8 files |
| Phase 152 P01 | 24 min | 2 tasks | 6 files |
| Phase 152 P02 | 58 min | 2 tasks | 6 files |
| Phase 154 P01 | 4m12s | 2 tasks | 7 files |
| Phase 154 P05 | 2m17s | 2 tasks | 4 files |

## Decisions

- [Phase 142]: 142-01 treated task-level tdd markers as contract-pin coverage because the config and registry behavior already existed; no production implementation was needed.
- [Phase 142]: 142-01 kept host.mcp_servers and host_mcp_tools assertions separate to preserve the source spec's additive host-surface model.
- [Phase 142]: 142-02 host brokered tools register through an uncataloged SDK path so they appear on host tools/list without becoming FQ-native catalog entries or requiring .tool.md metadata.
- [Phase 142]: 142-02 host registration converts broker JSON Schema into SDK-compatible Zod raw shapes at the MCP boundary while preserving BrokeredTool input schemas in broker state.
- [Phase 142]: 142-02 host brokered trace cost is recorded only after Broker.callTool returns, including upstream isError results, and not for thrown broker failures.
- [Phase 142]: 142-03 `tool_calls` metadata is always present for traced `call_model` responses, using an empty array when no brokered calls occurred.
- [Phase 142]: 142-03 nested macro execution preserves the exact outer ConsumerContext via MacroCallerContext rather than reconstructing host defaults.
- [Phase 142]: 142-03 `fq.call_macro` is callable from macro frames while `fq.call_model` remains delegated-hard-excluded.
- [Phase 142]: 142-04 kept host search assertions on the existing ToolSearchService and public search_tools handler rather than introducing a second host indexer.
- [Phase 142]: 142-04 added a narrow read-only McpBroker client debug snapshot instead of exposing BrokerClient instances or changing the public Broker interface.
- [Phase 136]: 136-01 Wave 0 tests intentionally remain RED until `src/macro/task-registry.ts` and dedicated cancellation behavior land.
- [Phase 136]: 136-01 existing T-U-125 `list_tasks` coverage was extended with a real `MacroTaskRegistry` provider contract.
- Kept template rendering inside src/llm/reference-resolver.ts and reused resolveAndBuildDocument for document params.
- Requested frontmatter during body reference resolution so only fq_template true documents enter template rendering.
- 114-03: Kept @alias resolution strictly keyed to template_params[alias]; alias names are never sent through vault lookup.
- 114-03: _items string entries reuse non-alias reference grammar for section and pointer resolution.
- [Phase 114]: Used existing reference resolver integration suite and HAS_SUPABASE lifecycle for real-vault template coverage.
- [Phase 114]: Alias integration tests parse real @alias placeholders before resolver hydration.
- [Phase 114]: Directed coverage row IDs L-73 through L-76 were occupied, so TMPL-03/TMPL-04/TMPL-05/VAL-114 were remapped to L-80 through L-83.
- [Phase 114]: Documentation review deferred to Phase 119 because README.md and docs/ARCHITECTURE.md do not yet describe call_model references/templates.
- [Phase 115]: 115-03: Dangling structurally valid template paths warn and persist for later discovery/dispatch filtering.
- [Phase 115]: 115-03: Purpose-template runtime rows use source='api' while existing LLM config tables keep source='webapp' for compatibility.
- [Phase 115]: 115-05: Runtime binding precedence remains validated in `tests/integration/llm-config-sync.test.ts` until a public runtime binding scenario tool exists.
- [Phase 115]: 115-05: User-facing docs remain deferred until later ATL phases expose the final tool registry, loop execution, and discovery/help surfaces.
- [Phase 116]: 116-01 kept providerTools explicitly undefined until Plan 02 adds schema translation.
- [Phase 116]: 116-01 treats native tool tiers as static policy rather than inferring from the MCP server surface.
- [Phase 116]: 116-02 captures native tool metadata by wrapping McpServer.registerTool before registration instead of reading SDK internals.
- [Phase 116]: 116-02 uses Zod 4 z.toJSONSchema plus OpenAI-specific normalization for strict tool definitions.
- [Phase 116]: 116-03 validates purpose native tool declarations from TOOL_TIERS and HARD_EXCLUDED_NATIVE_TOOLS.
- [Phase 116]: 116-03 preserves hard-excluded tool names at config load so registry diagnostics can warn/remove them.
- [Phase 116]: 116-04 kept automatic native tool exposure scoped to purpose resolver calls; direct model calls remain caller-parameter only.
- [Phase 116]: 116-04 exposes public metadata.tools diagnostics in snake_case while preserving internal registry diagnostics in camelCase.
- [Phase 117]: 117-01: Wave 0 tests intentionally remain RED until src/llm/agent-loop.ts and src/llm/tool-dispatcher.ts land.
- [Phase 117]: 117-01: Directed scenario framework paths were corrected to tests/scenarios/framework during execution.
- [Phase 117]: 117-02: Handler isError responses and thrown handler failures share the recoverable handler_error code.
- [Phase 117]: 117-02: Successful native dispatch payloads are serialized as { ok: true, result: rawHandlerResult }.
- [Phase 117]: 117-03 uses chatByPurposeUnrecorded for Mode 2 iterations so only the executor writes aggregate usage.
- [Phase 117]: 117-03 aggregate usage rows preserve first successful iteration identity while calls_log stores later fallback detail.
- [Phase 117]: 117-04: Mode 2 selection uses final provider-visible tool definitions, enabling future template-only registries.
- [Phase 117]: 117-04: call_model owns public Mode 2 envelope mapping while executeAgentLoop owns internal loop execution.
- [Phase 117]: 117-05 validates VAL-117 with deterministic mock providers and no real-provider correctness dependencies.
- [Phase 117]: 117-05 treats pre-call max-token stops as zero-completed-iteration behavior with no provider request or usage row.
- [Phase 118]: Public template validation now treats provider request capture as auxiliary; directed assertions use the public `call_model` envelope and calls-log metadata.
- [Phase 119]: Plan 01 intentionally leaves focused validation RED so Plan 02 can implement exact public discovery/help contracts.
- [Phase 119]: Help resolver tests require raw JSON outside CallModelEnvelope and assert stable top-level key order.
- [Phase 119]: The help resolver short-circuits before the LLM client guard so unconfigured clients can still retrieve protocol help.
- [Phase 119]: Search indexes names, descriptions, resolver/help keys, and structured diagnostic metadata without indexing document or template bodies.
- [Phase 119]: Public directed validation asserts discovery/help behavior through MCP response JSON only, not provider request capture or source inspection.
- [Phase 120]: VAL-120 and TEST-04 closed only after final lint, unit, integration, E2E, directed, YAML integration, and build gates were recorded in `120-VALIDATION.md`.
- [Phase 120]: ATL-INT-04 remains a TypeScript integration-layer exception in `llm-config-sync.test.ts` because no public runtime binding YAML tool exists.
- [Phase 120]: L-90 cooperative shutdown is closed by `test_call_model_agent_loop_shutdown`, which drives public `call_model` to `stop_reason: "shutdown"` through non-blocking SIGTERM.
- [Phase 120]: The YAML ATL-INT-02 freshness scenario asserts hydration via `return_messages: true` to avoid depending on live-model echo behavior.
- [Phase 121]: 121-02: Kept legacy key-value response helpers exported while adding JSON helper APIs for migrated tools.
- [Phase 121]: 121-02: Used get_document as the representative helper-backed path because it already had a JSON-oriented envelope.
- [Phase 121]: 121-02: Mapped get_document validation and missing-document responses to expected JSON errors with isError false.
- [Phase 123]: 123-01 kept get_document input and success response shape unchanged while canonicalizing expected errors only.
- [Phase 123]: 123-01 recorded get_document canonical error-shape evidence in existing directed and integration coverage ledgers.
- [Phase 123]: 123-02: Stored archive_document archived_at as TIMESTAMPTZ while preserving frontmatter fq_archived_at as exact ISO string.
- [Phase 123]: 123-02: Used managed YAML scenario runs when no external FlashQuery server was listening on localhost:3100.
- [Phase 123]: 123-03 kept copy_document and move_document single-target while migrating their output contracts.
- [Phase 123]: 123-03 represented plugin ownership notices as warnings:["plugin_ownership_path_expectation"] instead of appended prose.
- [Phase 123]: 123-04 kept list_vault path/show/recursive/extensions/date/limit behavior intact while replacing only the output contract.
- [Phase 123]: 123-04 returned expected list_vault path/date/include failures as canonical JSON with isError:false.
- [Phase 123]: 123-04 added E2E fixture row cleanup because stale Supabase rows can poison path-based list_vault tracking enrichment.
- [Phase 127]: 127-01 kept trash_folder.path unresolved in loadConfig so remove_document can resolve relative paths from the vault root at use time.
- [Phase 127]: 127-01 promoted remove_document and manage_directory into read-write delegated tier metadata while keeping maintain_vault system/admin and delegated-hard-excluded.
- [Phase 127]: 127-02 registered manage_directory alongside legacy directory tools; final legacy removal remains in later planned cleanup. — The plan only introduced the final mutation surface; later Phase 127/128 work owns final absence and removal checks.
- [Phase 127]: 127-02 directory mutations use per-path directory-scoped locks for both create and remove. — This satisfies the Phase 127 threat model and DAQ-9 concurrency contract.
- [Phase 127]: 127-03 maintain_vault status exposes only job-level fields — Sync counts omit embedding, hash, queue, availability, and per-document scanner internals.
- [Phase 127]: 127-03 maintain_vault background status uses process-local service state — This matches the v1 durability contract; unknown job IDs return canonical not_found.
- [Phase 127]: 127-04 remove_document archives lifecycle state before filesystem removal and keeps persistent state as archived, not removed. — Matches DOC-09 requirement: no removed status or removed_at/removed_to DB fields.
- [Phase 127]: 127-04 removal git policy uses git add -A through GitManager for hard deletes and trash moves. — Ensures delete and in-repo trash destination changes are staged consistently under existing autoCommit/autoPush policy.
- [Phase 127]: 127-04 unsafe relative trash_folder traversal is rejected before source lifecycle mutation. — Prevents bad trash configuration from archiving, moving, or deleting the source document.
- [Phase 127]: 127-05 hides local legacy directory/maintenance names from host exposure while broader legacy cleanup remains Phase 128.
- [Phase 127]: 127-06 classified remaining broad legacy source/test references as Phase 128 global cleanup instead of deleting them in Phase 127.
- [Phase 127]: 127-06 treated Phase 127 local absence as host exposure/protocol absence plus final-tool scenario coverage, not global source deletion.
- [Phase 129]: 129-03 used MT-* directed coverage IDs to avoid colliding with existing memory M-* rows.
- [Phase 129]: 129-03 kept the YAML workflow deterministic by asserting delegated tier metadata via call_model, then exercising insert_in_doc directly; delegated dispatch is covered by the directed mock-provider scenario.
- [Phase 130]: 130-02 used a held-lock proxy for T-I-011 instead of direct concurrent timing to deterministically prove archive_document and remove_document share the documents lock.
- [Phase 130]: 130-02 completed Task 2 as test coverage over already-green archive lock behavior after Task 1; no artificial failing test was introduced.
- [Phase 130]: 130-01: macroResult returns the existing JSON ToolResult envelope directly by delegating to jsonToolResult.
- [Phase 130]: 130-01: call_macro is final admin llm metadata and delegated-hard-excluded with RECURSIVE_MODEL_REASON.
- [Phase 130]: 130-01: Phase 130 call_macro registration is a non-executing unsupported scaffold; parser, source_ref, dry-run, progress, budgets, and execution remain deferred.
- [Phase 130]: 130-01: NullMcpBroker reuses NativeToolHandler for future dispatch compatibility while exposing no brokered connectivity in v0.
- [Phase 132]: Evaluator core returns canonical ToolResult envelopes directly from evaluateProgram, with later MCP handler phases calling the same surface.
- [Phase 132]: Escaped dollars in interpolated parser strings are preserved with an evaluator-only sentinel so \$name remains literal while normal $name interpolates.
- [Phase 135]: 135-01: Wave 0 tests intentionally remain RED until Phase 135 production modules and call_macro dispatch wiring land.
- [Phase 135]: 135-01: Integration dispatch coverage uses createMcpServer with InMemoryTransport and existing .env.test/Supabase helpers rather than a mock dispatcher.
- [Phase 135]: 135-02: Macro registry construction derives host permissions from resolveHostToolExposure and delegated permissions from assembleNativeToolRegistry.
- [Phase 135]: 135-02: ToolFn is the common MacroValue-returning dispatch unit for native and brokered macro tools.
- [Phase 135]: 135-03: Registry-backed expected errors halt macro execution through MacroExpectedError, while explicitly injected dispatchTool results retain existing branchable expected-envelope behavior.
- [Phase 135]: 135-03: ToolExistsCall remains introspection-only and is excluded from collected dispatch references.
- [Phase 135]: 135-04 macro dispatch integration follows current fqc_documents status and unified search total contracts.
- [Phase 135]: 135-04 inbound MCP call_macro always uses host caller context; delegated macro execution uses internal runMacroSource with purposeName.
- [Phase 136]: 136-02 runs tool-call cancellation checks after argument evaluation and before handler dispatch.
- [Phase 136]: 136-02 tracks cancellation requests separately from enumerable task records so terminal records can be removed immediately while in-flight evaluation can still observe cancellation.
- [Phase 136]: 136-02 lazily imports template metadata dependencies in src/mcp/tools/macro.ts so importing runMacroSource for registry tests does not load storage modules.
- [Phase 136]: 136-03: MacroCancellationError carries taskId and atSafePoint and maps to the canonical cancellation expected-error envelope.
- [Phase 136]: 136-03: The evaluator keeps between-statements probes and adds before-statement probes immediately before execution.
- [Phase 136]: 136-04 directed cancellation scenarios drive MacroTaskRegistry.cancel through a test-only in-process helper, without adding a public MCP cancellation surface.
- [Phase 136]: 136-04 uses MLC-01/MLC-02 for macro lifecycle directed cancellation coverage because M-01/M-02 already belong to memory lifecycle.
- [Phase 138]: 138-01 kept Zod's default stripping behavior for deferred call_macro task-spec fields and asserted stripped parsed output.
- [Phase 138]: 138-01 validates invalid source/source_ref combinations before macro parse/evaluation while leaving valid source_ref document resolution to Plan 02.
- [Phase 138]: 138-02 resolved source_ref through resolveDocumentIdentifier with lazy Supabase client acquisition to preserve inline handler independence.
- [Phase 138]: 138-02 skipped T-I-006 because the inherited local document resolver has no per-caller ACL path for permission_denied.
- [Phase 138]: 138-03 keeps macro write-lock behavior inherited from existing tool handlers; no macro-layer acquireLock calls were added.
- [Phase 138]: 138-03 real transport coverage uses a minimal no-LLM HTTP fixture so inline call_macro execution does not require Supabase template binding setup.
- [Phase 138]: Used positional scenario runner filters because --filter is not supported by the directed or YAML runners. — Scenario runner compatibility; positional filters preserve the intended macro verification scope.
- [Phase 138]: Executed migrated macro POC examples as runMacroSource fixtures with deterministic native and broker stubs. — Deterministic stubs keep fixture validation local, fast, and independent of external brokers.
- [Phase 139]: 139-01 kept broker config support scoped to parsing and validation; runtime host registration, BM25 indexing, and hot reload remain later plans.
- [Phase 139]: 139-01 TOFU hashes use upstream name, description, and inputSchema only; downstream description overrides are excluded from hash input.
- [Phase 139]: 139-02 ToolRegistry accepts structural config-shaped input and returns copy-on-read consumer-filtered views.
- [Phase 139]: 139-02 McpError normalization uses structural code detection in addition to instanceof for SDK/runtime compatibility.
- [Phase 139]: 139-02 Brokered macro CallToolResult coercion lives in src/macro/coerce.ts and checks isError before value binding.
- [Phase 139]: 139-03 BrokerClient returns raw CallToolResult for protocol responses while lifecycle failures reject with NormalizedToolError.
- [Phase 139]: 139-03 Unsupported reverse requests are audited with server ID, method, status, and trace context only; raw payloads are not logged.
- [Phase 139]: 139-03 Existing src/services/mcp-broker.ts remains compatible for Plan 139-04 while re-exporting the production broker factory.
- [Phase 139]: 139-04 McpBroker.listToolsForConsumer connects only consumer-visible servers before returning brokered tool definitions.
- [Phase 139]: 139-04 Brokered dispatch seams adapt raw CallToolResult at the consumer boundary: LLM wraps content, macro coerces success values.
- [Phase 139]: 139-04 Brokered tool_calls trace entries store only server, tool, count, and resolved cost.
- [Phase 139]: 139-05 Public call_macro broker dispatch uses the MCP session ID as trace ID so brokered tool_calls cost snapshots are observable.
- [Phase 139]: 139-05 Directed Phase A broker scenarios force a dedicated managed server to inject stdio fixture mcp_servers config.
- [Phase 139]: Use an in-process OpenAI-compatible mock endpoint for YAML call_model tests so broker dispatch scenarios do not depend on external network or API credentials.
- [Phase 139]: Expose only sanitized broker trace snapshots through call_model metadata, preserving observable cost assertions without leaking raw broker internals.
- [Phase 140]: 140-01 keeps TOFU process-local with trusted and pending schema snapshots separated until approval or rejection.
- [Phase 140]: 140-01 registry drift blocking removes brokered tools from the registry map so listToolsForConsumer remains the callable gate.
- [Phase 140]: 140-02 uses one manual ToolListChangedNotificationSchema handler per BrokerClient and routes refreshes through shared broker TOFU state.
- [Phase 140]: 140-02 keeps BM25/search_tools out of scope behind a synchronous ToolIndexSink seam.
- [Phase 140]: 140-03: Only typed SchemaDriftNeedsUserInputError broker signals are converted to macro needs_user_input; ordinary broker isError results still fail as tool_call_failed.
- [Phase 140]: 140-03: Macro needs_user_input is a non-runtime envelope with reason: needs_user_input and an opaque payload.
- [Phase 140]: 140-03: Non-interactive list refreshes audit blocked_on_user and suppress prompt payload callbacks.
- [Phase 140]: 140-04 kept Phase B TOFU/list_changed integration coverage in a dedicated tofu-list-changed suite, using live fixtures for notification routing and manual broker snapshots for deterministic state-machine assertions.
- [Phase 140]: 140-05 accepts TOFU approve/reject decisions through call_macro input_vars at frontmatter.user_decisions.<server>__<tool>.tofu_decision.
- [Phase 140]: 140-05 retains rejected TOFU hashes so the same rejected upstream schema stays blocked without repeated prompts.
- [Phase 140]: 140-06 used the managed YAML runner and server-quirky fixture for T-Y-012, with no runner changes or new packages.
- [Phase 140]: 140-06 recorded the directed cleanup helper timeout as non-blocking because Phase B directed validation passed 4/4 steps with zero residue.
- [Phase 142]: 142-05 YAML mcp.list_tools assertions serialize full tool objects so host brokered description_override can be validated through public tools/list.
- [Phase 142]: 142-05 MCB-13 uses public nested macro re-entry because delegated call_model intentionally hard-excludes call_macro; purpose-rooted inheritance remains covered by 142-03 unit coverage.
- [Phase 142]: 142-06: Phase 142 requirement closure is based on focused green gates plus explicit environment-warning notes, not inferred from implementation commits. — Final validation gates are the source of truth for checklist closure.
- [Phase 142]: 142-06: Phase 143 requirements remain unchecked; only the Phase 142 requirement set was closed. — REQ-071..073, REQ-103..104, and REQ-109..110 are deferred to Phase 143.
- [Phase 146]: 146-01 stores pending embedding retry state in fqc_pending_embeds keyed by instance_id,target_kind,target_table,target_id. — Durable retry state must survive process restarts and avoid cross-instance updates.
- [Phase 146]: 146-01 uses typed document, memory, and record embedding targets to avoid raw MCP payload fields in pending retry metadata. — The phase threat model requires target descriptors for tampering control.
- [Phase 147]: 147-01 kept Chevrotain 12 out of the non-major update lane so parser major risk remains isolated for Plan 147-03.
- [Phase 147]: 147-01 corrected npm update's in-range MCP SDK lockfile refresh back to 1.27.1 to preserve the later SDK decision lane.
- [Phase 147]: Knip preflight now gates files, dependencies, unlisted dependencies, binaries, and unresolved imports while export reporting remains staged with exact findings documented.
- [Phase 147]: Kept required worktree/build/vendor ignore globs in knip.ts even though Knip emits config hints for them; the plan requires those exact exclusions.
- [Phase 147]: 147-03 updated the nested private macro golden-model package to Chevrotain 12 instead of excluding it from REQ-006 audit closure. — Nested npm audit passed with 0 vulnerabilities and macro framework regression passed.
- [Phase 147]: 147-03 required no macro parser source or parser test assertion changes because Chevrotain 12 preserved existing parser and framework gates. — T-U-013, T-U-014, typecheck, and lint passed after the dependency update.
- [Phase 147]: 147-04 deferred MCP SDK update — Deferred @modelcontextprotocol/sdk 1.27.1 -> 1.29.0 to Phase 148 because REQ-008 typed registerTool wrapper consolidation has not landed.
- [Phase 147]: 147-04 closed Phase 147 as documented residual — npm outdated still reports intentional MCP SDK wanted drift while audits, Knip, type/lint, macro, and preflight gates are green.
- [Phase 147]: 147-04 classified uuid v14 as latest-major-only drift — uuid current and wanted are both 13.0.2, npm audit is clean, and REQ-006 does not require latest-major updates without wanted drift or advisories.
- [Phase 154]: 154-01 kept config loader's FlashQueryConfig export as a compatibility type re-export while cycle-sensitive modules import src/config/types.ts directly.
- [Phase 154]: 154-01 moved delegated native tool tiers and hard exclusions into src/llm/tool-policy.ts while preserving tool-registry re-exports.
- [Phase 154]: 154-05 moved embedding dimension policy into src/embedding/dimensions.ts with a type-only dependency on src/config/types.ts.
- [Phase 154]: 154-05 updated storage to import embedding dimensions from the leaf instead of src/embedding/provider.ts.

## Accumulated Context

### Milestone v3.1 Initialization (2026-05-01)

**Milestone:** Call Model With Reference — consolidated get_document, batch + follow_ref, reference syntax in call_model, discovery resolvers.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 107 | Consolidated get_document | GDOC-01 through GDOC-10 (10 requirements) |
| 108 | Batch + follow_ref | FREF-01 through FREF-05 (5 requirements) |
| 109 | Reference Syntax in call_model | REFS-01 through REFS-07 (7 requirements) |
| 110 | Discovery Resolvers | DISC-01 through DISC-06 (6 requirements) |

**Dependencies:** 107 → 108 → 109 → 110 (strict linear chain)

- Phase 108 depends on Phase 107: `follow_ref` uses the new `include`/`sections` parameter contract
- Phase 109 depends on Phase 108: reference syntax reuses the consolidated `get_document` resolution logic
- Phase 110 depends on Phase 109: discovery resolvers extend the existing `call_model` dispatcher

**Critical architectural constraints for this milestone:**

- `get_doc_outline` is removed in Phase 107 — must be a hard deletion, not a soft deprecation
- `size.chars` in the envelope reflects full document body length, not the returned subset — envelope and extracted_sections are separate
- Section `occurrence` parameter is only valid when `sections[]` has exactly one element — validate this at the handler level
- `#` (section extraction) and `->` (pointer dereference) are mutually exclusive in a single reference placeholder — detected at parse time, not resolution time
- Reference resolution failure in `call_model` is fail-fast: if any placeholder fails, no LLM call is made
- Discovery resolvers do not require `messages` or `name` — both must be optional at the Zod schema level for these resolvers
- `list_models` / `list_purposes` / `search` are new resolver values — add to the `resolver` enum in the existing `call_model` Zod schema

**Test suite baseline going into v3.1 (2026-04-30 post-v3.0):**

- Unit: 1,306 passing (+ 20 pre-existing deferred failures — do not fix during v3.1)
- Integration: 47 passing
- E2E: not re-run at v3.0 close

### Known Issues Carried Forward

- 20 pre-existing deferred unit test failures (tracked since v2.8; ignore during v3.1 phases)
- 1 deferred Phase 86 multi-table-reconciliation test (ownership reset fix applied but unverified)

### Roadmap Evolution

- Phase 111 added: CMR Verification Fixes — occurrence_out_of_range error code, local flag, test correctness, and coverage gaps (post-verification phase added 2026-05-02)
- Phase 129 added: Correct delegated tier eligibility derivation — closes MCP Tool Consolidation Requirements §3.11.1 delegated tier allow-list drift found 2026-05-13.
- Phase 144 added: Fix template warning flood and host help convention parity — consolidates two ready bug specs with required unit, integration, directed, and E2E coverage.

### Milestone v3.2 Initialization (2026-05-05)

**Milestone:** Agentic LLM Tools — extends `call_model` into a FlashQuery-managed agent loop with safe native tool exposure, document/template references, and masqueraded vault template tools.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|-------------|
| 112 | Chat Primitive & Envelope Migration | CHAT-01 through CHAT-06, VAL-112, TEST-01 through TEST-03 |
| 113 | Document Reference System Core | REF-01 through REF-08, VAL-113 |
| 114 | Template Parameterization | TMPL-01 through TMPL-05, VAL-114 |
| 115 | Purpose Config, Bindings & Capabilities | BIND-01 through BIND-05, CAP-01 through CAP-05, VAL-115 |
| 116 | Model-Visible Tool Registry | TOOL-01 through TOOL-04, VAL-116 |
| 117 | Agent Loop Executor | LOOP-01 through LOOP-07, TOOL-05, TOOL-06, VAL-117 |
| 118 | Template Discovery & Masquerade Dispatch | TMPL-06 through TMPL-08, VAL-118 |
| 119 | Discovery Diagnostics & Help Resolver | DISC-01 through DISC-04, VAL-119 |
| 120 | Cross-Phase ATL Validation & Coverage Closure | VAL-120, TEST-04 |

**Dependencies:** 112 → 113 → 114 → 115 → 116 → 117 → 118 → 119 → 120.

**Critical architectural constraints for this milestone:**

- More research is intentionally skipped; the supplied ATL, DRS, and test-plan docs are spec-complete and implementation-ready.
- Every implementation phase must ship runnable tests for the behavior it adds; public behavior gets scenario coverage in the same phase, and Phase 120 is cross-phase validation plus coverage closure, not a deferred test dump.
- `chat()` is the lower-level provider primitive; existing text wrappers stay compatible and reject accidental tool-call responses.
- Reference hydration scans host-authored input only and is non-recursive.
- `{{id:...}}` support is removed as part of ATL; `{{ref:...}}` is the single reference prefix.
- Mode 2 eligibility is config-time gated by structured model capabilities across the full fallback chain.
- `call_model`, admin tools, and plugin-management tools are hard-excluded from delegated tool exposure.
- Mode 2 writes one aggregate `fqc_llm_usage` row; detailed per-iteration loop data remains in `metadata.tools.calls_log`.
- Audit document writes, MCP Broker support, cooperative Mode 3, response references, and path-scoped delegated writes are deferred.

### Milestone v3.3 Initialization (2026-05-11)

**Milestone:** MCP Tools Consolidation — consolidate, update, and standardize all FlashQuery MCP tools with central metadata, host/delegated selector parity, canonical JSON envelopes, merged primitive tools, and same-phase unit/integration/E2E/scenario coverage.

**Phase structure:**

| Phase | Name | Requirements |
|-------|------|--------------|
| 121 | Foundation: Metadata, Response Helpers, Test Harness | FND-01 through FND-08, TEST-01 through TEST-06 |
| 122 | Host Tool Exposure Config | CFG-01 through CFG-06 |
| 123 | Document Read + Standard Output Migration | DOC-01, DOC-02, DOC-05 |
| 124 | Document Write Primitives | DOC-03, DOC-04, DOC-06 through DOC-08 |
| 125 | Unified Search + Memory Consolidation | SRCH-01 through SRCH-06, MEM-01 through MEM-04 |
| 126 | Plugin + Record Consolidation | REC-01 through REC-07 |
| 127 | Removal, Directory, And Vault Maintenance | DOC-09, SYS-01 through SYS-03 |
| 128 | Legacy Surface Removal + Final Audit | DOC-10, MEM-05, SYS-04 through SYS-06, TEST-07, TEST-08 |
| 129 | Correct Delegated Tier Eligibility Derivation | POST-01 (§3.11.1 delegated tier allow-list drift) |

**Dependencies:** 121 → 122 → 123 → 124 → 125 → 126 → 127 → 128 → 129.

**Critical architectural constraints for this milestone:**

- The source requirements and test plan are spec-complete; no additional external research is needed before phase planning.
- Every phase must create or update unit, integration, E2E, directed scenario, and integration scenario coverage for the behavior it changes.
- Phase 128 is a final absence/audit/preflight phase, not a deferred test implementation phase.
- Tool names, categories, multi-category membership, host eligibility, delegated eligibility, tiers, and hard exclusions must live in one central metadata registry.
- Phase 129 exists to correct the post-implementation §3.11.1 finding: delegated tier membership must be derived from metadata and data-category rules, not a hand-maintained allow-list.
- Host MCP surface selection and delegated model tool-belt selection must use the same selector grammar and metadata source.
- Removed and merged tools are hard cutovers: no compatibility aliases, only helpful validation suggestions.
- Synchronization internals stay hidden from normal MCP tools; `maintain_vault` is the dedicated admin exception.

## Session Continuity

Last session: 2026-05-26T00:14:34.573Z
Stopped at: Completed 154-05-PLAN.md
Resume: None

## Deferred Items

Items acknowledged and deferred at v3.1 milestone close on 2026-05-05:

| Category | Item | Status |
|----------|------|--------|
| debug_sessions | crm-plugin-multi-bug | verifying |
| debug_sessions | fqc-background-scan-blocks-archives | unknown |
| debug_sessions | knowledge-base | unknown |
| debug_sessions | linux-supabase-hang-2026-04-10 | unknown |
| debug_sessions | plugin-registration-yaml-validation | verified |
| debug_sessions | postgres-meta-ddl-failure | root_cause_found |
| debug_sessions | release-not-function-FINAL | unknown |
| debug_sessions | remaining-mcp-tool-tests | pending |
| debug_sessions | scanner-duplicate-race-analysis | unknown |
| debug_sessions | supabase-mock-self-ref | unknown |
| quick_tasks | 260324-mad-configure-internal-supabase-for-testing- | missing |
| quick_tasks | 260324-r95-add-ollama-integration-test-for-embeddin | missing |
| quick_tasks | 260330-gia-investigate-setup-sh-and-document-implem | missing |
| quick_tasks | 260330-x8l-add-test-case-code-samples-to-backlog-it | missing |
| quick_tasks | 260331-1os-setup-sh-bearer-token-generation-and-gui | missing |
| quick_tasks | 260331-lko-all-e2e-tests-should-remove-test-entries | missing |
| quick_tasks | 260331-o5x-fix-integration-test-configs-add-missing | missing |
| quick_tasks | 260408-h1j-rename-inner-flashquery-core-folder-to-s | missing |
| quick_tasks | 260408-hdk-flatten-flashquery-core-project-structur | missing |
| quick_tasks | 260409-r63-audit-docker-support-in-fqc-check-testin | missing |
| quick_tasks | 260409-sny-add-docker-compose-syntax-validation-to- | missing |
| quick_tasks | 260412-e2e-check-e2e-tests | missing |
| quick_tasks | 260414-ey9-understand-the-state-of-unit-integration | unknown |
| quick_tasks | 260415-cleanup-consolidate | missing |
| uat_gaps | phase 101 (101-HUMAN-UAT.md) | approved |
| uat_gaps | phase 102 (102-HUMAN-UAT.md) | passed |
| uat_gaps | phase 108 (108-HUMAN-UAT.md) | passed |
| uat_gaps | phase 110 (110-HUMAN-UAT.md) | passed |

Total deferred: 28 items. These predate the v3.1 milestone work and represent cross-milestone debt (debug-session backlog, dangling quick-task index entries, and audit label/status mismatches on completed UAT files). Not blocking v3.1; carried into the next milestone for incremental cleanup.

Items acknowledged and deferred at v3.4 milestone close on 2026-05-17:

| Category | Item | Status |
|----------|------|--------|
| uat_gaps | phase 130 (130-HUMAN-UAT.md; 0 open scenarios) | passed |

Total newly deferred at v3.4 close: 1 item. This is an audit label/status mismatch on a completed UAT file, not an open scenario or implementation blocker.

## Operator Next Steps

- Start the next milestone with /gsd-new-milestone
