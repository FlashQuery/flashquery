# FlashQuery Scenario Test Coverage Matrix

This document defines every behavioral coverage point we want to verify through scenario testing. Each row is a discrete, testable behavior. The **Covered By** column tracks which test scenario(s) exercise that behavior. The **Date Updated** column records when the behavior entry was added or last modified. The **Last Passing** column records the date the behavior was last verified as passing in a suite run.

**How to use this document:**
- Before writing a new test, check which uncovered behaviors it could hit.
- After writing a test, update the Covered By column.
- After a passing suite run, update the Last Passing date for all covered behaviors.
- When adding a new behavior row or modifying an existing one, update the Date Updated column.
- A behavior is "covered" when at least one test explicitly verifies it (not just exercises it incidentally).

---

## 1. Document Lifecycle

Core CRUD operations on vault documents via MCP.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| D-01 | Create document with title, content, path, and tags | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-02 | Created document is assigned a unique fqc_id | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-03 | Created document has status=active | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-04 | Created document is readable on disk with correct frontmatter | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-05 | Get document by fqc_id returns body content | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-06 | Get document by vault-relative path | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| D-07 | Get document by filename (no directory) | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| D-08 | Update document body (full replacement) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-09 | Update document title only (body preserved) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-10 | Update document tags only (body and title preserved) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-11 | Update document custom frontmatter (reserved fields protected) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-12 | Archive document sets status=archived | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| D-13 | Archived document excluded from search_documents | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| D-14 | Copy document creates new fqc_id, preserves content | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-15 | Copy document leaves original unchanged | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-16 | Move document updates path in database | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-17 | Move document creates intermediate directories | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-18 | Move document preserves fqc_id and all associations | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-19 | Create document with custom frontmatter fields | test_document_defaults | 2026-04-14 | 2026-04-16 |
| D-20 | Create document without explicit path (defaults to vault root) | test_document_defaults | 2026-04-14 | 2026-04-16 |
| D-21 | Reserved frontmatter fields cannot be overridden via create | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-22 | Reserved frontmatter fields cannot be overridden via update | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-23 | get_document returns clear error when file manually deleted from vault (DB row present, no scan run) | test_document_manual_delete_stale_reads | 2026-04-14 | 2026-04-16 |
| D-24 | search_documents does not surface stale hits for manually-deleted files before reconcile (or marks them clearly) | test_document_manual_delete_stale_reads | 2026-04-14 | 2026-04-16 |
| D-25 | User-defined custom frontmatter fields survive update_document (updating title, body, or tags leaves unmentioned custom fields intact) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| D-26 | User-defined custom frontmatter fields survive archive_document (archiving only changes status; all other fields preserved) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |

## 2. Document Content Operations

Surgical editing tools for modifying document content at specific locations.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| C-01 | Append content to end of document | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-02 | Insert content at top of document body | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-03 | Insert content after a specific heading | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-04 | Insert content before a specific heading | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-05 | Insert content at end of a section | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-06 | Replace section content (preserves heading line) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-07 | Replace section with include_subheadings=true (replaces nested) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-08 | Replace section with include_subheadings=false (preserves nested) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-09 | Insert at heading with occurrence > 1 (duplicate headings) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-10 | Update frontmatter header only (body untouched) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-11 | Update frontmatter with null value removes field | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-12 | Insert doc link (wiki-style) into frontmatter links array | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-13 | Insert doc link deduplicates (same link twice = one entry) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-14 | Insert doc link with custom property name | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-15 | Get document with sections filter returns only requested sections | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-16 | Get document sections with include_subheadings=true | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-17 | Get document sections with include_subheadings=false | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-18 | User-defined custom frontmatter fields survive content-editing operations (append_to_doc, insert_in_doc, replace_doc_section leave unmentioned custom fields intact) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| C-19 | update_doc_header can explicitly modify user-defined frontmatter fields when named in the update map (MCP-directed override is permitted) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| C-20 | update_doc_header targeting only FQC-managed fields (e.g. title) does not modify user-defined custom frontmatter fields | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |

## 3. Document Outline and Structure

Verifying structural introspection of documents.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| O-01 | Get outline of single document returns heading hierarchy | test_document_outline | 2026-04-14 | 2026-04-16 |
| O-02 | Get outline respects max_depth parameter | test_document_outline | 2026-04-14 | 2026-04-16 |
| O-03 | Get outline shows linked files (resolved) | test_document_outline | 2026-04-14 | 2026-04-16 |
| O-04 | Get outline shows unresolved links marked as such | test_document_outline | 2026-04-14 | 2026-04-16 |
| O-05 | Get outline with exclude_headings returns frontmatter only | test_document_outline | 2026-04-14 | 2026-04-16 |
| O-06 | Batch outline (array of identifiers) returns DB metadata | test_document_outline | 2026-04-14 | 2026-04-16 |

## 4. Search — Documents

All modes and filtering combinations for document search.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| S-01 | Filesystem search by title/query matches document | test_search_after_create | 2026-04-13 | 2026-04-16 |
| S-02 | Filesystem search by tags (any) returns matching documents | test_search_after_create | 2026-04-13 | 2026-04-16 |
| S-03 | Filesystem search by tags (all) requires every tag present | test_search_tags_and_limits | 2026-04-14 | 2026-04-16 |
| S-04 | Filesystem search returns no results for non-matching query | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| S-05 | Filesystem search excludes archived documents | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| S-06 | Filesystem search respects limit parameter | test_search_tags_and_limits | 2026-04-14 | 2026-04-16 |
| S-07 | Semantic search returns results (requires embedding provider) | test_search_modes | 2026-04-14 | 2026-04-16 |
| S-08 | Mixed mode search combines filesystem and semantic results | test_search_modes | 2026-04-14 | 2026-04-16 |
| S-09 | Search graceful degradation when embeddings disabled | test_search_modes | 2026-04-14 | 2026-04-16 |

## 5. Search — Cross-type (search_all)

Unified search across documents and memories.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SA-01 | search_all finds documents by query | test_search_all_cross_type | 2026-04-16 | 2026-04-16 |
| SA-02 | search_all finds memories by query | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-03 | search_all with entity_types filter restricts results | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-04 | search_all with tag filtering | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-05 | search_all falls back to filesystem when embeddings disabled | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |

## 6. Memory Lifecycle

Core CRUD operations on memories.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| M-01 | Save memory with content and tags | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-02 | Search memory by query returns saved memory | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-03 | Search memory by tags (any) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-04 | Search memory by tags (all) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-05 | Search memory with threshold parameter filters low-similarity | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-06 | Update memory creates new version (preserves history) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-07 | Update memory without tags preserves existing tags | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-08 | Get memory by single ID returns full content | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-09 | Get memory batch (multiple IDs) returns all | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-10 | List memories by tags returns recent, truncated to 200 chars | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-11 | List memories respects limit parameter | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-12 | Archive memory sets status=archived | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-13 | Archived memory excluded from search_memory | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-14 | Archive memory manages status tags automatically | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-15 | Save memory with plugin_scope (fuzzy matched) | test_memory_plugin_scope | 2026-04-14 | 2026-04-16 |

## 7. Plugin Lifecycle

Registration, record CRUD, and teardown of plugin schemas.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| P-01 | Register plugin from YAML schema | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-02 | Register plugin creates tables in database | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-03 | Get plugin info returns schema, tables, version | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-04 | Create record in plugin table | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-05 | Get record by ID returns all fields | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-06 | Update record changes only specified fields | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-07 | Archive record sets status=archived | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-08 | Search records (text mode) finds by field content | test_plugin_search | 2026-04-14 | 2026-04-16 |
| P-09 | Search records with filters (AND logic) | test_plugin_search | 2026-04-14 | 2026-04-16 |
| P-10 | Archived record excluded from search_records | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-11 | Unregister plugin dry run shows impact without changes | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-12 | Unregister plugin confirmed drops tables, clears data, and removes all `fqc_pending_plugin_review` rows for the plugin | test_plugin_registration | 2026-04-21 | 2026-04-16 |
| P-13 | Register plugin with schema migration (add column) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-14 | Register plugin rejects unsafe migration (remove column) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-15 | Plugin instance isolation (same plugin, different instances) | test_plugin_registration | 2026-04-14 | 2026-04-16 |

## 8. Tag Operations

Batch tag operations across entity types.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| T-01 | apply_tags adds tags to a document | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-02 | apply_tags removes tags from a document | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-03 | apply_tags add is idempotent (adding existing tag is no-op) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-04 | apply_tags remove is graceful (removing absent tag is no-op) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-05 | apply_tags works on memory (memory_id parameter) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-06 | apply_tags batch (multiple identifiers) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-07 | Tag normalization (whitespace, case) | test_tag_operations | 2026-04-14 | 2026-04-16 |

## 9. File System Operations

Vault scanning, file listing, and directory management.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| F-01 | force_file_scan (sync) indexes new files | test_search_after_create | 2026-04-13 | 2026-04-16 |
| F-02 | force_file_scan (background) returns immediately | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-03 | force_file_scan detects updated files | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-04 | force_file_scan detects deleted files | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-05 | reconcile_documents dry run reports without changes | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-06 | reconcile_documents detects moved files via fqc_id | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-07 | reconcile_documents archives permanently gone files | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-08 | list_files returns entries for a directory | test_list_files | 2026-04-14 | 2026-04-16 |
| F-09 | list_files recursive mode | test_list_files | 2026-04-14 | 2026-04-16 |
| F-10 | list_files with extension filter | test_list_files | 2026-04-14 | 2026-04-16 |
| F-11 | list_files with date range filter | test_list_files | 2026-04-14 | 2026-04-16 |
| F-12 | remove_directory succeeds on empty directory | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-13 | remove_directory fails on non-empty directory | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-14 | remove_directory prevents vault root removal | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-15 | Path traversal protection (escape attempt blocked) | test_directory_operations | 2026-04-14 | 2026-04-16 |
| ~~F-16~~ | ~~discover_document in flagged mode~~ | ~~test_discover_document~~ | 2026-04-21 | 2026-04-16 |
| ~~F-17~~ | ~~discover_document in paths mode~~ | ~~test_discover_document~~ | 2026-04-21 | 2026-04-16 |
| F-18 | force_file_scan preserves user-defined frontmatter fields in newly discovered documents (scan merges FQC identity fields into existing frontmatter rather than replacing it) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |

## 10. Briefing and Aggregation

Cross-entity summary tools.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| B-01 | get_briefing returns documents and memories grouped by type | test_briefing | 2026-04-14 | 2026-04-16 |
| B-02 | get_briefing with tag filtering | test_briefing | 2026-04-14 | 2026-04-16 |
| B-03 | get_briefing with plugin_id includes plugin record counts | test_briefing | 2026-04-14 | 2026-04-16 |

## 11. Scale and Correctness

Behaviors verifying that FlashQuery maintains correctness when operating at scale with heavy, continuous operation interleaving. Document-scale tests exercise vault operations (300+ files) with deterministically sequenced operations from both MCP and external sources. Memory-scale tests verify correctness for Supabase-backed semantic memory (1000+ records) under rapid concurrent operations.

### Document Scale Behaviors

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SC-01 | Large vault mixed-operation correctness (300+ files with interleaved creates, updates, archives from MCP and external sources) | test_large_vault_scale | 2026-04-15 | 2026-04-16 |
| SC-02 | Large vault search correctness (search indexes remain consistent through constant create/update/archive operations with 300+ files) | test_large_vault_scale | 2026-04-15 | 2026-04-16 |

### Memory Scale Behaviors

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SC-03 | Large memory collection mixed operations (1000+ memories with rapid save/update/archive/version → updates apply correctly, versions preserved) | test_large_memory_scale | 2026-04-15 | 2026-04-16 |
| SC-04 | Memory batch tagging at scale (1000+ tag operations → tags applied consistently and searchable) | — | 2026-04-15 | |
| SC-05 | Memory semantic search correctness at scale (1000+ memories with concurrent save/update → results consistent, vector indices stable) | — | 2026-04-15 | |
| SC-06 | Memory threshold filtering under load (1000+ memories with concurrent writes → similarity threshold filtering accurate) | — | 2026-04-15 | |
| SC-07 | Memory version history accumulation (100+ versions of same memory → history traversable, no truncation or loss) | test_memory_version_history | 2026-04-16 | 2026-04-16 |
| SC-08 | Plugin-scoped memory isolation at scale (1000+ memories across multiple scopes → each scope returns only its own, no cross-scope leakage) | — | 2026-04-15 | |

## 12. Cross-cutting Behaviors

Behaviors that span multiple tools and represent system-level guarantees.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| X-01 | Identifier resolution: fqc_id (UUID) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-02 | Identifier resolution: vault-relative path | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| X-03 | Identifier resolution: filename only | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| X-04 | Write lock contention returns error with guidance | test_write_lock_contention | 2026-04-14 | 2026-04-16 |
| X-05 | Batch identifiers (array input where supported) | test_cross_cutting_edge_cases | 2026-04-14 | 2026-04-16 |
| X-06 | Frontmatter round-trip: create → read → verify all fields | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-07 | Tags survive full CRUD cycle (create → update → verify) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-08 | fqc_id is stable across updates | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-09 | Empty search results return "No documents found." | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| X-10 | Graceful embedding fallback across all search tools | test_search_modes | 2026-04-14 | 2026-04-16 |
| X-11 | Fire-and-forget embedding does not block tool response | test_cross_cutting_edge_cases | 2026-04-14 | 2026-04-16 |

## 13. Git Behaviors

Behaviors verifying that FlashQuery auto-commits to the vault's git repository when documents change on disk. Exercising these requires the managed test server to be started with `enable_git=True`, which initializes the vault as a git repo and flips `git.auto_commit` on in the generated flashquery.yml.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| G-01 | Auto-commit on document create | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |
| G-02 | Auto-commit on document update (content change) | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |
| G-03 | Auto-commit on document archive/remove | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |

## 14. Plugin Reconciliation

Behaviors verifying the reconcile-on-read engine: how record tool calls trigger reconciliation, how the six reconciliation states are classified and handled, and how declarative policies govern mechanical actions on auto-track, movement, modification, and pending review.

### 14.1 Core Reconciliation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-01 | Record tool call triggers reconciliation before executing the requested operation | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-02 | Reconciliation classifies every document into exactly one of six categories (added/resurrected/deleted/disassociated/moved/modified) plus an unchanged count | test_reconciliation_six_categories | 2026-04-21 | 2026-04-21 |
| RO-03 | Reconciliation is idempotent (re-run with no changes produces all unchanged, zero in other categories) | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-04 | New file in watched folder with no plugin row (active or archived) is classified as `added` | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-05 | Staleness check skips reconciliation diff when run within 30s threshold; pending review query still runs | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |
| RO-61 | `force_file_scan` invalidates the reconciliation staleness cache, ensuring the next record tool call performs a full diff | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |

### 14.2 Auto-Track

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-06 | `on_added: auto-track` creates a plugin table row with columns populated from `field_map` | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-07 | `on_added: auto-track` writes `fqc_owner` and `fqc_type` into the document's frontmatter on disk | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-08 | `on_added: auto-track` with a declared `template` inserts a `fqc_pending_plugin_review` row | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |
| RO-09 | `on_added: auto-track` does NOT modify the document's body content (only frontmatter is changed) | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-10 | `on_added: auto-track` without a `template` does NOT create a pending review row | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |

### 14.3 Ignore Policy

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-11 | `on_added: ignore` takes no action — no plugin row created, no frontmatter modified, no mention in tool response | test_reconciliation_ignore_policy | 2026-04-21 | 2026-04-21 |
| RO-12 | Missing policy fields use conservative defaults: `on_added: ignore`, `on_moved: keep-tracking`, `on_modified: ignore` | test_reconciliation_ignore_policy | 2026-04-21 | 2026-04-21 |

### 14.4 Deletion and Archival

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-13 | Document with `fqc_documents` status `missing` is classified as `deleted`; plugin row is archived | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |
| RO-14 | Document with `fqc_documents` status `archived` (MCP-archived) is also classified as `deleted`; plugin row is archived | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |
| RO-15 | Archiving a plugin row (due to deleted/disassociated/moved+untrack) does not delete the vault file | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |

### 14.5 Disassociation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-16 | Removing `fqc_owner`/`fqc_type` from frontmatter triggers `disassociated`; plugin row is archived | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |
| RO-17 | Moving a file with frontmatter intact does NOT trigger `disassociated` (reports `moved` instead) | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |
| RO-18 | Disassociated document remains `status: active` in `fqc_documents`; only the plugin row is archived | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |

### 14.6 Resurrection

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-19 | Missing-then-reappearing document un-archives the existing plugin row (`resurrected`), does not create a new row | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |
| RO-20 | Resurrection is determined solely by `fqc_id` match — document's current path and folder are irrelevant | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |
| RO-22 | Template is NOT surfaced on resurrection; `field_map` IS re-applied from current frontmatter | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |

### 14.7 Movement

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-24 | `on_moved: keep-tracking` updates stored path silently; plugin row stays active | — | 2026-04-21 | |
| RO-25 | `on_moved: untrack` archives the plugin row; vault file frontmatter (`fqc_owner`/`fqc_type`) is preserved | — | 2026-04-21 | |
| RO-26 | `on_moved` defaults to `keep-tracking` when not declared | — | 2026-04-21 | |
| RO-27 | After `keep-tracking` path update, subsequent reconciliation reports the document as `unchanged` | — | 2026-04-21 | |

### 14.8 Modification and Field Sync

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-28 | `on_modified: sync-fields` re-applies `field_map` from current frontmatter and updates `last_seen_updated_at` | — | 2026-04-21 | |
| RO-29 | `on_modified: ignore` takes no action (no field sync) | — | 2026-04-21 | |
| RO-30 | `on_modified: ignore` still updates `last_seen_updated_at` (preventing re-evaluation on every subsequent pass) | — | 2026-04-21 | |
| RO-59 | `field_map` sets NULL for frontmatter fields not present in the document | — | 2026-04-21 | |

### 14.9 Frontmatter-Based Discovery

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-31 | Document with `fqc_type` in frontmatter is discovered as `added` even outside watched folders (global type registry Path 2) | — | 2026-04-21 | |
| RO-32 | Scanner syncs `fqc_owner`/`fqc_type` frontmatter fields to `ownership_plugin_id`/`ownership_type` columns on every pass; removing them from frontmatter sets columns to NULL on next scan | — | 2026-04-21 | |

### 14.10 Policy Validation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-35 | `on_added: auto-track` without `track_as` causes `register_plugin` to reject or warn | — | 2026-04-21 | |
| RO-36 | All policy field validation (value ranges, required companions like `track_as`) happens at `register_plugin` time, not at reconciliation time | — | 2026-04-21 | |
| RO-60 | `access: read-only` emits a warning in the tool response when a tool call attempts to write to a document in that folder | — | 2026-04-21 | |

### 14.11 Pending Plugin Review

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-38 | `clear_pending_reviews` with empty `fqc_ids` returns current pending list without deleting; with non-empty `fqc_ids` clears those items and returns remainder | — | 2026-04-21 | |
| RO-39 | `clear_pending_reviews` is idempotent (clearing already-cleared `fqc_ids` is a no-op) | — | 2026-04-21 | |
| RO-40 | Pending review rows cascade-delete when the referenced `fqc_documents` row is deleted | — | 2026-04-21 | |
| RO-41 | `unregister_plugin` clears all `fqc_pending_plugin_review` rows for the plugin | — | 2026-04-21 | |

### 14.12 Bulk and Multi-Table

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-52 | Tool response summarizes bulk reconciliation by count (not enumeration) when items per category exceed threshold | — | 2026-04-21 | |
| RO-54 | Auto-track frontmatter writes do not cause spurious `modified` flags on the next reconciliation pass | — | 2026-04-21 | |
| RO-56 | Reconciliation scans all document-backed tables for a plugin in a single pass (not just the table implied by the current tool call) | — | 2026-04-21 | |
| RO-58 | Auto-track routes the new plugin row to the correct table based on `track_as` for the matched folder | — | 2026-04-21 | |

---

## Coverage Summary

| Category | Total | Covered | Uncovered |
|----------|-------|---------|-----------|
| Document Lifecycle | 26 | 26 | 0 |
| Document Content Operations | 20 | 20 | 0 |
| Document Outline | 6 | 6 | 0 |
| Search — Documents | 9 | 9 | 0 |
| Search — Cross-type | 5 | 5 | 0 |
| Memory Lifecycle | 15 | 15 | 0 |
| Plugin Lifecycle | 15 | 15 | 0 |
| Tag Operations | 7 | 7 | 0 |
| File System Operations | 16 | 16 | 0 |
| Briefing | 3 | 3 | 0 |
| Scale and Correctness | 8 | 4 | 4 |
| Cross-cutting | 11 | 11 | 0 |
| Git Behaviors | 3 | 3 | 0 |
| Plugin Reconciliation | 43 | 22 | 21 |
| **Total** | **187** | **162** | **25** |

---

## Existing Test → Coverage Mapping

### test_search_after_create
Covers: S-01, S-02, F-01

### test_create_read_update
Covers: D-01, D-02, D-03, D-04, D-05, D-08, X-01, X-06, X-07, X-08

### test_document_archive_and_search
Covers: D-12, D-13, S-04, S-05, X-09

### test_memory_lifecycle
Covers: M-01, M-02, M-06, M-07, M-08, M-10, M-12, M-13, M-14

### test_plugin_lifecycle
Covers: P-01, P-02, P-03, P-04, P-05, P-06, P-07, P-10

### test_tag_operations
Covers: T-01, T-02, T-03, T-04, T-05, T-06, T-07

### test_memory_search_and_list
Covers: M-03, M-04, M-05, M-09, M-11

### test_document_manual_delete_stale_reads
Covers: D-23, D-24

### test_document_update_partial
Covers: D-09, D-10, D-11, D-21, D-22

### test_content_append_and_insert
Covers: C-01, C-02, C-03, C-04, C-05

### test_content_replace_section
Covers: C-06, C-07, C-08, C-09

### test_content_frontmatter_ops
Covers: C-10, C-11, C-12, C-13, C-14

### test_document_outline
Covers: O-01, O-02, O-03, O-04, O-05, O-06

### test_plugin_registration
Covers: P-11, P-12, P-13, P-14, P-15

### test_directory_operations
Covers: F-12, F-13, F-14, F-15

### test_list_files
Covers: F-08, F-09, F-10, F-11

### test_search_modes
Covers: S-07, S-08, S-09, X-10

### test_search_all_cross_type
Covers: SA-01, SA-02, SA-03, SA-04, SA-05

### test_document_identifier_resolution
Covers: D-06, D-07, X-02, X-03

### test_document_copy_and_move
Covers: D-14, D-15, D-16, D-17, D-18

### test_document_defaults
Covers: D-19, D-20

### test_content_section_extraction
Covers: C-15, C-16, C-17

### test_briefing
Covers: B-01, B-02, B-03

### test_search_tags_and_limits
Covers: S-03, S-06

### test_plugin_search
Covers: P-08, P-09

### test_file_scan_lifecycle
Covers: F-02, F-03, F-04

### test_reconcile_documents
Covers: F-05, F-06, F-07

### test_discover_document
Covers: F-16, F-17

### test_memory_plugin_scope
Covers: M-15

### test_cross_cutting_edge_cases
Covers: X-05, X-11

### test_write_lock_contention
Covers: X-04

### test_auto_commit_on_writes
Covers: G-01, G-02, G-03

### test_large_vault_scale
Covers: SC-01, SC-02

### test_large_memory_scale
Covers: SC-03

### test_memory_version_history
Covers: SC-07

### test_frontmatter_preservation
Covers: D-25, D-26, C-18, C-19, C-20, F-18

### test_reconciliation_core
Covers: RO-01, RO-03, RO-04

### test_reconciliation_six_categories
Covers: RO-02

### test_reconciliation_auto_track
Covers: RO-06, RO-07, RO-09, RO-10

### test_reconciliation_staleness
Covers: RO-05, RO-08, RO-61

### test_reconciliation_ignore_policy
Covers: RO-11, RO-12

### test_reconciliation_deletion
Covers: RO-13, RO-14, RO-15

### test_reconciliation_disassociation
Covers: RO-16, RO-17, RO-18

### test_reconciliation_resurrection
Covers: RO-19, RO-20, RO-22
