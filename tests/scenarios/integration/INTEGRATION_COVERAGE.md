# Integration Test Coverage Matrix

Integration tests exercise multi-step workflows and cross-domain behaviors.
They complement the directed scenario tests (which verify individual tool behaviors)
by verifying that FlashQuery's features compose correctly end-to-end.

Coverage IDs use the prefix `INT-` to avoid collision with the directed test IDs in `../DIRECTED_COVERAGE.md`.

---

## IS — Search Coherence

Verifies that content written through one path is discoverable through the expected search paths.

| ID     | Behavior                                                             | Covered By                  | Date Updated | Last Passing |
|--------|----------------------------------------------------------------------|-----------------------------|--------------|--------------|
| IS-01  | Create document → appears in search_documents results                | write_then_search            | 2026-04-22   | 2026-04-22   |
| IS-02  | Create memory → appears in search_memories results                   | write_then_search            | 2026-04-22   | 2026-04-22   |
| IS-03  | Create document + memory → both appear in search_all results         | cross_domain_search          | 2026-04-22   | 2026-04-22   |
| IS-04  | search_all with entity_types=['documents'] returns only documents    | cross_domain_search          | 2026-04-22   | 2026-04-22   |
| IS-05  | search_all with entity_types=['memories'] returns only memories      | search_memories_only         | 2026-04-22   | 2026-04-22   |
| IS-06  | Tagged document appears in tag-filtered search_documents             | tag_filtered_documents       | 2026-04-22   | 2026-04-22   |
| IS-07  | Tagged memory appears in tag-filtered search_memories                | tag_filtered_memories        | 2026-04-22   | 2026-04-22   |
| IS-08  | Multi-tag filter returns only documents matching all specified tags  | multitag_filter              | 2026-04-22   | 2026-04-22   |

---

## IA — Archive and State Transitions

Verifies that archiving content removes it from active search results while leaving other
content unaffected.

| ID     | Behavior                                                              | Covered By                      | Date Updated | Last Passing |
|--------|-----------------------------------------------------------------------|---------------------------------|--------------|--------------|
| IA-01  | Archive document → absent from search_documents                       | archive_removes_from_search  | 2026-04-22   | 2026-04-22   |
| IA-02  | Archive document → memory with same topic still searchable            | archive_removes_from_search  | 2026-04-22   | 2026-04-22   |
| IA-03  | Archive document → absent from search_all results                     | archive_removes_from_search  | 2026-04-22   | 2026-04-22   |
| IA-04  | Archive memory → absent from search_memories                          | archive_memory               | 2026-04-22   | 2026-04-22   |
| IA-05  | Archive memory → document with same topic still searchable            | archive_memory               | 2026-04-22   | 2026-04-22   |
| IA-06  | Archive one of several tagged documents → others remain discoverable  | archive_partial_set          | 2026-04-22   | 2026-04-22   |
| IA-07  | Archive document → get_document reflects status='archived'             | archive_status_field         | 2026-04-22   | 2026-04-22   |
| IA-08  | Create and archive document in nested vault path → remains correctly archived and retrievable | archive_nested_path          | 2026-04-22   | 2026-04-22   |

---

## IX — Cross-Domain Interaction

Verifies behaviors that span more than one FlashQuery domain (documents, memories, tags, plugins).

| ID     | Behavior                                                                    | Covered By           | Date Updated | Last Passing |
|--------|-----------------------------------------------------------------------------|----------------------|--------------|--------------|
| IX-01  | Document and memory share a tag → search_all with that tag returns both     | cross_domain_search          | 2026-04-22   | 2026-04-22   |
| IX-02  | Archived document → only memory found in search_all after archive           | archive_removes_from_search  | 2026-04-22   | 2026-04-22   |
| IX-03  | Create via vault.write, update via update_document → search returns new content | update_document_then_search  | 2026-04-22   | 2026-04-22   |
| IX-04  | Create document, get_document by fqc_id → returns correct content           | document_retrieval_by_id     | 2026-04-22   | 2026-04-22   |
| IX-05  | Create document with tags, apply_tags to add more → all tags searchable     | apply_tags_composition       | 2026-04-22   | 2026-04-22   |
| IX-06  | Get document by vault-relative path → returns same content as fqc_id retrieval | get_document_by_path         | 2026-04-22   | 2026-04-22   |
| IX-07  | Get document returns all metadata fields (title, tags, status, fqc_id, path) | get_document_metadata        | 2026-04-22   | 2026-04-22   |
| IX-08  | Create multiple documents, update each, retrieve all → each returns updated state | concurrent_updates           | 2026-04-22   | 2026-04-22   |

---

## IC — Content Operations (Composed)

Verifies that content mutation tools (append, update, replace) produce results
discoverable through search after the mutation.

| ID     | Behavior                                                                         | Covered By | Date Updated | Last Passing |
|--------|----------------------------------------------------------------------------------|------------|--------------|--------------|
| IC-01  | Append content to document → appended content appears in search_documents        | append_then_search           | 2026-04-22   | 2026-04-22   |
| IC-02  | Update document body → updated content appears in search_documents               | update_document_then_search  | 2026-04-22   | 2026-04-22   |
| IC-03  | Replace section in document → replaced content appears, original absent          | replace_section              | 2026-04-22   | 2026-04-22   |
| IC-04  | Append to document → search reflects appended text immediately after append      | append_and_search            | 2026-04-22   | 2026-04-22   |

---

## IR — Plugin Reconciliation

Verifies that the reconcile-on-read engine and plugin policy system compose correctly across
multi-step workflows involving plugin tables, record tools, scan, and frontmatter.

| ID     | Behavior                                                                                             | Covered By | Date Updated | Last Passing |
|--------|------------------------------------------------------------------------------------------------------|------------|--------------|--------------|
| IR-01  | Mixed reconciliation: auto-track + ignore + deleted + moved all handled in single pass               | ir01_plugin_mixed_reconciliation | 2026-04-22   | 2026-04-22   |
| IR-02  | Full resurrection lifecycle: track → delete → restore → resurrect with FK references intact          | ir02_plugin_deletion_lifecycle | 2026-04-22   | 2026-04-22   |
| IR-03  | Auto-track + pending template review + clear → subsequent tool responses show no pending items       | ir03_plugin_autotrack_pending_clear | 2026-04-22   | 2026-04-22   |
| IR-04  | Document created via MCP in watched folder is immediately visible to same-call reconciliation        | ir04_plugin_mcp_immediate_reconciliation | 2026-04-22   | 2026-04-22   |
| IR-05  | Plugin with no declared policies ignores new docs, follows moved docs, ignores modifications         | ir05_plugin_no_policies_defaults | 2026-04-22   | 2026-04-22   |
| IR-06  | Document moved out with on_moved:untrack, then moved back → resurrects, not re-added                 | ir06_plugin_stop_tracking_lifecycle | 2026-04-22   | 2026-04-22   |
| IR-07  | Cross-plugin resurrection: original plugin resurrects; second plugin independently discovers as added | ir07_plugin_cross_plugin_discovery | 2026-04-22   | 2026-04-22   |
| IR-08  | Bulk auto-track: all new documents processed in single pass with no silent cap                       | ir08_plugin_bulk_autotrack   | 2026-04-22   | 2026-04-22   |
| IR-09  | Multiple state transitions between reconciliation runs: only current state classified                | ir09_plugin_state_transitions | 2026-04-22   | 2026-04-22   |
| IR-10  | Large pending review backlog processable incrementally — subset cleared per invocation, remainder stable | ir10_plugin_incremental_pending_review | 2026-04-22   | 2026-04-22   |
| IR-11  | Document moved between plugin-owned folders reports moved in source table, not added in destination  | ir11_plugin_cross_folder_move | 2026-04-22   | 2026-04-22   |
| IR-12  | Pending review items appear in record tool response even when reconciliation staleness check skips diff | ir12_plugin_pending_review_staleness | 2026-04-22   | 2026-04-22   |
| IR-13  | Frontmatter-based type discovery: document outside all watched folders picked up via fqc_type        | ir13_plugin_frontmatter_discovery | 2026-04-22   | 2026-04-22   |

---

## How to update this file

When a test passes for the first time, update its row:
- **Covered By**: the YAML test filename (without `.yaml`)
- **Date Updated**: `YYYY-MM-DD`
- **Last Passing**: `YYYY-MM-DD` (update on each successful run)

When adding a new integration test, add its coverage IDs here first,
then reference them in the YAML test's `coverage:` field.
