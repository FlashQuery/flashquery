# Integration Test Coverage Matrix

Integration tests exercise multi-step workflows and cross-domain behaviors.
They complement the directed scenario tests (which verify individual tool behaviors)
by verifying that FlashQuery's features compose correctly end-to-end.

Coverage IDs use the prefix `INT-` to avoid collision with the directed test IDs in `../DIRECTED_COVERAGE.md`.

---

## Phase 128 Legacy Surface Final Audit

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| legacy_surface_final_audit | Phase 128 removed/dead MCP tool names are absent from public listTools and YAML scenario migration keeps only final replacements plus transitional get_briefing/insert_doc_link coverage. | legacy_surface_final_audit   | 2026-05-20   | 2026-05-20   |
| legacy_surface_migration_decisions | Phase 128 integration migration decisions classify old document/memory/directory/record/search/project rows as historical removed-tool evidence before YAML cleanup. | legacy_surface_final_audit; historical integration ledgers | 2026-05-13 |  |
| INT-briefing-degrade-1 | Transitional get_briefing with memory disabled and mixed documents/memories request returns documents plus memory_category_disabled warning. | briefing_category_degradation | 2026-05-19   | 2026-05-19   |
| INT-briefing-degrade-2 | Transitional get_briefing with memory disabled and memories-only request returns canonical unsupported envelope with isError:false. | briefing_category_degradation | 2026-05-19   | 2026-05-19   |

## INT — Foundation Harness

Phase 121 foundation workflows for MCP tool consolidation metadata, response helpers, frontmatter constants, and YAML assertion scaffolding.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-foundation-json-1 | YAML integration runner parses MCP `content[0].text` JSON and asserts dotted/array JSON paths against helper-backed tool responses. | foundation_json_response     | 2026-05-20   | 2026-05-20   |
| INT-foundation-json-2 | Expected JSON error envelopes are asserted through normal success flow without requiring `expect_error`. | foundation_json_response     | 2026-05-20   | 2026-05-20   |
| INT-foundation-tools-1 | Foundation metadata/response helper coverage is represented in runnable integration workflow traceability. | foundation_json_response     | 2026-05-20   | 2026-05-20   |
| INT-foundation-tools-2 | YAML `host_mcp_tools` config filters the public MCP tools/list surface. | foundation_host_tool_exposure | 2026-05-19   | 2026-05-19   |
| INT-foundation-tools-3 | Host-filtered listTools establishes the public catalog boundary consumed by delegated native assembly; delegated intersection itself is pinned by unit coverage in `llm-tool-registry.test.ts`. | foundation_host_tool_exposure | 2026-05-19   | 2026-05-19   |
| INT-foundation-tools-4 | Suspicious host category combinations remain warning-only startup diagnostics. | foundation_host_tool_exposure | 2026-05-19   | 2026-05-19   |
| INT-foundation-tools-5 | Removed-status purpose tool names remain valid while their legacy tools are still registered; hard-fail suggestions are deferred until actual removal. | foundation_host_tool_exposure | 2026-05-19   | 2026-05-19   |
| INT-foundation-frontmatter-1 | Foundation frontmatter constant guardrails are represented in integration coverage traceability for later migration phases. | foundation_json_response     | 2026-05-20   | 2026-05-20   |
| INT-gdoc-error-1 | get_document JSON error-shape coverage proves missing identifiers use canonical `not_found` envelopes without runtime `isError:true`. | documents.integration.test.ts get_document canonical expected errors | 2026-05-12 |  |
| INT-gdoc-error-2 | get_document JSON error-shape coverage proves invalid include/section requests use canonical `invalid_input` envelopes with conflict details preserved. | documents.integration.test.ts get_document canonical expected errors | 2026-05-12 |  |
| INT-arch-1 | archive_document then search excludes the archived document from default document results while the archive response exposes envelope `status`, archive `result_status`, and `archived_at`. | archive_status_field         | 2026-05-29   | 2026-05-29   |
| INT-arch-2 | archive_document batch returns ordered JSON archive envelopes with `status: succeeded` and `result_status: archived`, and get_document confirms archived status afterward. | archive_status_field         | 2026-05-29   | 2026-05-29   |
| INT-copy-1 | create -> copy -> get both documents proves copy_document returns JSON identification and the new copy has a distinct fq_id from the source. | documents.integration.test.ts copy_document and move_document JSON output | 2026-05-12 |  |
| INT-copy-2 | copy_document destination conflict returns canonical JSON `conflict` with `details.reason="path_exists"` and no runtime error. | documents.integration.test.ts copy_document and move_document JSON output | 2026-05-12 |  |
| INT-move-1 | create -> move -> get by fq_id proves move_document returns JSON identification with stable identity and updated path. | documents.integration.test.ts copy_document and move_document JSON output; move_document_to_new_directory | 2026-05-12 |  |
| INT-move-2 | move -> search/reference durability keeps fq_id-based reference resolution reaching the moved document while path-sensitive references can be updated separately. | tests/e2e/protocol.test.ts move_document JSON round-trip; existing direct_ref_durability_under_move | 2026-05-12 |  |
| INT-move-3 | move_document destination conflict returns canonical JSON `conflict` with `details.reason="path_exists"` and no runtime error. | documents.integration.test.ts copy_document and move_document JSON output | 2026-05-12 |  |
| INT-wdoc-1 | `write_document(create)` creates documents that are immediately retrievable and searchable through composed workflows. | append_then_search; append_and_search; update_document_then_search; replace_section; tests/integration/write-document.integration.test.ts; tests/e2e/protocol.test.ts | 2026-05-12 | 2026-05-12 |
| INT-wdoc-2 | `write_document(update)` replaces body/title and keeps the updated state visible to search and `get_document`. | update_document_then_search; replace_section; llm_ref_reflects_current_write_state; tests/integration/write-document.integration.test.ts; tests/e2e/protocol.test.ts | 2026-05-12 | 2026-05-12 |
| INT-wdoc-3 | `write_document(update)` frontmatter mutation feeds pointer/template discovery freshness without stale metadata. | pointer_mutation_propagates; llm_template_metadata_freshness | 2026-05-12 | 2026-05-12 |
| INT-insert-1 | `insert_in_doc(bottom)` composes with search and document read-back after append. | append_then_search; append_and_search; tests/integration/write-document.integration.test.ts; tests/e2e/protocol.test.ts | 2026-05-12 | 2026-05-12 |
| INT-replace-1 | `replace_doc_section` composes with section-scoped LLM reference resolution after mutation. | llm_ref_section_after_replace; tests/integration/write-document.integration.test.ts; tests/e2e/protocol.test.ts | 2026-05-12 | 2026-05-12 |
| INT-tags-1 | `apply_tags` composes across explicit document/memory targets with ordered result envelopes and disabled-memory per-target errors. | apply_tags_composition; tests/integration/apply-tags.test.ts; tests/integration/write-document.integration.test.ts | 2026-05-12 | 2026-05-12 |
| INT-search-1 | `search` composes with `write_document` and returns final JSON document results filtered by explicit `entity_types`. | unified_search_documents     | 2026-05-20   | 2026-05-20   |
| INT-search-2 | `search` composes with `write_memory` and mixed document/memory result limits through the final unified search surface. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-search-3 | `search` excludes archived memory results by default and returns them when `include_archived:true`. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-search-4 | `search` integration coverage verifies doc-read-only host config keeps document search available while disabled memory requests narrow with warnings or return canonical unsupported; accepted substitute coverage because this is host-config behavior, not a managed YAML scenario. | search.integration.test.ts | 2026-05-12 | 2026-05-12 |
| INT-wmem-1 | `write_memory(mode:"create")` creates memories whose JSON identifiers feed later composed MCP calls. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-wmem-2 | `write_memory(mode:"update")` creates a latest version that is retrievable and discoverable through composed workflows. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-wmem-3 | `get_memory` reads final `write_memory` output by `memory_ids` with JSON projection semantics. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-wmem-4 | `archive_memory(memory_ids)` composes with `search` archived visibility controls. | unified_search_memory_lifecycle | 2026-05-20   | 2026-05-20   |
| INT-rdoc-1 | `remove_document` composes with `write_document` by archiving lifecycle state before the vault file is removed. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-rdoc-4 | `remove_document` followed by `maintain_vault(action:"repair")` and `maintain_vault(action:"sync")` keeps the intentional removal out of active search and does not reclassify it as missing or stale active content. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-rdoc-5 | Removed archived documents remain absent from default final `search` document results. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mdir-1 | `manage_directory(action:"create")` composes with `list_vault` through ordered JSON directory creation. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mdir-2 | Repeated `manage_directory(action:"create")` on an existing directory returns unchanged without duplicate listing state. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mdir-3 | `manage_directory(action:"remove")` removes empty directories and the result is reflected by `list_vault`. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mdir-4 | `manage_directory(action:"remove")` reports a JSON conflict for non-empty directories created through normal document workflows. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mdir-5 | Ordered `manage_directory` results remain usable by declarative YAML assertions. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-1 | `maintain_vault(action:"sync")` is available as the final YAML maintenance action and returns structured counts. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-2 | `maintain_vault(action:"repair", dry_run:true)` returns structured repair counts without mutating state. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-3 | Combined `maintain_vault(action:["sync","repair"])` normalizes execution order to repair before sync. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-4 | YAML integration helpers document and dispatch final `maintain_vault` instead of relying on legacy scan shortcuts for new Phase 127 coverage. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-5 | `maintain_vault(action:"repair", background:true)` returns canonical `invalid_input`. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |
| INT-mvault-6 | `maintain_vault(action:"status")` returns canonical `not_found` for an unknown job id. | removal_directory_maintenance | 2026-05-20   | 2026-05-20   |

## Macro Language Phase 134

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-09 | MACRO-SHELL-01 / MACRO-SHELL-04: `call_macro` can compose multiple read-only shell verbs against a vault-jailed fixture in one workflow. | macro_shell_pipeline_and_exists | 2026-05-20   | 2026-05-20   |
| IX-23 | MACRO-SHELL-05: the same macro workflow combines native `fq._exists()` and brokered `<server>._exists()` with shell pipeline output. | macro_shell_pipeline_and_exists | 2026-05-20   | 2026-05-20   |

## Macro Language Phase 135

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-11 | MACRO-DISP-01: `call_macro` composes multiple native FlashQuery handlers through registry-backed dispatch in one workflow. | macro_dispatch_get_then_write | 2026-05-20   | 2026-05-20   |
| IS-12 | MACRO-DISP-02 / MACRO-DISP-03: `call_macro` rejects a forbidden native write reference before dispatch and the blocked target remains absent. | macro_permission_failure_zero_side_effects | 2026-05-19   | 2026-05-19   |

## Macro Language Phase 138

Note: Test Plan §4.10.6 reserved `IS-09`, `IS-10`, `IS-11`, and `IA-09`; the live matrix already used `IS-09`, `IS-11`, and `IS-12`, so T-Y-001 and T-Y-003 use `IS-13` and `IS-14` while T-Y-002 keeps the available `IS-10`. Sequential write-lock coverage uses `IA-10` to avoid overloading the concurrent `IA-09` row.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-13 | MACRO-DISP-01 / MACRO-INT-03 / T-Y-001: `call_macro` composes search results with archive_document so a matched document is archived and absent from active search. | macro_search_archive_workflow | 2026-05-22   | 2026-05-22   |
| IS-10 | MACRO-DISP-01 / T-Y-002: `call_macro` can invoke `fq.call_model` with response_format, branch on the structured verdict, and mutate a document. | macro_call_model_branch_mutate | 2026-05-19   | 2026-05-15   |
| IS-14 | MACRO-SRC-07 / MACRO-SRC-08 / T-Y-003: `call_macro` iterates list-typed input_vars over zero-to-N values and returns deterministic counts. | macro_input_vars_iteration   | 2026-05-20   | 2026-05-20   |
| IA-09 | MACRO-INT-02 / T-Y-004: concurrent public `call_macro` write workflows for different documents both complete through the existing write-lock layer. | macro_concurrent_write_lock  | 2026-05-19   | 2026-05-19   |
| IA-10 | MACRO-INT-02: sequential macro-dispatched document writes complete with the existing write-lock layer enabled. | macro_sequential_write_lock  | 2026-05-19   | 2026-05-19   |

## Phase 141 MCP Broker Tool Search And Overrides

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-MCB-08 | `description_override` is visible to delegated flat brokered dispatch and to `fq.search_tools` result text in managed YAML mode. | description_override_substitution | 2026-05-19   | 2026-05-19   |
| INT-MCB-13 | A `tool_search: enabled` purpose searches visible brokered and FQ-native tools, then dispatches the discovered brokered result tool in managed YAML mode. | search_tools_workflow        | 2026-05-19   | 2026-05-19   |

## Phase 142 MCP Broker Host Surface And ConsumerContext

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-MCB-02 | T-Y-002 `host.mcp_servers` exposes a brokered tool on the host surface and direct host dispatch succeeds. | brokered_host_dispatch       | 2026-05-19   | 2026-05-19   |
| INT-MCB-03 | T-Y-003 `host.tool_search: enabled` indexes host-visible brokered tools with the host search surface. | host_tool_search_with_brokered | 2026-05-19   | 2026-05-19   |
| INT-MCB-06 | T-Y-006 empty `host: {}` is valid and equivalent to absent brokered host visibility. | host_empty_section           | 2026-05-19   | 2026-05-19   |
| INT-MCB-09 | T-Y-009 existing `host_mcp_tools` native filtering coexists with new `host.mcp_servers` brokered visibility. | host_mcp_tools_with_brokered | 2026-05-19   | 2026-05-19   |
| INT-MCB-10 | T-Y-010 brokered host registration appears in `tools/list` by registry-key name with `description_override` applied through `BrokeredTool.description`. | brokered_host_registration   | 2026-05-19   | 2026-05-19   |
| INT-MCB-11 | T-Y-011 brokered tools have no broker-side tier classification; visibility is governed by `mcp_servers` membership. | brokered_no_tier_classification | 2026-05-19   | 2026-05-19   |

## Phase 143 MCP Broker Diagnostics And Macro Extensions

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-MCB-14 | T-Y-014 `flashquery list-tools` CLI emits paste-ready broker override YAML that re-parses into a valid config block. | cli_list_tools_paste_back    | 2026-05-19   | 2026-05-19   |
| INT-MCB-15 | T-Y-015 macro extensions `_self`, `continue`, `break`, and `_exists()` compose in a source_ref rundoc workflow. | macro_extensions_compose_rundoc | 2026-05-19   | 2026-05-19   |

## Phase 146 Embedding Reliability Foundation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-15 | T-Y-001: pooled record vector SQL supports concurrent `write_record` embed_fields writes and semantic `search_records` results with scores. | record_embed_pool_concurrency | 2026-05-24   | 2026-05-24   |

## Phase 160 Vault Write Coherency Folder Locks

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-WCO-01 | T-Y-001 / REQ-007 public folder coordination workflow: write a descendant document, rename the folder through `manage_directory`, and read the descendant at the destination path. | folder_coordination          | 2026-05-28   | 2026-05-28   |

## Phase 163 Vault Write Coherency Batch Contract

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-WCO-02 | T-Y-002 / REQ-018 public archive batch envelope: four-item `archive_document` batch reports ordered succeeded, conflicted, failed, succeeded entries and successful writes persist. | batch_envelope_per_item      | 2026-05-27   | 2026-05-27   |
| INT-WCO-03 | T-Y-003 / REQ-019 public mixed batch input shape: `[bare-string, object-with-token, object-with-stale-token]` produces succeeded, succeeded, conflicted in input order. | batch_mixed_input            | 2026-05-27   | 2026-05-27   |

---

## IS — Search Coherence

Verifies that content written through one path is discoverable through the expected search paths.

| ID     | Behavior                                                             | Covered By                  | Date Updated | Last Passing |
|--------|----------------------------------------------------------------------|-----------------------------|--------------|--------------|
| IS-01  | Create document → appears in search_documents results (VALIDATED)                 | write_then_search            | 2026-05-25   | 2026-05-25   |
| IS-02  | Create memory → appears in search_memories results (VALIDATED)                    | write_then_search            | 2026-05-25   | 2026-05-25   |
| IS-03  | Create document + memory → both appear in search_all results (VALIDATED)          | cross_domain_search_embeddings | 2026-05-22   | 2026-05-22   |
| IS-04  | search_all with entity_types=['documents'] returns only documents (VALIDATED)     | cross_domain_search          | 2026-05-20   | 2026-05-20   |
| IS-05  | search_all with entity_types=['memories'] returns only memories (VALIDATED)       | search_memories_only         | 2026-05-22   | 2026-05-22   |
| IS-06  | Tagged document appears in tag-filtered search_documents (VALIDATED)              | tag_filtered_documents       | 2026-05-20   | 2026-05-20   |
| IS-07  | Tagged memory appears in tag-filtered search_memories (VALIDATED)                 | tag_filtered_memories        | 2026-05-20   | 2026-05-20   |
| IS-08  | Multi-tag filter returns only documents matching all specified tags (VALIDATED)    | multitag_filter              | 2026-05-20   | 2026-05-20   |

---

## IA — Archive and State Transitions

Verifies that archiving content removes it from active search results while leaving other
content unaffected.

| ID     | Behavior                                                              | Covered By                      | Date Updated | Last Passing |
|--------|-----------------------------------------------------------------------|---------------------------------|--------------|--------------|
| IA-01  | Archive document → absent from search_documents (VALIDATED)                       | archive_removes_from_search  | 2026-05-20   | 2026-05-20   |
| IA-02  | Archive document → memory with same topic still searchable (VALIDATED)            | archive_removes_from_search  | 2026-05-20   | 2026-05-20   |
| IA-03  | Archive document → absent from search_all results (VALIDATED)                     | archive_removes_from_search  | 2026-05-20   | 2026-05-20   |
| IA-04  | Archive memory → absent from search_memories (VALIDATED)                          | archive_memory               | 2026-05-20   | 2026-05-20   |
| IA-05  | Archive memory → document with same topic still searchable (VALIDATED)            | archive_memory               | 2026-05-20   | 2026-05-20   |
| IA-06  | Archive one of several tagged documents → others remain discoverable (VALIDATED)  | archive_partial_set          | 2026-05-20   | 2026-05-20   |
| IA-07  | Archive document → get_document reflects status='archived' (VALIDATED)            | archive_status_field         | 2026-05-25   | 2026-05-25   |
| IA-08  | Create and archive document in nested vault path → remains correctly archived and retrievable (VALIDATED) | archive_nested_path          | 2026-05-20   | 2026-05-20   |

---

## IX — Cross-Domain Interaction

Verifies behaviors that span more than one FlashQuery domain (documents, memories, tags, plugins).

| ID     | Behavior                                                                    | Covered By           | Date Updated | Last Passing |
|--------|-----------------------------------------------------------------------------|----------------------|--------------|--------------|
| IX-01  | Document and memory share a tag → search_all with that tag returns both (VALIDATED)      | cross_domain_search_embeddings | 2026-05-22   | 2026-05-22   |
| IX-02  | Archived document → only memory found in search_all after archive (VALIDATED)            | archive_doc_memory_in_searchall | 2026-05-22   | 2026-05-22   |
| IX-03  | Create via vault.write, update via update_document → search returns new content (VALIDATED) | write_document_then_search   | 2026-05-20   | 2026-05-20   |
| IX-04  | Create document, get_document by fqc_id → returns correct content (VALIDATED)           | document_retrieval_by_id     | 2026-05-25   | 2026-05-25   |
| IX-05  | Create document with tags, apply_tags to add more → all tags searchable (VALIDATED)     | apply_tags_composition       | 2026-05-20   | 2026-05-20   |
| IX-06  | Get document by vault-relative path → returns same content as fqc_id retrieval (VALIDATED) | get_document_by_path         | 2026-05-20   | 2026-05-20   |
| IX-07  | Get document returns all metadata fields (title, tags, status, fqc_id, path) (VALIDATED) | get_document_metadata        | 2026-05-20   | 2026-05-20   |
| IX-08  | Create multiple documents, update each, retrieve all → each returns updated state (VALIDATED) | concurrent_updates           | 2026-05-20   | 2026-05-20   |
| IX-09  | Evaluation workflow end-to-end: search_documents → get_document batch with include=["frontmatter","headings"] → call_model with {{ref:<chosen>#<chosen-section>}} resolves the targeted section | eval_workflow_search_get_call | 2026-05-20   | 2026-05-15   |
| IX-10  | Reference reflects current write state: vault.write doc → call_model {{ref:doc.md}} returns body A → update_document body → call_model {{ref:doc.md}} returns body B | llm_ref_reflects_current_write_state | 2026-05-20   | 2026-05-15   |
| IX-11  | Section coherence: vault.write multi-section doc → call_model {{ref:doc.md#Section}} returns original section → replace_doc_section → call_model {{ref:doc.md#Section}} returns new section | llm_ref_section_after_replace | 2026-05-20   | 2026-05-15   |
| IX-12  | Pointer dereference cross-interface consistency: get_document(follow_ref:"projections.summary") and call_model {{ref:source->projections.summary}} return identical target body and matching resolved_to | pointer_deref_cross_interface_consistency | 2026-05-20   | 2026-05-15   |
| IX-13  | Pointer mutation propagates: source has projections.summary→A; call_model {{ref:source->projections.summary}} injects A; update_doc_header re-points to B; next call_model injection is B (covers top-level + nested pointer keys) | pointer_mutation_propagates  | 2026-05-20   | 2026-05-15   |
| IX-14  | Archive does not block reference resolution: vault.write doc → archive_document → call_model {{ref:doc.md}} resolves successfully and reports correct chars in injected_references[] | llm_ref_resolves_after_archive | 2026-05-20   | 2026-05-15   |
| IX-15  | Projections matrix — fq_id-source dereference: {{ref:<source-uuid>->projections.summary}} resolves through fq_id-source path, then nested-key pointer traversal, returning target body | projections_id_source_dereference | 2026-05-20   | 2026-05-15   |
| IX-16  | Projections matrix — fq_id-typed target value: source has projections.key_entities=<target-uuid>; call_model {{ref:source->projections.key_entities}} resolves via fq_id branch and injects target body | projections_fq_id_typed_target | 2026-05-20   | 2026-05-15   |
| IX-17  | Projections matrix — bare-filename-typed target value: source has projections.decisions=<target-filename>; call_model {{ref:source->projections.decisions}} resolves via filename-search branch and injects target body | projections_filename_typed_target | 2026-05-20   | 2026-05-15   |
| IX-18  | Projections matrix — follow_ref + sections: get_document(follow_ref:"projections.summary", sections:["<heading>"]) returns the named section of the dereferenced target inside followed_ref.body | projections_follow_ref_with_sections | 2026-05-20   | 2026-05-20   |
| IX-19  | Projections matrix — durability under move: source has both path-typed and fq_id-typed pointers to same target; move_document target → follow_ref on path-typed pointer returns follow_ref_target_not_found while fq_id-typed pointer still resolves | projections_durability_under_move | 2026-05-20   | 2026-05-20   |
| IX-20  | Projections matrix — batch follow_ref happy path: get_document(identifiers:[src1,src2,src3], follow_ref:"projections.summary") returns array with each followed_ref.body matching its corresponding target's body in positional order | projections_batch_follow_ref_happy | 2026-05-20   | 2026-05-20   |
| IX-21  | Projections matrix — batch follow_ref partial failure: 2 sources have the pointer + 1 source lacks it → batch response is success/error/success in positional order with follow_ref_path_not_found on the missing element | projections_batch_follow_ref_partial | 2026-05-20   | 2026-05-20   |
| IX-22  | Direct `{{ref:...}}` durability under move: vault.write doc at path A → call_model `{{ref:A}}` and `{{ref:<fq_id>}}` both resolve → move_document A→B → call_model `{{ref:A}}` returns a stable reference resolution failure while `{{ref:<fq_id>}}` and `{{ref:B}}` still resolve to the same body | direct_ref_durability_under_move | 2026-05-20   | 2026-05-15   |

---

## IC — Content Operations (Composed)

Verifies that content mutation tools (append, update, replace) produce results
discoverable through search after the mutation.

| ID     | Behavior                                                                         | Covered By | Date Updated | Last Passing |
|--------|----------------------------------------------------------------------------------|------------|--------------|--------------|
| IC-01  | Append content to document → appended content appears in search_documents (VALIDATED)         | append_then_search           | 2026-05-20   | 2026-05-20   |
| IC-02  | Update document body → updated content appears in search_documents (VALIDATED)                | write_document_then_search   | 2026-05-20   | 2026-05-20   |
| IC-03  | Replace section in document → replaced content appears, original absent (VALIDATED)           | replace_section              | 2026-05-20   | 2026-05-20   |
| IC-04  | Append to document → search reflects appended text immediately after append (VALIDATED)       | append_and_search            | 2026-05-20   | 2026-05-20   |

---

## IR — Plugin Reconciliation

Verifies that the reconcile-on-read engine and plugin policy system compose correctly across
multi-step workflows involving plugin tables, record tools, scan, and frontmatter.

| ID     | Behavior                                                                                             | Covered By | Date Updated | Last Passing |
|--------|------------------------------------------------------------------------------------------------------|------------|--------------|--------------|
| IR-01  | Mixed reconciliation: auto-track + ignore + deleted + moved all handled in single pass (VALIDATED)               | ir01_plugin_mixed_reconciliation | 2026-05-20   | 2026-05-20   |
| IR-02  | Full resurrection lifecycle: track → delete → restore → resurrect with FK references intact (VALIDATED)          | ir02_plugin_deletion_lifecycle | 2026-05-20   | 2026-05-20   |
| IR-03  | Auto-track + pending template review + clear → subsequent tool responses show no pending items (VALIDATED)       | ir03_plugin_autotrack_pending_clear | 2026-05-20   | 2026-05-20   |
| IR-04  | Document created via MCP in watched folder is immediately visible to same-call reconciliation (VALIDATED)        | ir04_plugin_mcp_immediate_reconciliation | 2026-05-20   | 2026-05-20   |
| IR-05  | Plugin with no declared policies ignores new docs, follows moved docs, ignores modifications (VALIDATED)         | ir05_plugin_no_policies_defaults | 2026-05-20   | 2026-05-20   |
| IR-06  | Document moved out with on_moved:untrack, then moved back → resurrects, not re-added (VALIDATED)                 | ir06_plugin_stop_tracking_lifecycle | 2026-05-20   | 2026-05-20   |
| IR-07  | Cross-plugin resurrection: original plugin resurrects; second plugin independently discovers as added (VALIDATED) | ir07_plugin_cross_plugin_discovery | 2026-05-20   | 2026-05-20   |
| IR-08  | Bulk auto-track: all new documents processed in single pass with no silent cap (VALIDATED)                       | ir08_plugin_bulk_autotrack   | 2026-05-20   | 2026-05-20   |
| IR-09  | Multiple state transitions between reconciliation runs: only current state classified (VALIDATED)                | ir09_plugin_state_transitions | 2026-05-20   | 2026-05-20   |
| IR-10  | Large pending review backlog processable incrementally — subset cleared per invocation, remainder stable (VALIDATED) | ir10_plugin_incremental_pending_review | 2026-05-20   | 2026-05-20   |
| IR-11  | Document moved between plugin-owned folders reports moved in source table, not added in destination (VALIDATED)  | ir11_plugin_cross_folder_move | 2026-05-20   | 2026-05-20   |
| IR-12  | Pending review items appear in record tool response even when reconciliation staleness check skips diff (VALIDATED) | ir12_plugin_pending_review_staleness | 2026-05-20   | 2026-05-20   |
| IR-13  | Frontmatter-based type discovery: document outside all watched folders picked up via fqc_type (VALIDATED)        | ir13_plugin_frontmatter_discovery | 2026-05-20   | 2026-05-20   |
| IR-14  | `register_plugin -> write_record(create) -> search_records` final plugin-record workflow (VALIDATED)             | plugin_record_consolidation  | 2026-05-25   | 2026-05-25   |
| IR-15  | `write_record(update) -> plugin reconciliation -> clear_pending_reviews(action:"list")` final workflow (VALIDATED) | plugin_record_consolidation  | 2026-05-25   | 2026-05-25   |
| IR-16  | `write_record -> archive_record -> search_records` archived visibility workflow (VALIDATED)                      | plugin_record_consolidation  | 2026-05-25   | 2026-05-25   |

---

## IF — Filesystem Composition

Verifies that directory creation, listing, and removal compose correctly with other
FlashQuery tools (create_document, move_document, register_plugin, search_documents). Phase 128 legacy migration evidence.

| ID     | Behavior                                                                                              | Covered By | Date Updated | Last Passing |
|--------|-------------------------------------------------------------------------------------------------------|------------|--------------|--------------|
| IF-01  | create_directory → list_vault(show: "directories") confirms created directory (VALIDATED)                         | create_then_list_directories | 2026-05-20   | 2026-05-20   |
| IF-02  | create_directory with root_path → list_vault recursive shows full tree (VALIDATED)                               | create_then_list_directories | 2026-05-20   | 2026-05-20   |
| IF-03  | create_directory → create_document → list_vault(show: "all") shows both directory and document (VALIDATED)       | create_directory_then_document | 2026-05-20   | 2026-05-20   |
| IF-04  | create_directory → create_document → search_documents finds document by title (VALIDATED)                        | create_directory_then_search | 2026-05-20   | 2026-05-20   |
| IF-05  | create_directory → remove_directory (empty) → list_vault confirms absence (VALIDATED)                            | directory_lifecycle          | 2026-05-20   | 2026-05-20   |
| IF-06  | batch create_directory → list_vault recursive → remove leaf directories first → list_vault confirms (VALIDATED)  | directory_lifecycle          | 2026-05-20   | 2026-05-20   |
| IF-07  | create_directory called twice with same path → list_vault shows no duplicate entries (idempotency) (VALIDATED)   | create_directory_idempotent  | 2026-05-20   | 2026-05-20   |
| IF-08  | dot-prefixed directory created → list_vault shows it is invisible to default listing (VALIDATED)                 | dot_directory_invisible      | 2026-05-20   | 2026-05-20   |
| IF-09  | create_directory with name requiring sanitization → list_vault shows sanitized name → create_document in it succeeds (VALIDATED) | sanitized_directory_usable   | 2026-05-20   | 2026-05-20   |
| IF-10  | create_directory → move_document into new directory → list_vault confirms moved document (VALIDATED)             | move_document_to_new_directory | 2026-05-20   | 2026-05-20   |
| IF-11  | list_vault(show: "files") excludes directories; list_vault(show: "all") includes both as structured JSON entries (VALIDATED) | list_vault_show_modes        | 2026-05-20   | 2026-05-20   |
| IF-12  | list_vault(show: "all", extensions: [".md"]) — directories unfiltered, only .md files shown as structured JSON entries (VALIDATED) | list_vault_extension_filter_with_directories | 2026-05-20   | 2026-05-20   |
| IF-13  | register_plugin → create_directory scaffold → list_vault confirms dirs → create_document → search_records confirms auto-tracking (VALIDATED) | plugin_init_scaffold         | 2026-05-20   | 2026-05-20   |
| IF-14  | register_plugin → create_directory scaffold → vault.write in watched folder → reconciliation → search_records (VALIDATED) | plugin_init_with_reconciliation | 2026-05-20   | 2026-05-20   |
| IF-15  | create_directory → list_vault default/include modes produce structured JSON entries with metadata fields (VALIDATED) | list_vault_format_modes      | 2026-05-20   | 2026-05-20   |
| IF-16  | create_directory → create_document → list_vault(show: "files") exposes file size as `entries[].size.chars` (VALIDATED) | list_vault_table_file_size   | 2026-05-20   | 2026-05-20   |

---

## IL — LLM Call Integration

Verifies that the LLM call path (`call_model`) and LLM usage reporting (`get_llm_usage`) compose
correctly end-to-end across the write path (`fqc_llm_usage` row recording) and read path
(`get_llm_usage` aggregation modes).

| ID     | Behavior                                                                                                                                                      | Covered By              | Date Updated | Last Passing |
|--------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------|--------------|--------------|
| IL-01  | call_model resolver=model returns non-error response with metadata envelope (model_name, provider_name, cost_usd, latency_ms)                                 | llm_call_model_basic         | 2026-05-20   | 2026-05-15   |
| IL-02  | call_model resolver=purpose returns non-error response; metadata includes resolved_model_name matching the configured model for that purpose                  | llm_call_model_purpose       | 2026-05-20   | 2026-05-15   |
| IL-03  | Multiple call_model calls sharing a trace_id accumulate distinct rows in fqc_llm_usage; trace_cumulative.total_calls grows monotonically (COST-01)            | llm_cost_accumulation        | 2026-05-20   | 2026-05-15   |
| IL-04  | call_model writes a row, get_llm_usage summary mode returns total_calls >= 1 with by_purpose direct_model_calls present, recent returns model_name (REPT-01, REPT-02 end-to-end) | llm_usage_query              | 2026-05-20   | 2026-05-15   |
| IL-05  | call_model resolver=purpose → get_llm_usage by_purpose → named purpose appears in purposes array with calls and primary_model_hit_rate fields                | llm_by_purpose_mode          | 2026-05-25   | 2026-05-25   |
| IL-06  | call_model resolver=model → get_llm_usage by_purpose → call appears in direct_model_calls; purposes array is empty (resolver=model calls excluded from purposes) | llm_direct_model_calls       | 2026-05-20   | 2026-05-15   |
| IL-07  | call_model with trace_id + call without trace_id → get_llm_usage summary filtered by trace_id → total_calls=1 (untraced call excluded)                       | llm_trace_id_filter          | 2026-05-20   | 2026-05-15   |
| IL-08  | call_model → get_llm_usage by_model → models array contains model_name, provider_name, and avg_fallback_position for the called model                         | llm_by_model_mode            | 2026-05-25   | 2026-05-25   |
| IL-09  | multiple call_model resolver=purpose calls via primary model → get_llm_usage by_purpose → primary_model_hit_rate equals 1                                     | llm_by_purpose_mode          | 2026-05-25   | 2026-05-25   |
| IL-10  | call_model with {{ref:path}} placeholder injects document body before LLM dispatch; response metadata includes injected_references[] and prompt_chars (REF-01, REF-07) | llm_reference_syntax_basic   | 2026-05-20   | 2026-05-15   |
| IL-11  | call_model with {{ref:path#Section}} injects only the named section's content (REF-02)                                                                              | llm_reference_syntax_section | 2026-05-20   | 2026-05-15   |
| IL-12  | call_model with {{ref:path->pointer}} dereferences frontmatter pointer; response metadata includes resolved_to (REF-02, REF-07)                                     | llm_reference_syntax_pointer | 2026-05-20   | 2026-05-15   |
| IL-13  | call_model with unresolvable or invalid {{ref:...}} returns isError + reference_resolution_failed with stable reason/detail; no LLM call made (REF-04, REF-06)       | llm_reference_syntax_fail    | 2026-05-20   | 2026-05-20   |
| IL-14  | call_model without active {{ref:...}} patterns omits injected_references and prompt_chars; active and escaped {{id:...}} remain literal ATL v1 text (REF-03, REF-05) | llm_reference_syntax_noop    | 2026-05-20   | 2026-05-15   |
| IL-15  | call_model resolver=list_models returns {models: [...]} where each entry has name, type, provider, model_id, input_cost_per_million, output_cost_per_million (DISC-01 required fields), tags, and structured capabilities when declared              | llm_discovery_local_model_managed | 2026-05-19   | 2026-05-19   |
| IL-16  | list_models discovery → model names match config → call_model with one of those names succeeds | llm_discovery_then_call      | 2026-05-20   | 2026-05-15   |
| IL-17  | list_purposes discovery → purpose names match config → call_model by purpose succeeds | llm_discovery_then_call      | 2026-05-20   | 2026-05-15   |
| IL-18  | call_model resolver=list_models and resolver=list_purposes both succeed when called WITHOUT name and WITHOUT messages — schema makes them optional for discovery (DISC-04)                            | llm_discovery_list           | 2026-05-19   | 2026-05-19   |
| IL-19  | call_model resolver=search returns {query, results: {purposes, models}}; case-insensitive substring match; non-matching category returns [] (not omitted) (DISC-03 success + zero-match shape)        | llm_discovery_search         | 2026-05-20   | 2026-05-20   |
| IL-20  | call_model resolver=search with no parameters.query (or empty-string query) returns isError with "search requires parameters.query (non-empty string)" (DISC-03 missing-query path)                    | llm_discovery_search         | 2026-05-20   | 2026-05-20   |
| IL-21  | call_model with {{ref:...}} writes a fqc_llm_usage row reflecting the resolved (post-injection) prompt → get_llm_usage summary total_calls increments by 1; recorded prompt size aligns with metadata.prompt_chars | llm_ref_writes_usage_row     | 2026-05-20   | 2026-05-15   |
| IL-22  | call_model with unresolvable {{ref:...}} fails before LLM dispatch → fqc_llm_usage row count unchanged → get_llm_usage total_calls delta is 0 (no provider call, no row written)                                  | llm_ref_unresolved_no_usage_row | 2026-05-20   | 2026-05-20   |
| IL-23  | call_model with {{ref:...}} + trace_id → get_llm_usage filtered by that trace_id returns 1 call; the call's metadata still reports injected_references[] and prompt_chars (reference resolution participates in trace tracking) | llm_ref_trace_id_filter      | 2026-05-20   | 2026-05-15   |
| IL-24  | call_model resolver=search with matching parameters.query → caller picks a purposes[].name from results → subsequent call_model with that purpose succeeds and writes a usage row (discovery→delegate closure via search) | llm_search_then_purpose_call | 2026-05-20   | 2026-05-15   |
| IL-25  | SUPERSEDED for ATL v1: mixed {{ref:path}} + {{id:<uuid>}} no longer resolves both placeholders; {{id:...}} is literal text and only active {{ref:...}} participates in hydration/metadata | llm_mixed_ref_and_id_placeholders | 2026-05-20   | 2026-05-15   |
| IL-26  | ATL-DS-01 exact `call_model` `return_messages` envelope assertions (default `messages: []`, hydrated returned inputs, final assistant message, discovery raw shape) are covered by directed Python because the YAML runner only supports substring assertions against `content[0].text`, not exact parsed JSON envelope checks | test_call_model_return_messages.py | 2026-05-05   |              |
| IL-27  | ATL-I-04 reference resolver integration proves real vault path, fq_id, section, pointer resolved_to, ambiguity guidance, metadata chars, and non-recursive injected content using Supabase-backed document rows | reference-resolver.integration.test.ts | 2026-05-05   | 2026-05-05   |
| IL-28  | TMPL-01 and TMPL-03: `reference-resolver.integration.test.ts` proves real-vault `fq_template: true` rendering, plain-document ignored params, and document-param resolution/failure through Supabase-backed document rows | reference-resolver.integration.test.ts | 2026-05-06   | 2026-05-06   |
| IL-29  | TMPL-02 and TMPL-05: `reference-resolver.integration.test.ts` proves alias `_template` reuse and `_items` ordered list injection with `_separator`, `resolved_to_count`, and item metadata | reference-resolver.integration.test.ts | 2026-05-06   | 2026-05-06   |
| IL-30  | VAL-114: Phase 114 full gate includes build, focused unit tests, Supabase-backed reference resolver integration, and managed directed scenario `test_call_model_template_parameterization` | reference-resolver.integration.test.ts; test_call_model_template_parameterization | 2026-05-06   | 2026-05-06   |
| IL-31  | ATL-U-08: Config schema accepts first-class purpose orchestration fields, validates known loop guardrail defaults, migrates legacy free-form model capabilities to tags, preserves structured capability booleans, and produces distinct unknown-vs-unsupported admission diagnostics | llm-config.test.ts; llm_discovery_list; test_call_model_agent_loop_capabilities | 2026-05-06   | 2026-05-06   |
| IL-32  | ATL-I-01: Schema verification creates and verifies `fqc_purpose_templates` plus final Phase 115 model/purpose storage columns for template bindings, tags, capabilities, tools, and excluded tools | supabase-schema-verify.test.ts | 2026-05-06   | 2026-05-06   |
| IL-33  | ATL-I-02: Config sync persists YAML purpose-template bindings, preserves API/runtime precedence over YAML, logs dangling bindings, and lets YAML bindings reappear after runtime removal | llm-config-sync.test.ts | 2026-05-06   | 2026-05-06   |
| IL-34  | ATL-I-06: Runtime template binding behavior is covered at the TypeScript integration layer because no public runtime binding YAML tool name exists yet; precedence, removal, and shared capability admission are validated without inventing a scenario-only public API | llm-config-sync.test.ts | 2026-05-06   | 2026-05-06   |
| IL-35  | ATL-INT-04: Runtime-vs-YAML template binding precedence survives restart and YAML reappears after runtime binding removal; recorded against `llm-config-sync.test.ts` until a public runtime binding scenario surface exists | llm-config-sync.test.ts | 2026-05-06   | 2026-05-06   |
| IL-36  | VAL-115: Phase 115 full gate includes build, focused unit tests, Supabase-backed schema/config-sync integration, managed directed scenario `test_call_model_agent_loop_capabilities`, and managed YAML scenario `llm_discovery_list` | llm-config.test.ts; llm-config-sync.test.ts; llm-tool.test.ts; schema-verify.test.ts; supabase-schema-verify.test.ts; test_call_model_agent_loop_capabilities; llm_discovery_list | 2026-05-06   | 2026-05-06   |
| IL-37  | ATL-INT-01: Template-body freshness brackets an `update_document` write with two `call_model` calls; the first sees ALPHA and the second sees BETA without stale ALPHA | llm_template_reference_freshness | 2026-05-20   | 2026-05-15   |
| IL-38  | ATL-INT-02: Document-parameter freshness brackets a target-document write with two `call_model` calls; the first renders ALPHA and the second renders BETA | llm_template_document_param_freshness | 2026-05-20   | 2026-05-15   |
| IL-39  | ATL-INT-03: Discovery-to-invocation closure covers public `list_purposes` usage guidance, discovered `template_path`/parameter metadata, direct `{{ref:...}}` template invocation, and purpose invocation | llm_discovery_then_call      | 2026-05-20   | 2026-05-15   |
| IL-40  | ATL-INT-05: Mixed path, section, pointer, alias, and `_items` template/reference modes compose in one `call_model` flow; parsed directed coverage asserts metadata ordering, parent list entry, same-document sections, and default `_separator` shape | llm_mixed_reference_modes    | 2026-05-20   | 2026-05-15   |
| IL-41  | Help resolver participates in no-usage-row contract: baseline get_llm_usage → call_model resolver=help returns help body → get_llm_usage total_calls delta is 0 (help is a no-LLM-dispatch resolver and writes no `fqc_llm_usage` row) | llm_help_no_usage_row        | 2026-05-20   | 2026-05-20   |
| IL-42  | Template metadata freshness reaches discovery surface: vault.write template (`fq_template: true`, `fq_expose_as_tool: true`, `fq_desc: A`) → list_purposes shows description A in template_tools → update_document rewrites frontmatter with `fq_desc: B` → next list_purposes shows description B (template registry reads frontmatter fresh from disk per call) | llm_template_metadata_freshness | 2026-05-20   | 2026-05-20   |
| IL-43  | POST-01 / §3.11.1.1 delegated purpose workflow with `tools: ["tier:read-write"]` exposes corrected tier-derived tools through `call_model` metadata, then composes that surface with the corrected `insert_in_doc` final path and read-back. Deterministic delegated dispatch is covered by the directed mock-provider and E2E layers. | delegated_tier_eligibility   | 2026-05-19   | 2026-05-19   |
| IL-44  | §3.11.1.1 I-tier-5 split: explicit `maintain_vault` remains rejected through hard-exclusion diagnostics, while an explicit admin-style fixture without hard exclusion remains reachable through delegated registry assembly. | tests/integration/tool-registry.test.ts (`I-tier-5`, `I-tier-5b`) | 2026-05-13   | 2026-05-13   |

## INT-MCB — MCP Broker Phase A

Phase 139 broker foundation YAML coverage for managed stdio fixture servers,
consumer visibility validation, delegated broker dispatch, and resolved
brokered tool-call cost tracing.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| INT-MCB-01 | Configure `mcp_servers` plus `purposes.broker_researcher.mcp_servers`, invoke `call_model`, and dispatch `basic__echo` through the brokered purpose tool surface. | brokered_purpose_dispatch    | 2026-05-19   | 2026-05-19   |
| INT-MCB-04 | Unknown `host.mcp_servers` entry fails managed startup with the named host context and missing server ID. | host_unknown_server_fail_loud | 2026-05-19   | 2026-05-19   |
| INT-MCB-05 | Unknown `purposes.<name>.mcp_servers` entry fails managed startup with the named purpose and missing server ID. | purpose_unknown_server_fail_loud | 2026-05-19   | 2026-05-19   |
| INT-MCB-07 | Server-default and per-tool override `cost_per_call` values surface in observable brokered `tool_calls` trace entries; per-tool override beats server default. | cost_per_call_resolution     | 2026-05-19   | 2026-05-19   |
| INT-MCB-12 | T-Y-012 managed YAML workflow pins the first TOFU schema, observes schema drift through `notifications/tools/list_changed`, returns `needs_user_input` with old/new schema and diff summary, then approves and resumes successfully. | tofu_drift_yaml_workflow     | 2026-05-19   | 2026-05-19   |

---

## Behavior - Testcase Validation

### write_then_search

**Behaviors affected**
- IS-01: Create document → appears in search_documents results (Phase 128 legacy migration evidence)

**Description**: The test calls `search_all` (not `search_documents`) to verify the written document is findable. IS-01 specifically targets the `search_documents` API surface — a separate MCP tool from `search_all`. A server implementation that broke `search_documents` while leaving `search_all` working would pass this test. The two tools may share an underlying query path, but the behavior contract for IS-01 is specifically about `search_documents`. Phase 128 legacy migration evidence.

**How to Remedy**: Add a step that calls `search_documents` with the document's title as the query and asserts `expect_contains: "The Ocean at Dawn"`. This directly exercises the `search_documents` API path claimed by IS-01. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Added a `search_documents` assert step (Step 5) that queries `"The Ocean at Dawn"` and asserts `expect_contains: "The Ocean at Dawn"`. This directly exercises the `search_documents` API path required by IS-01. The step passes without embeddings because the title query matches by title/path metadata. All 6 steps pass. Phase 128 legacy migration evidence.

---

### cross_domain_search

**Behaviors affected**
- IS-03: Create document + memory → both appear in search_all results (Phase 128 legacy migration evidence)
- IX-01: Document and memory share a tag → search_all with that tag returns both (Phase 128 legacy migration evidence)

**Description**: The test verifies document discoverability via `search_all` and memory discoverability via `list_memories` — two separate calls. IS-03 and IX-01 both describe a single `search_all` invocation that returns both a document and a memory in the same result set. Without embeddings, memories do not appear in `search_all` results, so the test cannot satisfy these behaviors in a non-embedding configuration. The test description acknowledges this gap ("Verifying that memories appear alongside documents in a single search_all result set requires embedding configuration") but the coverage IDs IS-03 and IX-01 are marked as covered without a `deps: [embeddings]` declaration, meaning no skip guard exists. Phase 128 legacy migration evidence.

**How to Remedy**: Option A — add `deps: [embeddings]` to `cross_domain_search.yml` and add steps that call `search_all` (with a shared query string or tag) and assert both the document path and the memory content appear in the same response. Option B — split IS-03 and IX-01 into a separate embedding-gated test, and revise the existing `cross_domain_search` test to cover only what it can test without embeddings (IS-04 and the basic write-then-find coherence). Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Used Option B. Narrowed `cross_domain_search.yml` coverage to `[IS-04]` only (removing IS-03 and IX-01) and updated its description to reflect that it covers the documents-only filter path. Created a new embedding-gated test `cross_domain_search_embeddings.yml` with `coverage: [IS-03, IX-01]` and `deps: [embeddings]`. The new test writes a document and memory that both share the subject "Andromeda Galaxy" (ensuring high semantic similarity), then asserts both appear in the same `search_all` result — once with a plain query (IS-03) and once with a tag filter (IX-01). All 4 steps pass. Phase 128 legacy migration evidence.

---

### search_memories_only

**Behaviors affected**
- IS-05: search_all with entity_types=['memories'] returns only memories (Phase 128 legacy migration evidence)

**Description**: The behavior IS-05 is explicitly about calling `search_all` with `entity_types=['memories']` and verifying that only memories are returned. The test never calls `search_all` at all — it uses `list_memories` with a tag filter throughout. This means the `entity_types=['memories']` filter path in `search_all` is entirely untested. A server that returned documents instead of memories when `entity_types=['memories']` is passed would pass this test. Phase 128 legacy migration evidence.

**How to Remedy**: Add a step that calls `search_all` with `entity_types: [memories]` and a query that could match both the document and the memory. Assert that the memory content appears (`expect_contains`) and that the document title does not (`expect_not_contains: "Ancient Forests and Ecosystems"`). Note: without embeddings, memories may not appear in `search_all` at all — if so, add `deps: [embeddings]` and update the test accordingly. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Rewrote `search_memories_only.yml` with `deps: [embeddings]` (confirmed necessary — `search_all` with `entity_types=['memories']` returns `isError: true` without an embedding provider). Fixed the duplicate `expect_contains` YAML key in the original test by splitting into two assert steps. Added two new steps that call `search_all` with `entity_types: [memories]` and assert the memory content is present and the document title is absent. All 6 steps pass. Phase 128 legacy migration evidence.

---

### multitag_filter

**Behaviors affected**
- IS-08: Multi-tag filter returns only documents matching all specified tags

**Description**: The behavior IS-08 states that a multi-tag filter returns only documents matching ALL specified tags (intersection semantics). The test never uses multiple tags simultaneously in a single filter call. Every `search_documents` step in the test uses exactly one tag. The core claim — that passing `tags: [mtf-alpha, mtf-beta]` returns only `doc_ab` and excludes `doc_ag` and `doc_bg` — is never verified. Additionally, two steps have duplicate `expect_contains` YAML keys (lines with `expect_contains: "Document With Both Tags"` immediately followed by `expect_contains: "Document With Alpha and Gamma"`). PyYAML silently overwrites the first key, so `"Document With Both Tags"` is never actually asserted in those steps. Phase 128 legacy migration evidence.

**How to Remedy**: Add a step that calls `search_documents` with `tags: [mtf-alpha, mtf-beta]` and asserts `expect_contains: "Document With Both Tags"`, `expect_not_contains: "Document With Alpha and Gamma"`, and `expect_not_contains: "Document With Beta and Gamma"`. This directly tests the intersection semantic. Also fix the duplicate `expect_contains` keys by using `expect_contains` only once per assertion step (split into two steps if both strings need checking, or chain with a different assertion key approach). Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Fixed three issues. (1) Duplicate `expect_contains` keys in all three single-tag steps — split each into two assertion steps so both title strings are actually evaluated by PyYAML. (2) Added `tag_match: all` to the multi-tag filter steps — `search_documents` defaults to `tag_match: 'any'` (OR semantics), so intersection semantics require the explicit parameter. (3) Added two new steps that call `search_documents` with `tags: [mtf-alpha, mtf-beta]` and `tag_match: all`, asserting `doc_ab` is present and both `doc_ag` and `doc_bg` are absent. All 11 steps pass. Phase 128 legacy migration evidence.

---

### archive_status_field

**Behaviors affected**
- IA-07: Archive document → get_document reflects status='archived'

**Description**: The behavior IA-07 requires that calling `get_document` on an archived document returns a response that includes `status='archived'` (or equivalent indication that the status field has transitioned). The test calls `get_document` after archiving and asserts only that the body content is still present (`expect_contains: "This is a draft that will be archived"`). No step checks for the string "archived" or any status field in the response. The two assertions are nearly identical and both check content only. A server that archived the document but returned an incorrect status field (or no status field) would pass this test.

**How to Remedy**: Add an assertion step after the archive action that calls `get_document` and includes `expect_contains: "archived"` (or `expect_contains: "status: archived"` if the response format uses that form). This directly verifies that the status field is correctly reflected in the retrieval response.

**Resolution (2026-04-29, updated 2026-05-02)**: Added a frontmatter-retrieval assert step (Step 5) that checks `expect_contains: "archived"`. Originally used the now-removed outline tool; migrated in Phase 108 to `op: get_document` with `args: { identifiers, include: ["frontmatter"] }` — the consolidated `get_document` tool returns frontmatter when `include: ["frontmatter"]` is specified. `expect_contains: "archived"` is preserved unchanged. All 5 steps pass.

---

### archive_removes_from_search

**Behaviors affected**
- IX-02: Archived document → only memory found in search_all after archive (Phase 128 legacy migration evidence)

**Description**: The behavior IX-02 states that after archiving a document, a memory on the same topic is still findable in `search_all`. The test confirms the memory is findable via `list_memories` (by tag), but it does not verify the memory appears in `search_all`. The post-archive `search_all` steps only check that the document is absent — no step calls `search_all` and asserts the memory content is present in that result. Without embeddings, memories do not appear in `search_all` at all, so the "only memory found in search_all" part of IX-02 cannot be verified in a non-embedding configuration. Phase 128 legacy migration evidence.

**How to Remedy**: Add `deps: [embeddings]` and add a post-archive step that calls `search_all` with a query matching the memory content and asserts `expect_contains: "Sunsets over the ocean"`. Alternatively, note in the behavior description that IX-02 can only be fully tested with embeddings and mark the coverage as partial until an embedding-gated test exists. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Used the split approach. Removed IX-02 from `archive_removes_from_search.yml` coverage (keeping IA-01, IA-02, IA-03) since adding `deps: [embeddings]` to that test would gate three non-embedding behaviors behind the embedding provider. Created a new embedding-gated test `archive_doc_memory_in_searchall.yml` with `coverage: [IX-02]` and `deps: [embeddings]`. The new test archives a document then asserts the memory on the same topic still appears in `search_all` with `entity_types: [memories]`. Updated the IX-02 matrix row to point to the new test. All 6 steps pass. legacy migration evidence

---

### get_document_metadata

**Behaviors affected**
- IX-07: Get document returns all metadata fields (title, tags, status, fqc_id, path)

**Description**: The behavior IX-07 requires that `get_document` returns all named metadata fields: title, tags, status, fqc_id, and path. The test calls `get_document` and asserts only on body content (`expect_contains: "Key concepts for understanding the system"`). No step asserts that "Core Concepts" (the title), "gdm-tag" (a tag), "active" or "archived" (status), the fqc_id value, or the document path appear in the response. A server that returned body content but omitted all metadata fields would pass this test.

**How to Remedy**: Add assertions to the `get_document` steps that check for the presence of each required metadata field. For example: `expect_contains: "Core Concepts"` (title), `expect_contains: "gdm-tag"` (tag), `expect_contains: "active"` (status), and `expect_path_contains: "knowledge/concepts.md"` (path). For fqc_id, assert that a UUID-like string matching `${meta_doc.fq_id}` appears in the response (or assert `expect_contains: "FQC ID:"` as a field label check).

**Resolution (2026-04-29, updated 2026-05-02)**: Rewrote the test to verify all 5 named metadata fields. Originally used four frontmatter-outline assert steps (since `get_document` returned only body content at the time); migrated in Phase 108 to `op: get_document` with `args: { identifiers, include: ["frontmatter"] }` — the consolidated tool now returns frontmatter when `include: ["frontmatter"]` is specified. A `search_documents` step verifies the path appears in results (`expect_path_contains: "knowledge/concepts.md"`) alongside the title. A final `get_document` step confirms body content. All `expect_contains` strings (Core Concepts, fq_status, fq_id, gdm-tag) preserved unchanged. All 7 steps pass. Phase 128 legacy migration evidence.

---

### append_then_search

**Behaviors affected**
- IC-01: Append content to document → appended content appears in search_documents (Phase 128 legacy migration evidence)

**Description**: The behavior IC-01 states that after appending content, the appended text "appears in search_documents". The test verifies that appended content is readable via `get_document` (which is correct), and that the document is still findable by title via `search_all`. However, no step calls `search_documents` to verify the appended content is indexed and accessible through that specific tool. A server where `search_documents` failed to reflect appended content but `get_document` still worked would pass this test. Phase 128 legacy migration evidence.

**How to Remedy**: Add a step that calls `search_documents` with a query matching the appended content (e.g., `query: "bioluminescence patterns"`) and asserts `expect_contains: "Coastal Survey Field Notes"`. Note: body-content queries in `search_documents` require embeddings — if that is the case, add `deps: [embeddings]`. Alternatively, if the intent is title-based `search_documents`, use the document title as the query. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Added a `search_documents` assert step (Step 8) that queries by the document title "Coastal Survey Field Notes" and asserts `expect_contains: "Coastal Survey Field Notes"`. This directly exercises the `search_documents` API path required by IC-01. Title-based query is used (no embeddings required) since the primary gap was the complete absence of any `search_documents` call, not specifically content-based indexing. All 8 steps pass.

---

### update_document_then_search

**Behaviors affected**
- IC-02: Update document body → updated content appears in search_documents (Phase 128 legacy migration evidence)

**Description**: The behavior IC-02 states that after updating a document body, the updated content "appears in search_documents". The test verifies the new title is findable via `search_all` and the new body content is readable via `get_document`. No step calls `search_documents` directly. A server where `search_documents` failed to reflect the updated content while `search_all` and `get_document` worked normally would pass this test. Phase 128 legacy migration evidence.

**How to Remedy**: Add a step that calls `search_documents` with the updated title as the query (`query: "Expedition Notes Final"`) and asserts `expect_contains: "expedition-notes.md"`. This directly verifies that the update is reflected in `search_documents`. For body-content search via `search_documents`, `deps: [embeddings]` would be required. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Added a `search_documents` assert step (Step 7) that queries by the updated document title "Expedition Notes Final" and asserts `expect_contains: "expedition-notes.md"`. Title-based query is used since `search_documents` substring-matches on title and path in its non-embedding fallback path. This directly verifies that `update_document` changes are reflected in the `search_documents` API surface. All 7 steps pass. Phase 128 legacy migration evidence.

---

### append_and_search

**Behaviors affected**
- IC-04: Append to document → search reflects appended text immediately after append

**Description**: The behavior IC-04 and the test description both state that appended content is immediately available "without requiring a separate scan or index step." However, the test includes a `scan_vault` action step between the append and the first assertion. This directly contradicts the "immediately" and "without requiring a separate scan" claim. The test also uses `get_document` to verify the appended content rather than any search tool, so it does not verify the "search reflects appended text" part of the behavior. Additionally, the final step has duplicate `expect_contains` YAML keys — only the second one (`"New event: User logged in from 192.168.1.100"`) is actually evaluated by PyYAML.

**How to Remedy**: Remove the `scan_vault` step and place assertions immediately after the `append_to_doc` action to test the "immediately available" claim. Add a step that calls `search_all` or `search_documents` with a query matching the appended text and asserts the document is found — this tests the "search reflects appended text" part. Fix the duplicate `expect_contains` keys in the final step by splitting into two assertion steps or using a single combined assertion. Phase 128 legacy migration evidence.

**Resolution (2026-04-29)**: Fixed three issues. (1) Removed the `scan_vault` step — its presence between the append and the first assertion directly contradicted the IC-04 "immediately available without a separate scan" claim. (2) Added a `search_documents` step immediately after the `append_to_doc` action (Step 4) verifying the document is still discoverable by title with no scan in between. (3) Fixed the duplicate `expect_contains` YAML keys in the original final step by splitting into two separate assertion steps — one for the original content and one for the appended content. All 8 steps pass. legacy migration evidence

---

### sanitized_directory_usable

**Behaviors affected**
- IF-09: `create_directory` with a name requiring sanitization → `list_vault` shows the sanitized name → `create_document` in it succeeds

**Status**: Known flake under full-suite runs. Investigated 2026-05-13.

**Symptom**: In a managed run of all 91 broader integration tests on macOS, step 1 (`manage_directory create`) returned `path: "_integration/if09/my:project*docs"` (unsanitized) with `status: "created"`, and step 2's `list_vault` confirmed the directory on disk had the unsanitized name. Same test on the same machine, with the same dist build, with the same input: passes in isolation, passes when paired with its immediate predecessor (`ir01_plugin_mixed_reconciliation`), and fails only inside the full 91-test suite.

**Why this is *not* an OS or code-path issue**: The sanitizer regex at [src/mcp/utils/path-validation.ts:156-182](../../../src/mcp/utils/path-validation.ts#L156) correctly replaces `:` and `*` with space on macOS — verified by running the dist-built regex standalone on the same machine (`'my:project*docs'` → `'my project docs'`). The `manage_directory` handler at [src/mcp/tools/files.ts:104-124](../../../src/mcp/tools/files.ts#L104) unconditionally calls `sanitizeDirectorySegment` for each segment, with no platform branching. The dist build is fresh and contains the sanitizer.

**Leading hypothesis**: Cumulative Supabase residue from a cleanup-script timeout. `tests/scenarios/dbtools/clean_test_tables.py` runs in ~30.5s against the hosted pooler — just past the runner's previous 30s subprocess budget — so the runner SIGKILL'd it on every test and printed `Warning: exception during table cleanup`. Across 91 tests, the cumulative DB residue is the most plausible cross-test contaminant (each managed test already gets its own fresh process and temp vault). On a Linux machine where Python startup or pooler latency is lower, the cleanup likely completes inside the budget and residue never accumulates — which explains why the same test passes there.

**Mitigation applied (commit `4cd6816`)**: Raised the subprocess timeout in [run_integration.py:225](run_integration.py#L225) from 30s to 60s so the cleanup script can complete cleanly across the full suite. Full 91-test rerun pending verification.

**If you see this fail again**: First rerun the test in isolation (`python3 tests/scenarios/integration/run_integration.py --managed sanitized_directory_usable`). If it passes in isolation but fails in the full suite, you are looking at the same flake — do not start re-investigating the sanitizer logic or hunting OS-specific behavior. Check whether the `clean_test_tables.py` timeout warning is firing in the run log first.

---

## Codebase Audit Remaining Remediation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| IS-16 | `get_llm_usage` by-purpose workflow remains stable after Phase 152 query typing cleanup. | llm_by_purpose_mode          | 2026-05-25   | 2026-05-25   |
| IS-17 | `get_llm_usage` by-model workflow remains stable after Phase 152 grouping cleanup. | llm_by_model_mode            | 2026-05-25   | 2026-05-25   |
| IS-18 | `write_record -> search_records` workflow remains stable after Phase 152 records timing instrumentation. | plugin_record_consolidation | 2026-05-25 | 2026-05-25 |
| IS-19 | T-Y-004 / REQ-009: `write_document -> search_documents` workflow remains stable after documents decomposition. | write_then_search | 2026-05-25 | 2026-05-25 |
| IS-20 | T-Y-005 / REQ-009: archive status workflow remains stable after documents decomposition. | archive_status_field | 2026-05-25 | 2026-05-25 |
| IS-21 | T-Y-006 / REQ-009: `get_document` by `fq_id` remains stable after documents decomposition. | document_retrieval_by_id | 2026-05-25 | 2026-05-25 |

---

## How to update this file

When a test passes for the first time, update its row:
- **Covered By**: the YAML test filename (without `.yaml`)
- **Date Updated**: `YYYY-MM-DD`
- **Last Passing**: `YYYY-MM-DD` (update on each successful run)

When adding a new integration test, add its coverage IDs here first,
then reference them in the YAML test's `coverage:` field.
