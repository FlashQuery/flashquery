# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v3.8 — Codebase Audit Remaining Remediation

**Shipped:** 2026-05-26
**Phases:** 4 | **Plans:** 13

### What Was Built

- Explicit embedding provider API-key validation and public vault path resolution for plugin reconciliation.
- Dead seeder removal, safe backup cleanup diagnostics, package metadata cleanup, and audit static guards.
- Targeted TypeScript escape cleanup across document output, scanner selects, LLM usage query chains, grouping, and records timing instrumentation.
- Behavior-preserving decomposition of document MCP tools into cohesive modules while keeping the public registration entrypoint stable.
- Dependency-light config, LLM runtime, config-sync, reference metadata, embedding dimension, storage/logging, and MCP lifecycle leaves that removed the targeted residual import cycles.
- Final pinned `madge@8.0.0` zero-cycle guard plus focused unit, integration, build, lint, knip, and macro framework closure gates.

### What Worked

- The milestone stayed scoped to actionable audit findings instead of expanding into broad modernization.
- The milestone audit caught a real safe-logging contract drift in Phase 152, and the fix was small because the requirement was specific.
- Retroactive Nyquist validation closed the old artifact gap: all four phases now have validation and verification evidence.
- Targeted leaf-module extraction worked well for cycle cleanup because each slice preserved compatibility exports while moving cycle-sensitive imports to dependency-light modules.

### What Was Inefficient

- Phase 152 originally verified as `gaps_found` because tests pinned `error=...` failure log text even though the requirement called for safe timing metadata only.
- Phase 153 still has broad full-suite/provider/environment failures outside the document decomposition scope, so closeout needed careful wording to avoid confusing scoped success with ambient suite debt.
- Some phase summary frontmatter variants (`requirements_completed` vs `requirements-completed`) still made automated extraction uneven.

### Patterns Established

- Treat audit closure as a three-layer proof: requirements traceability, phase verification, and Nyquist validation.
- For log-safety requirements, tests should assert absence of raw failure detail, not just absence of obvious payload/query/vector fields.
- Keep compatibility re-exports in concrete modules while moving shared contracts into leaf modules to break import cycles without caller churn.
- Archive completed phase directories immediately after milestone close to keep `.planning/phases/` clean for the next milestone.

### Key Lessons

1. Safe logging contracts need negative assertions for arbitrary error text, because database/provider error messages can carry details outside the allowed metadata boundary.
2. `passed_with_external_blockers` is useful only when the blocker is explicitly outside scope and the scoped deterministic gates are named.
3. Nyquist reconstruction is a good closeout backstop, but it is cheaper when validation files are created during phase execution.

### Cost Observations

- Model mix: mostly sonnet-class execution, with specialist verifier/auditor agents for integration, verification, and Nyquist reconstruction.
- Notable: Phase 154 was compact but high-leverage; six small leaf-extraction plans eliminated the residual production import cycles without broad rewrites.

---

## Milestone: v3.7 — Technical Debt

**Shipped:** 2026-05-25
**Phases:** 6 | **Plans:** 18

### What Was Built

- Fail-closed `write_memory` plugin-scope lookup and explicit scanner embed-drain failure status.
- Durable background embedding helper, pending retry table, scanner retry reachability, doctor diagnostics, and public `embedding_deferred` warnings.
- Process-scoped pooled pg access for record embedding/search SQL with shutdown cleanup.
- Dependency/security drift cleanup, Chevrotain 12 handling, and `knip` wired into preflight.
- Typed MCP `registerTool` wrapping with lifecycle tracking and 15-second shutdown drain.
- Targeted document/plugin and macro cycle-breaks plus typed WeakMap-backed config runtime metadata.

### What Worked

- Phase-local verification stayed strong: all 6 phases produced passing VERIFICATION.md reports.
- Audit-before-close exposed the right distinction between blockers and acceptable tech debt.
- Targeted cycle assertions avoided turning a focused remediation milestone into a repository-wide zero-cycle rewrite.
- The embedding work connected schema, helper, scanner, doctor, MCP response warnings, and record SQL into one coherent reliability lane.

### What Was Inefficient

- Some validation frontmatter stayed stale even after implementation and verification passed.
- Plugin reconciliation integration coverage remains awkward: important legacy tests are not part of the normal integration include path, and one integration suite remains skipped.
- The GSD archive helper produced an awkward milestone title and left live roadmap polishing to manual cleanup.

### Patterns Established

- Treat codebase-audit remediation as a scoped milestone with explicit audit IDs, not generalized cleanup.
- Use public warning fields for recoverable background failures while keeping foreground writes successful.
- Keep raw madge as evidence when baseline cycles remain, and gate only the forbidden target fragments.
- Use typed side-channel storage, such as WeakMap metadata, instead of mutating public config object shape.

### Key Lessons

1. Stale validation metadata is cheap to prevent and annoying to explain at closeout.
2. Integration evidence needs to live on the normal command path, or it will look fragile even when lower-level behavior is covered.
3. Tech debt audits work best when they name what is deliberately out of scope; v3.7 stayed focused because the remaining `documents.ts` decomposition and global cycles were kept separate.

### Cost Observations

- Model mix: mostly sonnet-class execution/verification, with heavier reasoning used for milestone audit and closeout.
- Notable: Phase 146 had the broadest runtime surface, but the plan split kept schema/helper, MCP wiring, retry diagnostics, and pg pooling independently verifiable.

---

## Milestone: v1.9 — MCP Tool Overhaul

**Shipped:** 2026-04-06
**Phases:** 4 (+ 2 support) | **Plans:** 15 (+ 3 support)

### What Was Built
- Unified `resolveDocumentIdentifier` + `ensureProvisioned` replacing per-tool inline resolution across 8 tools
- Project deprecation — tag-based scoping replaces project params everywhere (tools, DB, stored procedures)
- `get_doc_outline` batch mode, `get_briefing` tag-scoped redesign, new `get_memory` + `search_all` tools
- `tag_match` (any/all) control propagated to all tag-filtering tools and both stored procedures
- "Linked documents" terminology replacing "wikilinks" throughout

### What Worked
- **Strict dependency chain (30→31→32→33)** kept changes clean — each phase built on a stable foundation
- **Worktree parallelism** for Phase 31 plans enabled concurrent execution (though it introduced merge risk)
- **Phase 32 gap closure pattern** (Plan 06 after initial verification) was efficient — verify first, then targeted gap closure
- **Helper extraction pattern** (searchDocumentsSemantic/searchMemoriesSemantic) in Phase 33 kept search_all DRY and testable

### What Was Inefficient
- **Phase 30 code lost in merge conflict** — parallel worktrees for Phase 31 Plans 01/02 didn't share changes, causing commit 154b5fe to overwrite Plan 01's work. Required Phase 35 to fix 5 regressions
- **Phase 33 verification skipped during execution** — verification was never run for Phase 33, discovered only during milestone audit. Required Phase 34 ad-hoc gap closure
- **REQUIREMENTS.md traceability table not maintained** — 27 Phase 32/33 requirements still showed "Pending" at audit time despite being satisfied. Documentation drift added audit friction
- **SUMMARY frontmatter inconsistency** — Phase 32/33 SUMMARYs lacked `requirements-completed` field that Phase 31 SUMMARYs had, breaking 3-source cross-reference

### Patterns Established
- **3-source cross-reference for requirements** (VERIFICATION.md + SUMMARY frontmatter + REQUIREMENTS.md traceability) — gaps in any source are detectable
- **Support phases** (35, 999.2) for fixing regressions/gaps without disrupting the main phase sequence
- **Backlog items (999.x)** for tracking tech debt discovered during audit

### Key Lessons
1. **Worktree merges need explicit rebase** — when running parallel plans in worktrees, the second plan must rebase on the first before merging to avoid silent overwrites
2. **Run verification after every phase, not just at audit** — skipping Phase 33 verification created unnecessary rework. The gsd-execute-phase workflow should always produce VERIFICATION.md
3. **Update traceability tables as part of plan completion** — deferring REQUIREMENTS.md updates causes documentation drift that slows milestone audit

### Cost Observations
- Model mix: ~70% sonnet (execution, verification), ~30% opus (planning, audit, discussion)
- Notable: Phase 32 was the largest (6 plans) due to rebuilding Phase 30 code + new tools; Phase 33 was cleanest execution (3 plans, zero deviations)

---

## Milestone: v2.8 — Plugin Callback Overhaul

**Shipped:** 2026-04-21
**Phases:** 6 (84–89) | **Plans:** 26

### What Was Built
- Reconcile-on-read architecture replacing fragile push-based plugin callbacks (fqc_change_queue + invokeChangeNotifications fully removed)
- `DocumentTypePolicy` interface + global type registry built from all loaded plugins; refreshed on register/unregister
- `reconcilePluginDocuments()` — 7-branch classification engine (added, resurrected, deleted, disassociated, moved, modified, unchanged) with 30s staleness cache and self-healing ALTER TABLE
- `fqc_pending_plugin_review` table + `clear_pending_reviews` MCP tool for skill-driven document review workflows
- Scanner ownership sync (`fqc_owner` → `ownership_plugin_id`, `fqc_type` → `ownership_type`) on every INSERT/UPDATE
- 6 legacy source files + 12 obsolete test files deleted; fqc_change_queue dropped at startup via DDL

### What Worked
- **Strict dependency chain (84→85→86→87→88→89)** — each phase built on verified prior work; zero cross-phase regressions during execution
- **Gap closure plan pattern** (85-04, 85-05, 86-04, 86-05) — verify first, then targeted additions rather than expanding original scope
- **OQ-7 resurrection guard** — fetching ALL plugin table rows (active + archived) before classifying documents eliminated a specific misclassification bug that would have been invisible at unit test level
- **atomicWriteFrontmatter extraction** — pulling the function into `src/utils/frontmatter.ts` before deleting discovery-orchestrator.ts made Phase 88 clean; the extraction pattern avoids leaving dangling imports
- **Integration test suite depth** — 333 integration tests caught real behavior at the DB/filesystem boundary; unit tests alone would have missed field-map NULL behavior and resurrection lifecycle correctness

### What Was Inefficient
- **VALIDATION.md scaffold-only for Phases 86, 88, 89** — VALIDATION.md files were created as placeholders but never filled in. Phase 89 VERIFICATION.md compensated, but three phases lack Nyquist maps. Added retroactive `/gsd-validate-phase` as recommendation but not acted on.
- **REQUIREMENTS.md traceability showing "Pending" at audit** — all 47 requirements were satisfied in code, but the traceability table was never updated during phase execution. Required a full rewrite at audit time. Same pattern as v1.9.
- **Dead `coalesceNow` variable** — assigned and immediately overridden in plugin-reconciliation.ts (~line 361). Survives into post-v2.8 as a tech debt item.
- **50 open artifact items at close** — 30 debug sessions and 14 quick tasks accumulated during v2.8 execution; acknowledged and deferred rather than resolved. Suggests more aggressive mid-milestone cleanup.

### Patterns Established
- **Reconcile-on-read as primary plugin notification model** — eliminates async delivery fragility; all record tools run a staleness-checked reconciliation pass before their core operation
- **Pending review table as plugin-to-skill communication channel** — plugins surface documents needing attention without direct skill invocation; skills poll via `clear_pending_reviews`
- **Two-path document discovery** (folder-based Path 1 + frontmatter-type-based Path 2) — captures documents that migrated out of watched folders
- **Self-healing DDL** — `ensureLastSeenColumn()` adds missing columns on first reconciliation pass; cached per table name for process lifetime

### Key Lessons
1. **Update REQUIREMENTS.md traceability as part of each phase close** — deferring this caused the same audit-time rewrite that v1.9 required. The traceability table is a first-class deliverable, not a cleanup task.
2. **Fill VALIDATION.md per-task maps at phase end, not as scaffolds** — Phases 86/88/89 shipped with empty maps. If Nyquist validation is worth doing, it's worth doing at phase close, not retroactively.
3. **Archive mid-milestone artifacts before close** — 50 accumulated items at milestone close suggests the artifact cleanup should happen at each phase boundary, not just at milestone close.

### Cost Observations
- Model mix: ~80% sonnet (execution, verification, gap closure), ~20% opus (planning, audit)
- Largest phase: Phase 86 (5 plans — DDL + pending review + 5 record tools + 3 integration test suites)
- Cleanest execution: Phase 87 (3 plans, all on a well-defined scope, zero deviations)

---

## Milestone: v2.9 — Filesystem Primitive Tools

**Shipped:** 2026-04-25
**Phases:** 8 (90–97, Phase 90 as pre-milestone) | **Plans:** 20 (7 pre + 13 core)

### What Was Built
- `create_directory` MCP tool — batch support (≤50 paths), mkdir -p semantics, segment sanitization (illegal chars → spaces), partial-success on batch, idempotency, vault-root guard, no write lock (OS-atomic)
- `list_vault` MCP tool — full `list_files` replacement with DB-enriched metadata, table/detailed formats, show modes, date/extension filtering, real file sizes, dotfile filtering, sort (dirs-first then by date)
- `files.ts` module — canonical home for all filesystem primitives; shared `path-validation.ts` with 5 exported utilities (validateVaultPath, normalizePath, joinWithRoot, sanitizeDirectorySegment, validateSegment)
- 16 IF-NN integration tests covering cross-tool filesystem composition (create→list→remove lifecycle, plugin scaffold, format modes)
- fq-base and fq-skill-creator plugin documentation fully updated (5 plugin requirements, 3 files rewritten)
- Phase 90: FM constants object + fqc_* → fq_* rename across 26 files; user-defined fields now precede FQ-managed fields

### What Worked
- **Pre-milestone phase pattern** — Phase 90 (frontmatter centralization) executed between v2.8 and v2.9 as a clean prerequisite without disrupting v2.9 scope. Made the main milestone phases simpler.
- **Strict dependency chain (91→92→93→94→95→96, 97 parallel to 95/96)** — each phase built on verified prior work; zero cross-phase regressions. Plans 97-01/02/03 ran in parallel without conflict.
- **TDD for list_vault (Phase 93)** — RED phase (19 failing unit tests) before GREEN implementation kept the handler correct on first pass; no gap-closure plans needed for list_vault behavior
- **Two-step migration commit for remove_directory** — verbatim copy first (step 1), then validateVaultPath() upgrade (step 2) made the migration auditable with no behavioral ambiguity at each step
- **Managed directed tests with .env.test** — all 60 directed scenario steps passed live against Supabase on first run; no test infrastructure issues

### What Was Inefficient
- **Phase 93/94 VERIFICATION.md left as `human_needed`** — the managed directed tests were not run during execution; they accumulated as open audit items at milestone close, requiring an extra resolution step. Should be run as part of phase close, not deferred.
- **92-01-PLAN.md plans count wrong in ROADMAP** — Phase 92 was initially listed as "TBD" plans; the 1-plan reality wasn't updated until after execution. Minor but created confusion during readiness check.
- **8 pre-existing TypeScript tsc errors carried forward** — these were pre-Phase 93 Dirent-type errors in files.ts that were never resolved; they're documented but accumulate as ambient noise in the codebase

### Patterns Established
- **`files.ts` as filesystem primitive module** — clear boundary for vault filesystem ops; any future binary read support, temp file management, etc. has an obvious home
- **path-validation.ts shared utility** — `validateVaultPath()` now used by all three tools; future tools can import without duplicating traversal logic
- **Live managed-mode test verification at phase close** — all directed scenario tests should be run in managed mode (`--managed`) before a phase is marked complete, not deferred to milestone close

### Key Lessons
1. **Run managed-mode directed tests during phase close, not at milestone close** — Phases 93 and 94 both left VERIFICATION.md as `human_needed` because the managed tests weren't run. Running them is a 2-minute step that should be part of the executor's phase-complete checklist.
2. **Pre-milestone phases are a clean pattern** — Phase 90 worked well as a standalone between milestones. Blocking prerequisite refactors can be isolated this way without stretching milestone scope.
3. **Parallel plugin doc plans (97-01/02/03) scale well** — three independent doc files updated in parallel without conflict. Good pattern for documentation-only phases with non-overlapping file scope.

### Cost Observations
- Model mix: ~85% sonnet (execution, verification, test runs), ~15% opus (planning discussions)
- Cleanest execution: Phase 92 (1 plan, zero deviations, all 34 directed test scenarios passing on first run)
- Most complex: Phase 93 (2 plans, TDD RED→GREEN, 7 directed test files, DB enrichment pipeline)

---

## Milestone: v3.1 — Call Model With Reference

**Shipped:** 2026-05-05
**Phases:** 17 (98-111 + 999.5/999.6/999.9 sidecars) | **Plans:** 52
**Stats:** 262 commits, 209 files (25 src/, 166 tests/), +28,161 / -3,171 LOC, 1,439 unit tests passing

### What Was Built
- Three-layer LLM config (`providers` × `models` × `purposes`) with case normalization and Supabase config sync (Phase 98)
- Completions client + purpose resolver with fallback chains and typed error classification (Phases 99-100)
- `call_model` MCP tool with diagnostic envelope, `trace_id` aggregation, fire-and-forget cost tracking with SIGTERM drain (Phases 101-102)
- `get_llm_usage` MCP tool with four aggregation modes (Phase 103)
- Consolidated `get_document` with structured envelope, `include` parameter, case-insensitive section matching, `get_doc_outline` removed (Phase 107, GDOC-01..10)
- Batch + `follow_ref` with per-element partial-failure semantics (Phase 108, FREF-01..05)
- Reference syntax in `call_model`: `{{ref:...}}`/`{{id:...}}` placeholders inline-resolved before LLM dispatch (Phase 109, REFS-01..07)
- Discovery resolvers `list_models`/`list_purposes`/`search` with auto-derived `local: true` for Ollama-backed models (Phase 110, DISC-01..06)
- CMR verification fix-ups: `occurrence_out_of_range` error code, value-bound assertion hardening (Phase 111)

### What Worked
- **Wave 0 RED-state TDD scaffolds** before implementation locked the contract — every plan started with failing tests that codified the spec, then turned green as code landed
- **TC4-W5 value-bound assertion hardening** in Phase 111 caught spec drift that bare-key substring checks would have missed (e.g., `"input_cost_per_million":0.15` instead of `"input_cost_per_million"`)
- **`extra_config` deep-merge in the integration runner** turned out to be the right primitive for self-contained tests — `llm_discovery_list` was rewritten this milestone to declare its own fixture llm config rather than depend on `flashquery.yml`
- **Verification doc cross-references** (each requirement → satisfying tests + code locations) made post-hoc requirements ticking trivial — REFS-01..07 close-out used the existing `Phase 109 VERIFICATION.md:95-101` row as authoritative evidence

### What Was Inefficient
- **REQUIREMENTS.md traceability not auto-updated when phases ship** — REFS-01..07 were marked `Pending` even after Phase 109's VERIFICATION.md flagged them all `SATISFIED`. Discovered only during milestone close-out (manual checkbox flip required, with prior verification)
- **Cross-milestone debug-session debt accumulating silently** — 21 `awaiting_human_verify`/`investigating` debug sessions had been sitting since March 2026 (across v2.x), surfaced only by the v3.1 audit-open gate. Triaged in batch as part of close-out
- **v3.0 was never formally archived** before v3.1 work began, so the GSD CLI rolled phases 98-106 into the v3.1 milestone close. Cosmetic, but means MILESTONES.md v3.1 entry covers more scope than the live ROADMAP.md's milestone heading suggested
- **Phase 109 re-architected get_document via `resolveAndBuildDocument`/`ensureProvisioned`** which hid the original Phase 107 sync logic from greps for "Case 1:/Case 2:" comments — verification needed to walk the call chain rather than the comment trail

### Patterns Established
- **`extra_config:` for self-contained integration test fixtures** — declare YAML test-level llm/embedding config; the runner deep-merges into a fresh tempfile and starts a fresh server. No more dependence on the dev `flashquery.yml`
- **Audit-open gate before milestone close** — `gsd-sdk audit-open` surfaces debug sessions, quick-tasks, UAT gaps as deferred-or-resolve buckets. Quietly broken until run; loud once you do
- **Batch closure for stale debug sessions** — for sessions that predate the milestone and haven't been touched in weeks, a single dated closure note + `status: resolved` is sufficient; full per-session triage isn't always warranted
- **Verification correction notes** (Verification doc Section "Correction N" pattern) — when implementation drifts from spec, capture the chosen option (Option A auto-derive vs. Option B opt-in) inline so future readers see both the contract and its provenance

### Key Lessons
- **Tick checkboxes when the phase ships, not at milestone close.** The REFS-01..07 case wasted ~30 minutes of verification work that would have been a one-line `[x]` flip at Phase 109 close
- **Source-of-truth chain matters.** When the main spec example doesn't show a contract field but the dev plan + verification correction do, cite the actual provenance in the test label so future debugging doesn't go looking in §8.3 for something that lives in §6.4.1
- **Test fixture coupling to live config is fragile.** Tests that hardcode values matching the dev `flashquery.yml` break the moment that config evolves. Use `extra_config:` (or equivalent) to make tests self-contained
- **Open-artifact debt compounds across milestones.** The 49 open items at v3.1 close were almost entirely accumulated debt from prior milestones. A regular triage cadence (per-milestone, not per-close) would prevent this

### Cost Observations
- Model mix: ~80% sonnet (execution, verification, test runs), ~20% opus (planning, milestone-close synthesis)
- Notable: Phase 111 was 9 plans of pure test correction work — much of which was the cost of value-bound assertion hardening (TC1..TC4 waves) that Phase 110 should have shipped with from the start
- Cleanest: Phase 92 (`create_directory` handler, 1 plan, no deviations)

---

## Milestone: v3.3 — MCP Tools Consolidation

**Shipped:** 2026-05-14
**Phases:** 9 (121-129) | **Plans:** 46
**Stats:** 57/57 requirements satisfied, integration 9/9, flows 8/8

### What Was Built
- Central MCP tool metadata registry and shared JSON response helpers for consistent final tool contracts
- Host MCP tool exposure config using the same selector grammar as delegated purpose tools
- Structured document read/write/list/archive/copy/move outputs with canonical expected-error envelopes
- Final document, memory, search, plugin, record, directory, and vault maintenance primitives
- Legacy document, memory, project, directory, maintenance, and record surfaces removed from host/delegated exposure without aliases
- Delegated broad tier eligibility derived from canonical metadata, including corrected data tools such as `list_vault`, `copy_document`, `insert_in_doc`, and `replace_doc_section`

### What Worked
- **Phase-local five-layer coverage rule** kept implementation and validation together: unit, integration, E2E, directed scenarios, and YAML scenarios moved with each behavior change.
- **Metadata as the source of truth** simplified host exposure, delegated registry assembly, removed-tool suggestions, and final-surface absence checks.
- **Final audit + Phase 129 correction loop** caught a real delegated tier eligibility drift and closed it as a narrow post-implementation phase.
- **Nyquist validation cleanup before close** removed stale validation metadata instead of carrying another partial-coverage note into the archive.

### What Was Inefficient
- **Summary frontmatter inconsistency persists** in some phases; verification evidence was strong enough, but summary extraction still produced nulls for several plan summaries.
- **Open artifact debt still surfaced at close** even though it was mostly stale parser visibility rather than active work. Quick-task summaries need a stable literal `SUMMARY.md` convention.
- **Integration test discoverability issue** remains for `tests/integration/tool-registry.test.ts`, which Phase 129 could run directly but the normal targeted integration command does not pick up cleanly.

### Patterns Established
- **Final-surface hard cutover**: removed names stay as metadata replacement suggestions, not runtime aliases.
- **Structured MCP response vocabulary**: expected errors are recoverable JSON with `isError:false`; unexpected runtime failures remain true errors.
- **Delegated tier derivation from metadata**: avoid hand-maintained allow-lists for broad read/write tool belts.
- **Artifact parser hygiene**: old quick/debug artifacts need terminal statuses and parser-visible summaries before milestone close.

### Key Lessons
1. **Keep planning artifact schemas boring and literal.** If audit tooling looks for `SUMMARY.md`, every quick task should have one even when a richer `{id}-SUMMARY.md` exists.
2. **Use metadata to avoid drift.** The POST-01 bug existed because broad delegated tiers had a second source of truth.
3. **Audit final surfaces from both directions.** It is not enough to prove new tools exist; the removed tools must be absent from host registration, delegated assembly, docs, scenarios, and user-facing examples.

### Cost Observations
- Model mix: mostly sonnet-class execution/verification with heavier reasoning for milestone audit and closeout.
- Notable: Phase 128 final cleanup plus Phase 129 correction turned a broad consolidation into a trustworthy final surface.

---

## Milestone: v3.4 — Macro Support

**Shipped:** 2026-05-17
**Phases:** 9 | **Plans:** 36

### What Was Built
- Public `call_macro` MCP tool for inline source and vault-backed `source_ref` execution.
- FlashQuery Macro Language v0 parser/evaluator with scoped variables, control flow, structured termination, input variables, and standard builtins.
- Native/broker macro tool registry with permission pre-scan, host/delegated allowlists, hard exclusions, and dispatch-time backstops.
- Vault-jailed read-only shell verbs, namespace `_exists()` introspection, task lifecycle, cooperative cancellation, trace/progress, dry-run, warnings, and budgets.
- Scenario closure across unit, integration, E2E, directed, YAML, and migrated POC fixture evidence.

### What Worked
- The phased language-runtime build-up was effective: response contracts, parser, evaluator, builtins, shell, dispatch, lifecycle, observability, then handler/source closure.
- Nyquist validation forced each behavior into an explicit test/evidence lane before the milestone audit.
- Running macro POC examples as fixtures kept the implementation grounded in real authoring workflows.

### What Was Inefficient
- Some verification/audit ledger drift remained even after requirements and runtime behavior were complete.
- The generated milestone accomplishment extraction was too granular and needed manual condensation for the living milestone ledger.
- One ACL-related source_ref test remains skipped because the local resolver has no ACL surface.

### Patterns Established
- Macro execution should use preflight layers before side effects: parse, input contract collection, forbidden flag scan, permission pre-scan, then evaluation.
- Host/delegated caller identity must be derived internally, not accepted from public tool input.
- Macro source libraries should stay ordinary vault documents with named `fqm` fences rather than introducing a separate storage plane.

### Key Lessons
1. Keep audit ledgers and UAT labels synchronized with pass status; false-positive close gates create avoidable ceremony.
2. For language/runtime milestones, fixture execution is as important as unit-level grammar coverage.
3. Continue condensing generated summaries before they enter living documents; raw plan-level one-liners belong in archives, not the active milestone index.

### Cost Observations
- Model mix: not measured.
- Sessions: multiple phase execution and closure sessions.
- Notable: The milestone benefited from strict phase sequencing; parallelism was most useful for independent test/coverage closure, not core runtime layers.

---

## Milestone: v3.5 — MCP Broker

**Shipped:** 2026-05-19
**Phases:** 5 | **Plans:** 34
**Stats:** 118/118 requirements satisfied; audit passed; 9/9 integration paths and 6/6 flows complete

### What Was Built
- Stdio MCP broker foundation with lazy server spawn, lifecycle handling, stderr capture, connection probes, restart behavior, and shutdown grace.
- Broker registry keyed by server/tool identity, with consumer-filtered views for delegated model calls, macro execution, and host MCP tools.
- In-memory TOFU schema pinning, schema drift blocking, approval/rejection paths, `tools/list_changed` routing, and audit events.
- Pure TypeScript BM25 tool search, `fq.search_tools`, native `.tool.md` help pages, and description override propagation.
- Host brokered tool registration, shared `ConsumerContext`, trace inheritance, host search, diagnostic CLI paste-back YAML, macro `_self`, loop control, deep `_exists()`, and concurrency coverage.

### What Worked
- **Phased broker layering held up**: foundation, TOFU/list_changed, search/help, host surface, then diagnostics/macro closure gave each risk band its own verification pass.
- **ConsumerContext became the right abstraction** for keeping host, delegated, and nested macro visibility aligned without duplicating filtering logic.
- **Scenario evidence caught contract drift** around host registration, tool search, schema drift, and trace metadata before the milestone closed.
- **The final audit clarified REQ-069** by treating trace-stream `fq.search_tools` audit evidence as sufficient, avoiding unnecessary logger/onAudit churn.

### What Was Inefficient
- Several validation records carried hosted Supabase cleanup timeout notes; they were environment debt with zero residue, but they added audit noise.
- The broker requirements stayed live after v3.5 shipped, which later confused v3.6 closeout until this archive pass moved them into `milestones/`.
- Generated milestone close metadata needed manual enrichment to become useful in the long-term milestone ledger.

### Patterns Established
- Brokered tool safety should be enforced at discovery, indexing, dispatch, and trace boundaries, not only at call time.
- Host and delegated consumers can share broker processes and TOFU pins when visibility is filtered by explicit consumer context.
- Tool help/search metadata is a product contract: startup validation and scenario coverage are worth the up-front cost.

### Key Lessons
1. Archive requirements immediately at milestone close; stale live requirements are easy to misattribute during the next milestone.
2. For broker features, cross-consumer scenarios matter more than isolated unit checks because host, delegated, macro, and diagnostic paths share state.
3. Keep environment debt separate from product debt in validation records so audits can distinguish cleanup noise from broken flows.

### Cost Observations
- Model mix: mostly execution/verification sessions with heavier audit synthesis at close.
- Notable: The milestone was broad but stayed tractable because each phase matched a source-spec test-plan band.

---

## Milestone: v3.6 — Bug Fixes & Host Parity

**Shipped:** 2026-05-24
**Phases:** 1 | **Plans:** 6
**Stats:** 18/18 scoped requirements satisfied; UAT 8/8; validation complete

### What Was Built
- Bounded, index-backed template discovery that removes non-template warning floods from large plugin trees.
- `template_meta` JSONB cache in `fqc_manifest_cache`, backfilled from manifest loaders and reconciled through plugin sync.
- Shared native help dispatch path for host tools and delegated `call_tool` execution.
- Native help parity for built-in tools, plugin tools, macro execution, and hidden-native delegation.
- Focused regression coverage across unit, integration, E2E, directed scenario, and automated UAT gates.

### What Worked
- **Small milestone scope stayed honest**: one bug-fix phase with six plans was enough to cover data model, loader behavior, runtime dispatch, and help parity without pulling in broader product work.
- **Source-spec-driven verification was effective**: requirements were reconstructed from the phase source specs and checked against concrete implementation/test evidence.
- **Automated UAT with `.env.test` closed the loop**: the user request to use the test environment turned UAT from a paper review into executable checks.
- **Integration checker found real wiring risk**: the final audit caught stale or missing traceability, then Phase 144 validation aligned the evidence before close.

### What Was Inefficient
- **Live `REQUIREMENTS.md` was stale from v3.5** when closeout began, causing the SDK milestone archive to copy the wrong milestone requirements before manual correction.
- **Generated milestone metadata needed enrichment**: `milestone.complete` handled mechanical archive moves but did not capture useful accomplishments for the living milestone index.
- **One directed run was noisy under concurrent test/build activity** and needed isolated rerun to produce clean evidence.

### Patterns Established
- Build milestone archives from source specs plus verification evidence when the live requirements file is stale.
- For CLI/MCP bug-fix milestones, automated UAT can be a first-class close gate when `.env.test` is configured.
- Host and delegated native dispatch should share the same core implementation, with caller identity derived internally.
- Hidden native delegation should fail like an unknown tool rather than leaking privileged tool metadata.

### Key Lessons
1. Check the milestone identity of `REQUIREMENTS.md` before running milestone close automation.
2. Index-backed discovery needs both correctness tests and performance/scale regression checks; the warning-flood bug was partly a scaling failure.
3. Help parity is a contract surface, not documentation garnish: host and delegated outputs must be verified side by side.

### Cost Observations
- Model mix: mostly balanced/sonnet-class execution and verification, with heavier synthesis during audit and closeout.
- Notable: The milestone stayed cheaper because fixes were sliced around existing architectural boundaries instead of creating a new subsystem.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Phases | Plans | Key Change |
|-----------|--------|-------|------------|
| v1.0 | 9 | 12 | Initial GSD workflow established |
| v1.5 | 7 | 20 | Plugin system + compound tools |
| v1.6 | 5 | 15 | Open source prep (CLI, Docker, CI) |
| v1.7 | 4 | — | Issues resolution, write locking |
| v1.8 | 2 | 2 | Targeted bug fixes |
| v1.9 | 4 (+2) | 15 (+3) | Tool overhaul, worktree parallelism introduced, 3-source verification |
| v2.8 | 6 | 26 | Reconcile-on-read replaces push-based callbacks; 6 legacy files + fqc_change_queue removed |
| v2.9 | 8 (incl. Phase 90) | 20 | Filesystem primitives (create_directory, list_vault); files.ts module; path-validation.ts shared utility |
| v3.3 | 9 | 46 | MCP tool surface consolidated around metadata-backed JSON contracts and final primitives |
| v3.5 | 5 | 34 | Stdio MCP broker, TOFU schema pinning, tool search/help, and host broker surface |
| v3.6 | 1 | 6 | Bug-fix milestone for bounded template discovery and native help parity |

### Cumulative Quality

| Milestone | Tests | Key Addition |
|-----------|-------|-------------|
| v1.0 | 16 E2E | Protocol test suite |
| v1.5 | 276 | Plugin + compound tool coverage |
| v1.8 | 455+ | Security + integration tests |
| v1.9 | 524 | resolve-document, get-memory, search-all, tag-match tests |
| v2.8 | 1464 (unit 1111, integration 333, E2E 40) | Reconciliation engine, pending review lifecycle, frontmatter-sync, bulk-reconciliation |
| v2.9 | 1246 (unit 1199, integration 47) | Filesystem composition IF suite, 79 new directed scenario rows (F-19..F-97), path-validation unit tests |
| v3.3 | 57 requirements verified | Five-layer coverage required per implementation phase; final integration 9/9 and flows 8/8 |
| v3.5 | 118 requirements verified | Broker integration audit passed 9/9 paths and 6/6 E2E flows |
| v3.6 | 18 requirements verified; UAT 8/8 | Template discovery scale guardrails and host/delegated native help parity |

### Top Lessons (Verified Across Milestones)

1. **Verify every phase before moving on** — Phase 31 regressions (v1.9) and traceability gaps (v1.6) both stemmed from skipping verification
2. **Test coverage prevents regressions** — 524 tests caught issues during Phase 32 rebuild that would have been invisible otherwise
3. **Strict dependency ordering works** — v1.9's 30→31→32→33 chain was clean; v1.5's parallel phases caused more friction
