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
| D-01 | Create document with title, content, path, and tags (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-02 | Created document is assigned a unique fqc_id (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-03 | Created document has status=active (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-04 | Created document is readable on disk with correct frontmatter (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-05 | Get document by fqc_id returns body content (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-06 | Get document by vault-relative path (VALIDATED) | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| D-07 | Get document by filename (no directory) (VALIDATED) | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| D-08 | Update document body (full replacement) (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| D-09 | Update document title only (body preserved) (VALIDATED) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-10 | Update document tags only (body and title preserved) (VALIDATED) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-11 | Update document custom frontmatter (reserved fields protected) (VALIDATED) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-12 | Archive document sets status=archived (VALIDATED) | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| D-13 | Archived document excluded from search_documents (VALIDATED) | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| D-14 | Copy document creates new fqc_id, preserves content (VALIDATED) | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-15 | Copy document leaves original unchanged (VALIDATED) | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-16 | Move document updates path in database (VALIDATED) | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-17 | Move document creates intermediate directories (VALIDATED) | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-18 | Move document preserves fqc_id and all associations (VALIDATED) | test_document_copy_and_move | 2026-04-14 | 2026-04-16 |
| D-19 | Create document with custom frontmatter fields (VALIDATED) | test_document_defaults | 2026-04-14 | 2026-04-16 |
| D-20 | Create document without explicit path (defaults to vault root) (VALIDATED) | test_document_defaults | 2026-04-14 | 2026-04-16 |
| D-21 | Reserved frontmatter fields cannot be overridden via create (VALIDATED) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-22 | Reserved frontmatter fields cannot be overridden via update (VALIDATED) | test_document_update_partial | 2026-04-14 | 2026-04-16 |
| D-23 | get_document returns clear error when file manually deleted from vault (DB row present, no scan run) (VALIDATED) | test_document_manual_delete_stale_reads | 2026-04-14 | 2026-04-16 |
| D-24 | search_documents does not surface stale hits for manually-deleted files before reconcile (or marks them clearly) (VALIDATED) | test_document_manual_delete_stale_reads | 2026-04-14 | 2026-04-16 |
| D-25 | User-defined custom frontmatter fields survive update_document (updating title, body, or tags leaves unmentioned custom fields intact) (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| D-26 | User-defined custom frontmatter fields survive archive_document (archiving only changes status; all other fields preserved) (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| D-27 | get_document default response returns JSON envelope with body field (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-28 | get_document include=["frontmatter"] returns frontmatter projection in envelope (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-29 | get_document include=["headings"] returns headings array with level, text, char_offset (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-30 | get_document include=["body","frontmatter","headings"] returns all three fields in envelope (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-31 | get_document with sections returns extracted_sections array; body field absent (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-31a | get_document multi-section returns extracted_sections in document order, not request order (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-31b | get_document sections repeat-name shorthand ("Action Items#2") selects second occurrence (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-31c | get_document sections interleaved repeated headings each select their own occurrence independently (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-31d | get_document extracted_sections separator uses a blank line between adjacent sections (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-31e | get_document multi-section with one no_match and one insufficient_occurrences both appear in missing_sections (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |
| D-31f | get_document section_not_found error envelope includes available_headings list (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |
| D-32 | get_document sections matching is case-insensitive (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-33 | get_document sections with numeric start anchor ("3. Foo") selects correct section (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-33a | get_document sections numeric-anchor edge cases (numeric prefix longer/shorter than actual heading) (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-34 | get_document size.chars in metadata envelope equals full document body length (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-34a | get_document include_nested=False excludes subheadings from extracted section (VALIDATED) | test_consolidated_get_document_sections | 2026-05-01 | 2026-05-02 |
| D-35 | get_document with non-existent identifier returns document_not_found error envelope with isError=true (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |
| D-46 | get_document with sections + occurrence=N returns invalid_parameter_combination error (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |
| D-47 | get_document title fallback when fq_title missing — uses file basename (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-48 | get_document title coercion when fq_title is a number — returns string representation (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-49 | get_document title trim when fq_title has leading/trailing whitespace — returns trimmed string (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| D-50 | get_document title when frontmatter completely absent — returns file basename (deferred: requires raw vault write) | — | 2026-05-01 | — |

## 2. Document Content Operations

Surgical editing tools for modifying document content at specific locations.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| C-01 | Append content to end of document (VALIDATED) | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-02 | Insert content at top of document body (VALIDATED) | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-03 | Insert content after a specific heading (VALIDATED) | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-04 | Insert content before a specific heading (VALIDATED) | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-05 | Insert content at end of a section (VALIDATED) | test_content_append_and_insert | 2026-04-14 | 2026-04-16 |
| C-06 | Replace section content (preserves heading line) (VALIDATED) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-07 | Replace section with include_subheadings=true (replaces nested) (VALIDATED) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-08 | Replace section with include_subheadings=false (preserves nested) (VALIDATED) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-09 | Insert at heading with occurrence > 1 (duplicate headings) (VALIDATED) | test_content_replace_section | 2026-04-14 | 2026-04-16 |
| C-10 | Update frontmatter header only (body untouched) (VALIDATED) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-11 | Update frontmatter with null value removes field (VALIDATED) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-12 | Insert doc link (wiki-style) into frontmatter links array (VALIDATED) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-13 | Insert doc link deduplicates (same link twice = one entry) (VALIDATED) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-14 | Insert doc link with custom property name (VALIDATED) | test_content_frontmatter_ops | 2026-04-14 | 2026-04-16 |
| C-15 | Get document with sections filter returns only requested sections (VALIDATED) | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-16 | Get document sections with include_subheadings=true (VALIDATED) | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-17 | Get document sections with include_subheadings=false (VALIDATED) | test_content_section_extraction | 2026-04-14 | 2026-04-16 |
| C-18 | User-defined custom frontmatter fields survive content-editing operations (append_to_doc, insert_in_doc, replace_doc_section leave unmentioned custom fields intact) (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| C-19 | update_doc_header can explicitly modify user-defined frontmatter fields when named in the update map (MCP-directed override is permitted) (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |
| C-20 | update_doc_header targeting only FQC-managed fields (e.g. title) does not modify user-defined custom frontmatter fields (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |

## 3. Document Outline and Structure

Verifying structural introspection of documents.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| O-01 | Get outline of single document returns heading hierarchy (SUPERSEDED: get_doc_outline removed in Phase 107; heading extraction covered by D-29, O-07) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-16 |
| O-02 | Get outline respects max_depth parameter (SUPERSEDED: max_depth now covered by O-07 in consolidated get_document) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-16 |
| O-03 | Get outline shows linked files (resolved) (SUPERSEDED: link resolution not exposed in Phase 107 consolidated get_document) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-16 |
| O-04 | Get outline shows unresolved links marked as such (SUPERSEDED: same as O-03) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-16 |
| O-05 | Get outline with exclude_headings returns frontmatter only (SUPERSEDED: standalone frontmatter include covered by D-28) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-16 |
| O-06 | Batch outline (array of identifiers) returns DB metadata (SUPERSEDED: batch mode removed; single-doc envelope with all three includes covered by D-30) | test_document_outline [RETIRED] | 2026-05-01 | 2026-04-29 |
| O-07 | get_document headings include level, text, and char_offset fields; max_depth filters by heading level (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| O-08 | get_document headings includes all occurrences of duplicate heading names with distinct char_offset (VALIDATED) | test_consolidated_get_document | 2026-05-01 | 2026-05-02 |
| O-09 | error envelope available_headings lists all headings in the document (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |
| O-10 | occurrence parameter out of range (>= actual count) returns occurrence_out_of_range error (VALIDATED) | test_consolidated_get_document_errors | 2026-05-01 | 2026-05-02 |

## 4. Search — Documents

All modes and filtering combinations for document search.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| S-01 | Filesystem search by title/query matches document (VALIDATED) | test_search_after_create | 2026-04-13 | 2026-04-16 |
| S-02 | Filesystem search by tags (any) returns matching documents (VALIDATED) | test_search_after_create | 2026-04-13 | 2026-04-16 |
| S-03 | Filesystem search by tags (all) requires every tag present (VALIDATED) | test_search_tags_and_limits | 2026-04-14 | 2026-04-16 |
| S-04 | Filesystem search returns no results for non-matching query (VALIDATED) | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| S-05 | Filesystem search excludes archived documents (VALIDATED) | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| S-06 | Filesystem search respects limit parameter (VALIDATED) | test_search_tags_and_limits | 2026-04-14 | 2026-04-16 |
| S-07 | Semantic search returns results (requires embedding provider) (VALIDATED) | test_search_modes | 2026-04-14 | 2026-04-16 |
| S-08 | Mixed mode search combines filesystem and semantic results (VALIDATED) | test_search_modes | 2026-04-14 | 2026-04-16 |
| S-09 | Search graceful degradation when embeddings disabled (VALIDATED) | test_search_modes | 2026-04-14 | 2026-04-16 |

## 5. Search — Cross-type (search_all)

Unified search across documents and memories.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SA-01 | search_all finds documents by query (VALIDATED) | test_search_all_cross_type | 2026-04-16 | 2026-04-16 |
| SA-02 | search_all finds memories by query (VALIDATED) | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-03 | search_all with entity_types filter restricts results (VALIDATED) | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-04 | search_all with tag filtering (VALIDATED) | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |
| SA-05 | search_all falls back to filesystem when embeddings disabled (VALIDATED) | test_search_all_cross_type | 2026-04-14 | 2026-04-16 |

## 6. Memory Lifecycle

Core CRUD operations on memories.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| M-01 | Save memory with content and tags (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-02 | Search memory by query returns saved memory (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-03 | Search memory by tags (any) (VALIDATED) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-04 | Search memory by tags (all) (VALIDATED) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-05 | Search memory with threshold parameter filters low-similarity (VALIDATED) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-06 | Update memory creates new version (preserves history) (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-07 | Update memory without tags preserves existing tags (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-08 | Get memory by single ID returns full content (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-09 | Get memory batch (multiple IDs) returns all (VALIDATED) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-10 | List memories by tags returns recent, truncated to 200 chars (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-29 |
| M-11 | List memories respects limit parameter (VALIDATED) | test_memory_search_and_list | 2026-04-14 | 2026-04-16 |
| M-12 | Archive memory sets status=archived (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-13 | Archived memory excluded from search_memory (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-14 | Archive memory manages status tags automatically (VALIDATED) | test_memory_lifecycle | 2026-04-13 | 2026-04-16 |
| M-15 | Save memory with plugin_scope (fuzzy matched) (VALIDATED) | test_memory_plugin_scope | 2026-04-14 | 2026-04-29 |

## 7. Plugin Lifecycle

Registration, record CRUD, and teardown of plugin schemas.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| P-01 | Register plugin from YAML schema (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-02 | Register plugin creates tables in database (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-03 | Get plugin info returns schema, tables, version (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-04 | Create record in plugin table (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-05 | Get record by ID returns all fields (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-06 | Update record changes only specified fields (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-07 | Archive record sets status=archived (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-08 | Search records (text mode) finds by field content (VALIDATED) | test_plugin_search | 2026-04-14 | 2026-04-16 |
| P-09 | Search records with filters (AND logic) (VALIDATED) | test_plugin_search | 2026-04-14 | 2026-04-16 |
| P-10 | Archived record excluded from search_records (VALIDATED) | test_plugin_lifecycle | 2026-04-14 | 2026-04-16 |
| P-11 | Unregister plugin dry run shows impact without changes (VALIDATED) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-12 | Unregister plugin confirmed drops tables, clears data, and removes all `fqc_pending_plugin_review` rows for the plugin (VALIDATED) | test_plugin_registration | 2026-04-21 | 2026-04-29 |
| P-13 | Register plugin with schema migration (add column) (VALIDATED) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-14 | Register plugin rejects unsafe migration (remove column) (VALIDATED) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-15 | Plugin instance isolation (same plugin, different instances) (VALIDATED) | test_plugin_registration | 2026-04-14 | 2026-04-16 |
| P-16 | Plugin with both document-backed tables (`track_as`) and non-document-backed tables registers without DDL errors (no duplicate or conflicting implicit columns) (VALIDATED) | test_plugin_mixed_tables | 2026-04-22 | 2026-04-22 |
| P-17 | Plugin schema that explicitly declares `fqc_id` on a document-backed table (per §8.4.7 — the CRM plugin pattern) registers without a DDL error — the DDL builder de-duplicates the plugin-defined and implicit `fqc_id` columns rather than producing a duplicate column definition (PIR-03 regression guard; test schema MUST include `fqc_id` explicitly in the document-backed table columns — P-16 deliberately omits it, masking this defect) (VALIDATED) | test_plugin_explicit_fqc_id | 2026-04-22 | 2026-04-22 |

## 8. Tag Operations

Batch tag operations across entity types.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| T-01 | apply_tags adds tags to a document (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-02 | apply_tags removes tags from a document (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-03 | apply_tags add is idempotent (adding existing tag is no-op) (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-04 | apply_tags remove is graceful (removing absent tag is no-op) (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-05 | apply_tags works on memory (memory_id parameter) (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-06 | apply_tags batch (multiple identifiers) (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |
| T-07 | Tag normalization (whitespace, case) (VALIDATED) | test_tag_operations | 2026-04-14 | 2026-04-16 |

## 9. File System Operations

Vault scanning, file listing, and directory management.

### 9.1 Vault Scanning and File Listing

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| F-01 | force_file_scan (sync) indexes new files (VALIDATED) | test_search_after_create | 2026-04-13 | 2026-04-16 |
| F-02 | force_file_scan (background) returns immediately (VALIDATED) | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-03 | force_file_scan detects updated files (VALIDATED) | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-04 | force_file_scan detects deleted files (VALIDATED) | test_file_scan_lifecycle | 2026-04-14 | 2026-04-16 |
| F-05 | reconcile_documents dry run reports without changes (VALIDATED) | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-06 | reconcile_documents detects moved files via fqc_id (VALIDATED) | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-07 | reconcile_documents archives permanently gone files (VALIDATED) | test_reconcile_documents | 2026-04-14 | 2026-04-16 |
| F-08 | list_vault returns file entries for a directory (renamed from list_files) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-09 | list_vault recursive mode returns files from subdirectories (renamed from list_files) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-10 | list_vault with extension filter (renamed from list_files) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-11 | list_vault with date range filter (renamed from list_files) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-12 | remove_directory succeeds on empty directory (VALIDATED) | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-13 | remove_directory fails on non-empty directory (VALIDATED) | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-14 | remove_directory prevents vault root removal (VALIDATED) | test_directory_operations | 2026-04-14 | 2026-04-16 |
| F-15 | Path traversal protection (escape attempt blocked) (VALIDATED) | test_directory_operations | 2026-04-14 | 2026-04-16 |
| ~~F-16~~ | ~~discover_document in flagged mode~~ (VALIDATED) | ~~test_discover_document~~ | 2026-04-21 | 2026-04-16 |
| ~~F-17~~ | ~~discover_document in paths mode~~ (VALIDATED) | ~~test_discover_document~~ | 2026-04-21 | 2026-04-16 |
| F-18 | force_file_scan preserves user-defined frontmatter fields in newly discovered documents (scan merges FQC identity fields into existing frontmatter rather than replacing it) (VALIDATED) | test_frontmatter_preservation | 2026-04-18 | 2026-04-18 |

### 9.2 Directory Creation (`create_directory`)

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| F-19 | `create_directory` creates a single directory at the vault root and it exists on the filesystem (VALIDATED) | test_create_directory | 2026-04-25 | 2026-04-25 |
| F-20 | `create_directory` creates a deep hierarchy (`a/b/c/d`) — all intermediate directories exist (VALIDATED) | test_create_directory | 2026-04-25 | 2026-04-25 |
| F-21 | `create_directory` reports `(already exists)` for a pre-existing directory; `isError` is `false`; count is 0 (VALIDATED) | test_create_directory | 2026-04-25 | 2026-04-25 |
| F-22 | `create_directory` with partial overlap — existing segments reported as `(already exists)`, new segments as `(created)` (VALIDATED) | test_create_directory | 2026-04-25 | 2026-04-25 |
| F-23 | `create_directory` batch creation (array of paths) — all new directories created in one call (VALIDATED) | test_create_directory_batch | 2026-04-25 | 2026-04-25 |
| F-24 | `create_directory` batch with mixed results — valid paths created, invalid paths listed in `Failed` section, overall `isError` is `false` (VALIDATED) | test_create_directory_batch | 2026-04-25 | 2026-04-25 |
| F-25 | `create_directory` batch where all paths fail — overall `isError` is `true` (VALIDATED) | test_create_directory_batch | 2026-04-25 | 2026-04-25 |
| F-26 | `create_directory` with `root_path` — directories created relative to root; root itself created if absent (VALIDATED) | test_create_directory_root_path | 2026-04-25 | 2026-04-25 |
| F-27 | `create_directory` with `root_path` that already exists — root shown as `(already exists)`, subfolders created (VALIDATED) | test_create_directory_root_path | 2026-04-25 | 2026-04-25 |
| F-28 | `create_directory` with deep `root_path` (`Plugins/CRM/v2`) — entire root hierarchy created (VALIDATED) | test_create_directory_root_path | 2026-04-25 | 2026-04-25 |
| F-29 | `create_directory` is idempotent — repeated identical calls all succeed with `(already exists)` (VALIDATED) | test_create_directory | 2026-04-25 | 2026-04-25 |
| F-30 | Leading `/` stripped — `"/inbox"` creates `inbox/` (VALIDATED) | test_create_directory_normalization | 2026-04-25 | 2026-04-25 |
| F-31 | Trailing `/` stripped — `"inbox/"` creates `inbox/` (VALIDATED) | test_create_directory_normalization | 2026-04-25 | 2026-04-25 |
| F-32 | Consecutive slashes collapsed — `"CRM//Contacts///Active"` creates `CRM/Contacts/Active/` (VALIDATED) | test_create_directory_normalization | 2026-04-25 | 2026-04-25 |

### 9.3 Directory Creation (`create_directory`) — Sanitization and Rejection

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| F-33 | Illegal character (colon) sanitized — `"Work: Projects"` creates `"Work  Projects/"` with sanitization note in response (VALIDATED) | test_create_directory_sanitization | 2026-04-25 | 2026-04-25 |
| F-34 | Multiple illegal characters sanitized in one segment — response shows all replacements (VALIDATED) | test_create_directory_sanitization | 2026-04-29 | 2026-04-29 |
| F-35 | NUL character sanitized (VALIDATED) | test_create_directory_sanitization | 2026-04-25 | 2026-04-25 |
| F-36 | Control characters (bytes 1–31) sanitized (VALIDATED) | test_create_directory_sanitization | 2026-04-25 | 2026-04-25 |
| F-37 | Path traversal (`../../etc`) rejected with `isError: true` (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-38 | Vault root (`"/"`, `"."`, `""`) rejected as target (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-39 | Symlink in path rejected — even symlinks pointing within vault (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-40 | File conflict — existing file at path segment blocks directory creation (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-41 | File conflict mid-hierarchy — file at `a/file.md`, request for `a/file.md/sub` rejected (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-42 | Whitespace-only segment rejected (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-43 | Segment exceeding 255 bytes rejected with byte count in message (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-44 | Total resolved path exceeding 4,096 bytes rejected (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-45 | Array exceeding 50 paths rejected immediately — no paths processed (VALIDATED) | test_create_directory_batch | 2026-04-25 | 2026-04-25 |
| F-46 | Empty array rejected (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-47 | Wrong type for `paths` (e.g., number) rejected (VALIDATED) | test_create_directory_rejection | 2026-04-29 | 2026-04-29 |
| F-48 | Invalid `root_path` (traversal) rejects entire call — no paths processed (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-49 | `root_path` pointing to an existing file rejects entire call (VALIDATED) | test_create_directory_rejection | 2026-04-25 | 2026-04-25 |
| F-50 | Dot-prefixed directory (`.staging/temp`) created successfully (VALIDATED) | test_create_directory_special | 2026-04-25 | 2026-04-25 |
| F-51 | Dot-prefixed directory is invisible to `list_vault` (scanner ignore patterns) (VALIDATED) | test_create_directory_special | 2026-04-25 | 2026-04-25 |
| F-52 | Shutdown check — call during shutdown returns `isError: true` with shutdown message (DEFERRED — cannot inject in-process shutdown state from subprocess; unit-tested in files-tools.test.ts) | test_create_directory_special | 2026-04-29 | 2026-04-29 |

### 9.4 Vault Listing (`list_vault`)

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| F-53 | `list_vault` with `show: "files"` (explicit) returns only file entries — no directory entries in non-recursive mode (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-54 | `list_vault` with `show: "files"` in recursive mode returns only file entries (consistent with non-recursive) (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-55 | `list_vault` with `show: "directories"` non-recursive returns only immediate subdirectories (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-56 | `list_vault` with `show: "directories"` recursive returns complete directory tree sorted by depth then alphabetical (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-57 | `list_vault` with `show: "directories"` includes empty directories (0 children) (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-58 | `list_vault` with `show: "directories"` excludes dot-prefixed directories (scanner ignore patterns) (VALIDATED) | test_list_vault_directories | 2026-04-25 | 2026-04-25 |
| F-59 | `list_vault` with `show: "all"` returns both directory and file entries, directories grouped first (VALIDATED) | test_list_vault_all | 2026-04-25 | 2026-04-25 |
| F-60 | `list_vault` with `show: "all"` recursive returns entries from entire tree (VALIDATED) | test_list_vault_all | 2026-04-25 | 2026-04-25 |
| F-61 | `list_vault` with `show: "all"` and `extensions` filter — directories unfiltered, only matching files included (VALIDATED) | test_list_vault_all | 2026-04-29 | 2026-04-29 |
| F-62 | `list_vault` with `show: "directories"` and `extensions` — extensions silently ignored, only directories returned (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-63 | `list_vault` with `show: "directories"` and date filter — only directories modified within the date range appear (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-64 | `list_vault` with `show: "directories"` and `limit` — result truncated at limit with `truncated: true` (VALIDATED) | test_list_vault_directories | 2026-04-25 | 2026-04-25 |
| F-65 | `list_vault` rejects invalid `show` value (e.g., `"folders"`) with `isError: true` (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-66 | `list_vault` shutdown check — call during shutdown returns `isError: true` (DEFERRED — cannot inject in-process shutdown state from subprocess; unit-tested) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-67 | `list_vault` directory entry format includes `path` (trailing `/`), `type`, `children`, `updated`, `created` (VALIDATED) | test_list_vault_directories | 2026-04-29 | 2026-04-29 |
| F-68 | `list_vault` default behavior — call with no `show` parameter behaves like `show: "all"` (returns both directories and files) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-69 | `list_vault` with `format: "table"` (default) returns markdown table with header row, separator row, and data rows (VALIDATED) | test_list_vault_format | 2026-04-25 | 2026-04-25 |
| F-70 | `list_vault` with `format: "table"` includes all five columns: Name, Type, Size, Created, Updated (VALIDATED) | test_list_vault_format | 2026-04-25 | 2026-04-25 |
| F-71 | `list_vault` with `format: "table"` — file Size column shows human-readable size from `formatFileSize` (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-72 | `list_vault` with `format: "table"` — directory Size column shows `"N items"` child count (VALIDATED) | test_list_vault_format | 2026-04-25 | 2026-04-25 |
| F-73 | `list_vault` with `format: "table"` — directory Name column trails with `/` (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-74 | `list_vault` with `format: "table"` — non-recursive Name shows filename/dirname only; recursive Name shows relative path (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-75 | `list_vault` with `format: "table"` — dates use `YYYY-MM-DD` format (no time component) (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-76 | `list_vault` with `format: "detailed"` returns key-value pair entries separated by `---` | test_list_vault_format_detailed | 2026-04-29 | 2026-04-25 |
| F-77 | `list_vault` with `format: "detailed"` — file entries include `Size` field with human-readable value | test_list_vault_format_detailed | 2026-04-29 | 2026-04-25 |
| F-78 | `list_vault` with `format: "detailed"` — directory entries include `Children` count and `Type: directory` (VALIDATED) | test_list_vault_format_detailed | 2026-04-25 | 2026-04-25 |
| F-79 | `list_vault` with `format: "detailed"` — timestamps use ISO 8601 format | test_list_vault_format_detailed | 2026-04-29 | 2026-04-25 |
| F-80 | `list_vault` with no `format` parameter behaves like `format: "table"` (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-81 | `list_vault` rejects invalid `format` value (e.g., `"verbose"`) with `isError: true` (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-82 | `list_vault` with `format: "table"` and `show: "directories"` — table contains only directory rows (VALIDATED) | test_list_vault_format | 2026-04-29 | 2026-04-29 |
| F-83 | `list_vault` with `format: "detailed"` and `show: "all"` — directories grouped first, then files | test_list_vault_format_detailed | 2026-04-29 | 2026-04-25 |
| F-84 | `list_vault` with non-existent `path` returns `isError: true` (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-85 | `list_vault` with `path` pointing to a file (not directory) returns `isError: true` (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-86 | `list_vault` with no parameters (`list_vault({})`) — `path` defaults to `"/"`, `show` to `"all"`, `format` to `"table"`, `recursive` to `false`. Returns markdown table of top-level vault entries (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-87 | `list_vault` response includes untracked file trailing note when untracked files are present (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-88 | `list_vault` response includes summary line (`Showing N of M entries in {path}/.`) (VALIDATED) | test_list_vault | 2026-04-25 | 2026-04-25 |
| F-89 | `list_vault` with `date_field: "created"` filters by creation date, not modification date (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-90 | `list_vault` with multiple `extensions` (array) filters files correctly — directories unaffected (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-91 | `list_vault` path traversal (`"../../etc"`) returns `isError: true` (VALIDATED) | test_list_vault | 2026-04-29 | 2026-04-29 |
| F-92 | `list_vault` with `extensions` as bare string (not array) — Zod validation rejects before handler | test_list_vault_param_validation | 2026-04-29 | 2026-04-25 |
| F-93 | `list_vault` with `limit: 0` — Zod validation rejects (must be positive integer) | test_list_vault_param_validation | 2026-04-29 | 2026-04-25 |
| F-94 | `list_vault` with `limit: -5` — Zod validation rejects (must be positive integer) | test_list_vault_param_validation | 2026-04-29 | 2026-04-25 |
| F-95 | `list_vault` with `date_field: "modified"` — Zod validation rejects (must be `"updated"` or `"created"`) | test_list_vault_param_validation | 2026-04-29 | 2026-04-25 |
| F-96 | `list_vault` skips inaccessible subdirectory (permission denied) without `isError` — returns results for accessible entries | test_list_vault_fs_resilience | 2026-04-29 | 2026-04-25 |
| F-97 | `list_vault` skips unreadable file (stat error) without `isError` — returns results for readable files | test_list_vault_fs_resilience | 2026-04-29 | 2026-04-25 |

## 10. Briefing and Aggregation

Cross-entity summary tools.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| B-01 | get_briefing returns documents and memories grouped by type (VALIDATED) | test_briefing | 2026-04-14 | 2026-04-16 |
| B-02 | get_briefing with tag filtering (VALIDATED) | test_briefing | 2026-04-14 | 2026-04-16 |
| B-03 | get_briefing with plugin_id includes plugin record counts (VALIDATED) | test_briefing | 2026-04-14 | 2026-04-16 |

## 11. Scale and Correctness

Behaviors verifying that FlashQuery maintains correctness when operating at scale with heavy, continuous operation interleaving. Document-scale tests exercise vault operations (300+ files) with deterministically sequenced operations from both MCP and external sources. Memory-scale tests verify correctness for Supabase-backed semantic memory (1000+ records) under rapid concurrent operations.

### Document Scale Behaviors

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SC-01 | Large vault mixed-operation correctness (300+ files with interleaved creates, updates, archives from MCP and external sources) (VALIDATED) | test_large_vault_scale | 2026-04-29 | 2026-04-29 |
| SC-02 | Large vault search correctness (search indexes remain consistent through constant create/update/archive operations with 300+ files) (VALIDATED) | test_large_vault_scale | 2026-04-29 | 2026-04-29 |

### Memory Scale Behaviors

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| SC-03 | Large memory collection mixed operations (1000+ memories with rapid save/update/archive/version → updates apply correctly, versions preserved) | test_large_memory_scale | 2026-04-29 | 2026-04-29 |
| SC-04 | Memory batch tagging at scale (1000+ tag operations → tags applied consistently and searchable) | — | 2026-04-15 | |
| SC-05 | Memory semantic search correctness at scale (1000+ memories with concurrent save/update → results consistent, vector indices stable) | — | 2026-04-15 | |
| SC-06 | Memory threshold filtering under load (1000+ memories with concurrent writes → similarity threshold filtering accurate) | — | 2026-04-15 | |
| SC-07 | Memory version history accumulation (100+ versions of same memory → history traversable, no truncation or loss) (VALIDATED) | test_memory_version_history | 2026-04-16 | 2026-04-16 |
| SC-08 | Plugin-scoped memory isolation at scale (1000+ memories across multiple scopes → each scope returns only its own, no cross-scope leakage) | — | 2026-04-15 | |

## 12. Cross-cutting Behaviors

Behaviors that span multiple tools and represent system-level guarantees.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| X-01 | Identifier resolution: fqc_id (UUID) (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-02 | Identifier resolution: vault-relative path (VALIDATED) | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| X-03 | Identifier resolution: filename only (VALIDATED) | test_document_identifier_resolution | 2026-04-14 | 2026-04-16 |
| X-04 | Write lock contention returns error with guidance (VALIDATED) | test_write_lock_contention | 2026-04-14 | 2026-04-16 |
| X-05 | Batch identifiers (array input where supported) (VALIDATED) | test_cross_cutting_edge_cases | 2026-04-14 | 2026-04-16 |
| X-06 | Frontmatter round-trip: create → read → verify all fields (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-07 | Tags survive full CRUD cycle (create → update → verify) (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-08 | fqc_id is stable across updates (VALIDATED) | test_create_read_update | 2026-04-13 | 2026-04-16 |
| X-09 | Empty search results return "No documents found." (VALIDATED) | test_document_archive_and_search | 2026-04-13 | 2026-04-16 |
| X-10 | Graceful embedding fallback across all search tools (VALIDATED) | test_search_modes | 2026-04-14 | 2026-04-16 |
| X-11 | Fire-and-forget embedding does not block tool response (VALIDATED) | test_cross_cutting_edge_cases | 2026-04-14 | 2026-04-16 |

## 13. Git Behaviors

Behaviors verifying that FlashQuery auto-commits to the vault's git repository when documents change on disk. Exercising these requires the managed test server to be started with `enable_git=True`, which initializes the vault as a git repo and flips `git.auto_commit` on in the generated flashquery.yml.

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| G-01 | Auto-commit on document create (VALIDATED) | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |
| G-02 | Auto-commit on document update (content change) (VALIDATED) | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |
| G-03 | Auto-commit on document archive/remove (VALIDATED) | test_auto_commit_on_writes | 2026-04-14 | 2026-04-16 |

## 14. Plugin Reconciliation

Behaviors verifying the reconcile-on-read engine: how record tool calls trigger reconciliation, how the six reconciliation states are classified and handled, and how declarative policies govern mechanical actions on auto-track, movement, modification, and pending review.

### 14.1 Core Reconciliation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-01 | Record tool call triggers reconciliation before executing the requested operation (VALIDATED) | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-02 | Reconciliation classifies every document into exactly one of six categories (added/resurrected/deleted/disassociated/moved/modified) plus an unchanged count (VALIDATED) | test_reconciliation_six_categories | 2026-04-29 | 2026-04-29 |
| RO-03 | Reconciliation is idempotent (re-run with no changes produces all unchanged, zero in other categories) (VALIDATED) | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-04 | New file in watched folder with no plugin row (active or archived) is classified as `added` (VALIDATED) | test_reconciliation_core | 2026-04-21 | 2026-04-21 |
| RO-05 | Staleness check skips reconciliation diff when run within 30s threshold; pending review query still runs (VALIDATED) | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |
| RO-61 | `force_file_scan` invalidates the reconciliation staleness cache, ensuring the next record tool call performs a full diff (VALIDATED) | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |
| RO-70 | After background `force_file_scan` completes asynchronously, the next record tool call performs a full reconciliation diff and sees the updated `fqc_documents` state — staleness cache is not prematurely consumed by a pre-scan reconciliation (VALIDATED) | test_reconciliation_background_scan_cache | 2026-04-22 | 2026-04-22 |
| RO-76 | A record tool call made BEFORE a background `force_file_scan` completes does not consume the staleness cache — after the scan finishes a subsequent record tool call still performs a full diff and sees the scan results (PIR-05 race guard; test MUST include an immediate intermediate record tool call between scan trigger and scan completion — pre-populating 100+ files in the vault ensures the scan takes ≥2s so the intermediate call reliably lands in the race window) (VALIDATED) | test_reconciliation_background_scan_race | 2026-04-22 | 2026-04-22 |

### 14.2 Auto-Track

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-06 | `on_added: auto-track` creates a plugin table row with columns populated from `field_map` (VALIDATED) | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-07 | `on_added: auto-track` writes `fqc_owner` and `fqc_type` into the document's frontmatter on disk (VALIDATED) | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-08 | `on_added: auto-track` with a declared `template` inserts a `fqc_pending_plugin_review` row (VALIDATED) | test_reconciliation_staleness | 2026-04-21 | 2026-04-21 |
| RO-09 | `on_added: auto-track` does NOT modify the document's body content (only frontmatter is changed) (VALIDATED) | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-10 | `on_added: auto-track` without a `template` does NOT create a pending review row (VALIDATED) | test_reconciliation_auto_track | 2026-04-21 | 2026-04-21 |
| RO-67 | After auto-track writes `fqc_owner`/`fqc_type` frontmatter to disk, `fqc_documents.content_hash` is updated to reflect the post-write file content (VALIDATED) | test_reconciliation_content_hash_cascade | 2026-04-29 | 2026-04-29 |
| RO-68 | After auto-track completes, `last_seen_updated_at` on the new plugin row equals `fqc_documents.updated_at` as of the post-frontmatter-write state — no stale timestamp mismatch (VALIDATED) | test_reconciliation_content_hash_cascade | 2026-04-29 | 2026-04-29 |
| RO-69 | Scanner's first pass after auto-track does not re-detect the frontmatter write as a file modification — `fqc_documents.updated_at` is not bumped again because `content_hash` already matches the post-write file (VALIDATED) | test_reconciliation_content_hash_cascade | 2026-04-22 | 2026-04-22 |
| RO-74 | Auto-tracked document with `on_modified: sync-fields` policy is NOT spuriously classified as `modified` on the next reconciliation pass (past staleness window, after an intervening `force_file_scan`) — "Synced fields on N modified" does not appear in the summary (PIR-02 regression guard; test MUST use `sync-fields` — `ignore` masks this defect because no observable signal is emitted for a silent modified pass) (VALIDATED) | test_reconciliation_spurious_sync_fields | 2026-04-22 | 2026-04-22 |

### 14.3 Ignore Policy

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-11 | `on_added: ignore` takes no action — no plugin row created, no frontmatter modified, no mention in tool response (VALIDATED) | test_reconciliation_ignore_policy | 2026-04-21 | 2026-04-21 |
| RO-12 | Missing policy fields use conservative defaults: `on_added: ignore`, `on_moved: keep-tracking`, `on_modified: ignore` (VALIDATED) | test_reconciliation_ignore_policy | 2026-04-21 | 2026-04-21 |

### 14.4 Deletion and Archival

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-13 | Document with `fqc_documents` status `missing` is classified as `deleted`; plugin row is archived (VALIDATED) | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |
| RO-14 | Document with `fqc_documents` status `archived` (MCP-archived) is also classified as `deleted`; plugin row is archived (VALIDATED) | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |
| RO-15 | Archiving a plugin row (due to deleted/disassociated/moved+untrack) does not delete the vault file (VALIDATED) | test_reconciliation_deletion | 2026-04-21 | 2026-04-21 |

### 14.5 Disassociation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-16 | Removing `fqc_owner`/`fqc_type` from frontmatter triggers `disassociated`; plugin row is archived (VALIDATED) | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |
| RO-17 | Moving a file with frontmatter intact does NOT trigger `disassociated` (reports `moved` instead) (VALIDATED) | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |
| RO-18 | Disassociated document remains `status: active` in `fqc_documents`; only the plugin row is archived (VALIDATED) | test_reconciliation_disassociation | 2026-04-21 | 2026-04-21 |

### 14.6 Resurrection

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-19 | Missing-then-reappearing document un-archives the existing plugin row (`resurrected`), does not create a new row (VALIDATED) | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |
| RO-20 | Resurrection is determined solely by `fqc_id` match — document's current path and folder are irrelevant (VALIDATED) | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |
| RO-22 | Template is NOT surfaced on resurrection; `field_map` IS re-applied from current frontmatter (VALIDATED) | test_reconciliation_resurrection | 2026-04-21 | 2026-04-21 |
| RO-71 | Resurrected document outside the plugin's watched folders with `on_moved: untrack` — resurrection succeeds unconditionally, then `on_moved` follow-up re-archives the row; net result: plugin row is archived (VALIDATED) | test_reconciliation_resurrection_with_on_moved | 2026-04-22 | 2026-04-22 |
| RO-72 | Resurrected document outside the plugin's watched folders with `on_moved: keep-tracking` — resurrection succeeds and `on_moved` follow-up keeps the row active at the new out-of-folder path (VALIDATED) | test_reconciliation_resurrection_with_on_moved | 2026-04-22 | 2026-04-22 |

### 14.7 Movement

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-24 | `on_moved: keep-tracking` updates stored path silently; plugin row stays active (VALIDATED) | test_reconciliation_movement | 2026-04-21 | 2026-04-21 |
| RO-25 | `on_moved: untrack` archives the plugin row; vault file frontmatter (`fqc_owner`/`fqc_type`) is preserved (VALIDATED) | test_reconciliation_movement | 2026-04-21 | 2026-04-22 |
| RO-26 | `on_moved` defaults to `keep-tracking` when not declared (VALIDATED) | test_reconciliation_movement | 2026-04-21 | 2026-04-21 |
| RO-27 | After `keep-tracking` path update, subsequent reconciliation reports the document as `unchanged` (VALIDATED) | test_reconciliation_movement | 2026-04-21 | 2026-04-21 |
| RO-64 | `on_moved: untrack` (spec vocabulary) is accepted at plugin registration and at reconciliation time archives the plugin row with frontmatter preserved — NOT silently treated as a no-op (VALIDATED) | test_reconciliation_untrack_policy | 2026-04-22 | 2026-04-22 |
| RO-65 | A `keep-tracking` document moved outside watched folders is re-discovered via Path 2 (frontmatter `fqc_type`) on subsequent reconciliations and classified as `unchanged` — NOT re-classified as `moved` (VALIDATED) | test_reconciliation_keep_tracking_stability | 2026-04-22 | 2026-04-22 |

### 14.8 Modification and Field Sync

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-28 | `on_modified: sync-fields` re-applies `field_map` from current frontmatter and updates `last_seen_updated_at` (VALIDATED) | test_reconciliation_modification | 2026-04-21 | 2026-04-21 |
| RO-29 | `on_modified: ignore` takes no action (no field sync) (VALIDATED) | test_reconciliation_modification | 2026-04-21 | 2026-04-21 |
| RO-30 | `on_modified: ignore` still updates `last_seen_updated_at` (preventing re-evaluation on every subsequent pass) (VALIDATED) | test_reconciliation_modification | 2026-04-21 | 2026-04-21 |
| RO-59 | `field_map` sets NULL for frontmatter fields not present in the document (VALIDATED) | test_reconciliation_modification | 2026-04-21 | 2026-04-21 |

### 14.9 Frontmatter-Based Discovery

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-31 | Document with `fqc_type` in frontmatter is discovered as `added` even outside watched folders (global type registry Path 2) (VALIDATED) | test_reconciliation_frontmatter_discovery | 2026-04-21 | 2026-04-21 |
| RO-32 | Scanner syncs `fqc_owner`/`fqc_type` frontmatter fields to `ownership_plugin_id`/`ownership_type` columns on every pass; removing them from frontmatter sets columns to NULL on next scan (VALIDATED) | test_reconciliation_frontmatter_discovery | 2026-04-21 | 2026-04-21 |
| RO-73 | Pending review row and tool response for a Path 2 auto-tracked document include the plugin's designated folder for the document type, enabling a skill to identify documents outside their canonical location (VALIDATED) | test_reconciliation_policy_edge_cases | 2026-04-22 | 2026-04-22 |
| RO-75 | Pending review context JSONB for a Path 2 auto-tracked document includes a `discoveryPath` field with value `'frontmatter-type'`, enabling a skill to distinguish Path 2 discovery from Path 1 (folder) discovery (PIR-04 regression guard; ⚠ not implemented — `discoveryPath` absent from `DocumentInfo` and from all pending review context writes; test MUST assert on the `discoveryPath` key specifically — asserting on the canonical folder string alone passes regardless because `policy.folder` is already in context) (VALIDATED) | test_reconciliation_discovery_path_context | 2026-04-22 | 2026-04-22 |

### 14.10 Policy Validation

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-35 | `on_added: auto-track` without `track_as` causes `register_plugin` to reject or warn (VALIDATED) | test_reconciliation_policy_validation | 2026-04-21 | 2026-04-21 |
| RO-36 | All policy field validation (value ranges, required companions like `track_as`) happens at `register_plugin` time, not at reconciliation time (VALIDATED) | test_reconciliation_policy_validation | 2026-04-21 | 2026-04-21 |
| RO-60 | `access: read-only` emits a warning in the tool response when a tool call attempts to write to a document in that folder (VALIDATED) | test_reconciliation_policy_validation | 2026-04-21 | 2026-04-21 |
| RO-66 | Registering a plugin with an unrecognized `on_moved` value (any string outside the defined vocabulary) produces a parse-time error or warning at `register_plugin` time — not silently accepted (VALIDATED) | test_reconciliation_policy_edge_cases | 2026-04-22 | 2026-04-22 |

### 14.11 Pending Plugin Review

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-38 | `clear_pending_reviews` with empty `fqc_ids` returns current pending list without deleting; with non-empty `fqc_ids` clears those items and returns remainder (VALIDATED) | test_reconciliation_pending_review | 2026-04-21 | 2026-04-21 |
| RO-39 | `clear_pending_reviews` is idempotent (clearing already-cleared `fqc_ids` is a no-op) (VALIDATED) | test_reconciliation_pending_review | 2026-04-21 | 2026-04-21 |
| RO-40 | Pending review rows cascade-delete when the referenced `fqc_documents` row is deleted (VALIDATED) | test_reconciliation_pending_review | 2026-04-21 | 2026-04-21 |
| RO-41 | `unregister_plugin` clears all `fqc_pending_plugin_review` rows for the plugin (VALIDATED) | test_reconciliation_pending_review | 2026-04-21 | 2026-04-21 |

### 14.12 Bulk and Multi-Table

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| RO-52 | Tool response summarizes bulk reconciliation by count (not enumeration) when items per category exceed threshold (VALIDATED) | test_reconciliation_multi_table | 2026-04-21 | 2026-04-21 |
| RO-54 | Auto-track frontmatter writes do not cause spurious `modified` flags on the next reconciliation pass (VALIDATED) | test_reconciliation_multi_table | 2026-04-21 | 2026-04-21 |
| RO-56 | Reconciliation scans all document-backed tables for a plugin in a single pass (not just the table implied by the current tool call) and does NOT scan non-document-backed plugin tables (even if they have an `fqc_id` column) (VALIDATED) | test_reconciliation_multi_table, test_reconciliation_non_doc_table_isolation | 2026-04-21 | 2026-04-22 |
| RO-58 | Auto-track routes the new plugin row to the correct table based on `track_as` for the matched folder (VALIDATED) | test_reconciliation_multi_table | 2026-04-21 | 2026-04-21 |
| RO-51 | Reconciliation discovers and classifies ALL documents in a watched folder without silent truncation — the full candidate set is returned even when the folder contains more than 1,000 documents (VALIDATED) | test_reconciliation_discovery_at_scale | 2026-04-22 | 2026-04-22 |
| RO-62 | Reconciliation does not falsely classify active plugin rows as `deleted` when their `fqc_documents` rows exist but were excluded by a query row-limit cap on candidate discovery (VALIDATED) | test_reconciliation_discovery_at_scale | 2026-04-22 | 2026-04-22 |
| RO-63 | Path 2 (frontmatter type) discovery returns all matching documents even when more than 1,000 documents share the same `ownership_type` (VALIDATED) | test_reconciliation_discovery_at_scale | 2026-04-22 | 2026-04-22 |

## 15. LLM Tools

Behaviors for `call_model` and `get_llm_usage`. Tests require a FlashQuery instance configured with at least one provider, one model with non-zero `cost_per_million` rates (e.g. the default `fast` model), and at least one purpose with a non-empty `models:` list (e.g. `general`). A separate purpose with an **empty** `models:` list must also be configured for L-07. Use `resolver=purpose` with the `general` purpose and `resolver=model` with the `fast` model alias as the baseline call targets unless a behavior specifies otherwise.

### 15.1 `call_model` — Metadata Fields

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-01 | `call_model` with `resolver=model` — `metadata.fallback_position` in the response JSON is the value `null` (not absent, not `0`, not `1`) | test_call_model_by_model | 2026-04-30 | 2026-05-01 |
| L-02 | `call_model` with `resolver=purpose` where the primary model handles the request — `metadata.fallback_position` is the integer `1` | test_call_model_by_purpose | 2026-04-30 | 2026-05-01 |
| L-03 | `call_model` — `metadata.resolver` and `metadata.name` in the response match the exact strings sent in the request (e.g. sending `resolver="purpose"`, `name="general"` → response contains `"resolver": "purpose"` and `"name": "general"`) | test_llm_cost_tracking | 2026-04-30 | 2026-05-01 |

### 15.2 `call_model` — Resolution and Naming

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-04 | `call_model` with an uppercase model name (e.g. `"FAST"`) resolves to the `fast` model and returns a successful response — case normalization applied at runtime before lookup | test_call_model_resolution_edge_cases | 2026-04-30 | 2026-04-30 |
| L-05 | `call_model` with an unknown model name (e.g. `"nonexistent-model"`) returns `isError: true`; response text includes the unknown name and a list of available model names | test_call_model_errors | 2026-04-30 | 2026-05-01 |
| L-06 | `call_model` with an unknown purpose name (e.g. `"nonexistent-purpose"`) returns `isError: true`; response text includes the unknown name and a list of available purpose names | test_call_model_errors | 2026-04-30 | 2026-05-01 |
| L-07 | `call_model` targeting a purpose whose `models:` list is empty returns `isError: true`; response text identifies the purpose name (purpose is defined in config but has no model assigned — the "defined but unassigned" state) | test_call_model_resolution_edge_cases | 2026-04-30 | 2026-04-30 |

### 15.3 `call_model` — Parameter Handling

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-08 | Caller-supplied `parameters` override purpose `defaults` — configure a purpose with `defaults: {temperature: 0.0}`, call it with `parameters: {temperature: 1.0}`, call succeeds and the provider receives `temperature: 1.0` (verified by confirming the call does not error; exact value passthrough may require a provider that echoes parameters, or can be inferred from response variability) | test_call_model_params | 2026-04-30 | 2026-05-01 |
| L-09 | Provider-unsupported parameter in `parameters` causes the provider's own error to be returned as-is — response has `isError: true` and the error text originates from the provider (not a FlashQuery-generated wrapper message); use a parameter name the target provider is known to reject (e.g. `"bad_param_xyz": true`) | test_call_model_bad_provider_param | 2026-04-30 | 2026-04-30 |

### 15.4 `call_model` — Cost Tracking Fields

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-10 | `metadata.cost_usd` is greater than `0` after a successful `call_model` to a model configured with non-zero `cost_per_million` input or output rates (verifies the token-count × rate computation returns a non-zero result for a real provider response) | test_call_model_cost_strict | 2026-04-30 | 2026-04-30 |
| L-11 | `metadata.latency_ms` is a positive integer (> 0) in every successful `call_model` response — verifies the round-trip timer is wired and returns a real measurement, not a zero or null placeholder | test_call_model_cost_strict | 2026-04-30 | 2026-04-30 |

### 15.5 `get_llm_usage` — Filter Parameters

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-12 | `get_llm_usage` `purpose_name` filter — make calls to two distinct purposes (e.g. `general` and a second purpose), then query with `purpose_name=general`; response contains only records for `general` and no records for the second purpose | test_llm_usage_filters | 2026-04-30 | 2026-04-30 |
| L-13 | `get_llm_usage` `model_name` filter — make calls that resolve to two distinct model aliases, then query with `model_name=<first model>`; response contains only records for that model and no records for the other | test_llm_usage_filters | 2026-04-30 | 2026-04-30 |

### 15.6 `get_llm_usage` — Recent Mode with Limit

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-14 | `get_llm_usage` with `mode=recent` and `limit=N` returns exactly `N` entries when more than `N` records exist — seed `N+1` `call_model` calls, then query with `limit=N`; assert `entries` array length equals exactly `N` (not N+1, not N-1) | test_llm_usage_filters | 2026-04-30 | 2026-04-30 |

### 15.7 `call_model` — Trace ID and Cumulative Totals

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-15 | `call_model` with a `trace_id` — `metadata.trace_id` in the response JSON echoes the supplied trace_id exactly, and `metadata.trace_cumulative.total_calls` equals `1` after the first call with that trace_id | test_call_model_trace | 2026-05-01 | 2026-05-01 |
| L-16 | `call_model` called twice with the same `trace_id` — `metadata.trace_cumulative.total_calls` equals `2` after the second call, and `metadata.trace_cumulative.total_tokens.input` is strictly greater than the input tokens of the first call alone | test_call_model_trace | 2026-05-01 | 2026-05-01 |

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
| Plugin Lifecycle | 17 | 17 | 0 |
| Tag Operations | 7 | 7 | 0 |
| File System Operations | 95 | 95 | 0 |
| Briefing | 3 | 3 | 0 |
| Scale and Correctness | 8 | 4 | 4 |
| Cross-cutting | 11 | 11 | 0 |
| Git Behaviors | 3 | 3 | 0 |
| Plugin Reconciliation | 59 | 59 | 0 |
| LLM Tools | 14 | 14 | 0 |
| **Total** | **298** | **294** | **4** |

---

## Behavior - Testcase Validation

### test_document_outline ✓ RESOLVED 2026-04-29

**Behaviors affected**
- O-06: Batch outline (array of identifiers) returns DB metadata

**Fix applied**: Added `expect_contains(fqc_id_a)` and `expect_contains(fqc_id_b)` assertions to the batch outline step. The FQC IDs are DB-assigned UUIDs that appear in the response via `formatKeyValueEntry('FQC ID', row.id)` — their presence proves the response came from a DB lookup, not just file parsing. Test passes (8/8 steps).

---

### test_memory_lifecycle ✓ RESOLVED 2026-04-29

**Behaviors affected**
- M-10: List memories by tags returns recent, truncated to 200 chars

**Description**: The test calls `list_memories` with a tag filter and asserts that the known memory ID and tag appear in the response. It does not assert that the content preview is truncated to approximately 200 characters. A server that returns full content without truncation would pass this test.

**How to Remedy**: In the `list_memories` step, assert that the full `original_content` string does NOT appear verbatim in the response (i.e., `expect_not_contains(original_content)` where `original_content` is longer than 200 chars), or assert that the content preview length is bounded (e.g., check that the response does not contain text beyond the 200-char mark of the stored content). Alternatively, create a memory with content longer than 200 characters and verify the listed preview is truncated (ends with `...` or is shorter than the full content).

**Resolution (2026-04-29)**: Extended `original_content` with a padding sentence so the prefix reliably exceeds 200 chars, then appended a unique `list_truncation_sentinel` (`TRUNCATED_TAIL_<run_id>`) beyond the 200-char boundary. In Step 3 (list_memories), added `expect_not_contains(list_truncation_sentinel)` — if truncation is absent the sentinel would appear and fail the test. Also added `expect_contains(list_truncation_sentinel)` to Step 2 (get_memory) to assert full-content round-trip as a contrast. Test passes 9/9 steps.

---

### test_memory_plugin_scope ✓ RESOLVED 2026-04-29

**Behaviors affected**
- M-15: Save memory with plugin_scope (fuzzy matched)

**Description**: The test calls `save_memory` with `plugin_scope` set to the exact plugin ID (a degenerate exact match). The behavior specifies "fuzzy matched" — the test does not exercise the fuzzy-matching aspect (e.g., a prefix, partial string, or near-match that should resolve to the plugin). The test comment acknowledges this limitation. Additionally, the test does not assert that the `plugin_id` appears in the `save_memory` response confirming scope resolution — it relies on a subsequent `get_memory` call to verify the scope.

**How to Remedy**: Add a second `save_memory` call using a partial/fuzzy `plugin_scope` value (e.g., just the first portion of the plugin ID or a fuzzy alias) and assert that it resolves to the correct plugin — either by checking the `save_memory` response for the resolved plugin name/ID, or by verifying with `search_memory` that the memory is scoped correctly. The save_memory response should mention the resolved plugin scope.

**Resolution (2026-04-29)**: Added `fuzzy_scope = plugin_id + "z"` as Step 2b. Appending one character gives trigram similarity ~0.82 (above the 0.8 threshold), reliably triggering the `find_plugin_scope` auto-correction path. The new step asserts `expect_contains("auto-corrected")` and `expect_contains(plugin_id)` on the `save_memory` response — both fields only appear when fuzzy resolution fires, not on an exact match. `fuzzy_memory_id` is tracked for cleanup. Test passes 6/6 steps.

---

### test_plugin_registration ✓ RESOLVED 2026-04-29

**Behaviors affected**
- P-12: Unregister plugin confirmed drops tables, clears data, and removes all `fqc_pending_plugin_review` rows for the plugin

**Description**: The test calls `unregister_plugin(confirm_destroy=True)` and verifies that tables are dropped (subsequent `get_record` fails) and data is gone. However, it does not assert that `fqc_pending_plugin_review` rows for the plugin are cleared. The behavior description explicitly includes this requirement, and it is distinct from table/data removal.

**How to Remedy**: Before calling `unregister_plugin`, create at least one `fqc_pending_plugin_review` row for the plugin (this happens automatically when `on_added: auto-track` with a `template` is configured and a file is scanned). After the confirmed unregister, call `clear_pending_reviews` in query mode and assert that no pending review rows remain for the plugin (e.g., `expect_contains("No pending reviews")`).

**Resolution (2026-04-29)**: Added `_schema_v2_with_tracking(folder)` — v2 tables plus a `documents` section with `on_added: auto-track`, `template: "testreg-review"`, `field_map: {fq_title: name}`. Inserted Steps 9b–9e between the dry-run and confirmed unregister: re-register inst_a with the tracking schema, create a vault file in the watched folder, scan, call `search_records` to trigger reconciliation (which auto-tracks the file and inserts a `fqc_pending_plugin_review` row), then verify the row exists via `clear_pending_reviews(fqc_ids=[])`. Added Step 10b after teardown: `clear_pending_reviews(fqc_ids=[])` asserts `"No pending reviews for testreg"`. Two debug iterations fixed a reversed `field_map` key (`name: title` → `title: name`) and then the wrong frontmatter key (`title` → `fq_title`). Test passes 22/22 steps.

---

### test_create_directory_sanitization ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-34: Multiple illegal characters sanitized in one segment — response shows all replacements

**Description**: The assertions for F-34 use overly broad OR conditions. Specifically, `colon_reported` and `pipe_reported` each have four OR branches, including `':|' in result.text` which is always satisfied when the original input path `foo:|bar` echoes back in any form. This means the test can pass even if the response contains no explicit per-character replacement notices — just the raw input path echoed back suffices.

**How to Remedy**: Tighten the assertions to require that the response explicitly mentions the replacement for each character. For example, assert `'replaced' in result.text` (a single required keyword) AND that the sanitized directory exists on disk under the expected name. Alternatively, assert that the response contains the specific replacement notation used by the server (e.g., `': →'`, `'colon replaced'`, or the sanitized name displayed alongside the original name) — not just that the input characters appear somewhere.

**Resolution (2026-04-29)**: Replaced the four-branch OR conditions (`colon_reported`, `pipe_reported`) with a single `replaced_reported = "replaced" in result.text`. The `':|' in result.text` branches were the defect — they always passed because the original path `foo:|bar` is echoed back in the `sanitized from "foo:|bar"` clause. The new assertion requires the word `"replaced"` to appear explicitly in the response, which is only present when the server actively reports the sanitization. Combined with the existing `sanitized_dir_exists` disk check, this proves both that the sanitization occurred and that it was reported. Test passes 4/4 steps.

---

### test_create_directory_rejection ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-47: Wrong type for `paths` (e.g., number) rejected

**Description**: The test for F-47 only asserts `not result.ok`. There is no assertion on the response text to confirm that the rejection is specifically a type/schema validation error. Any error — including an internal server error, a path processing failure, or an unrelated exception — would pass this check.

**How to Remedy**: Add an assertion that the response contains a validation-specific keyword such as `"invalid"`, `"type"`, `"expected"`, `"array"`, `"string"`, or a Zod validation error message. For example: `any(kw in result.text.lower() for kw in ["invalid", "type", "expected", "array", "must be"])`.

**Resolution (2026-04-29)**: Added `has_validation_error = any(kw in result.text.lower() for kw in ["invalid", "type", "expected", "array", "must be", "string"])` and updated `passed_f47 = not result.ok and has_validation_error`. The actual server response is a Zod `invalid_union` error with `"expected": "string"` — keywords "invalid", "expected", and "string" all match. Test passes 12/12 steps.

---

### test_create_directory_special ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-52: Shutdown check — call during shutdown returns `isError: true` with shutdown message

**Description**: The test step for F-52 unconditionally calls `run.step(label=..., passed=True, ...)` with the message "F-52: shutdown check (SKIPPED — tested in tests/unit/files-tools.test.ts)". It does not perform any actual assertion. The referenced unit test file may or may not cover this case, and even if it does, a unit test for a different code path does not validate the MCP tool's behavior end-to-end.

**How to Remedy**: Either implement the shutdown check in this directed test (requires a way to trigger server shutdown state, similar to `test_list_vault`'s F-66 step), or remove F-52 from this test's coverage claim in DIRECTED_COVERAGE.md and keep it only as a unit test concern. If keeping as a directed test, the shutdown simulation must inject a real shutdown signal and assert `not result.ok` plus a shutdown-related keyword in the response text.

**Resolution (2026-04-29)**: Removed `"F-52"` from the `COVERAGE` list and from the module docstring. The step is retained as a clearly-labeled deferred record ("Not a coverage claim. See tests/unit/files-tools.test.ts for this behavior.") so the rationale is preserved, but it no longer contributes to the coverage matrix. In-process shutdown state cannot be injected from a subprocess-based directed test. Test passes 3/3 steps (F-50, F-51, deferred-record step).

---

### test_list_vault ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-53: `list_vault` with `show: "files"` (explicit) returns only file entries — no directory entries in non-recursive mode
- F-54: `list_vault` with `show: "files"` in recursive mode returns only file entries (consistent with non-recursive)
- F-65: `list_vault` rejects invalid `show` value (e.g., `"folders"`) with `isError: true`
- F-66: `list_vault` shutdown check — call during shutdown returns `isError: true`
- F-86: `list_vault` with no parameters (`list_vault({})`) — `path` defaults to `"/"`, `show` to `"all"`, `format` to `"table"`, `recursive` to `false`. Returns markdown table of top-level vault entries
- F-87: `list_vault` response includes untracked file trailing note when untracked files are present
- F-89: `list_vault` with `date_field: "created"` filters by creation date, not modification date
- F-90: `list_vault` with multiple `extensions` (array) filters files correctly — directories unaffected
- F-91: `list_vault` path traversal (`"../../etc"`) returns `isError: true`

**Description**: Multiple behaviors in `test_list_vault` are either tested by a step that asserts a different behavior entirely, or the assertion is too weak to validate the described outcome:
- F-53 step only checks table header presence (`"| Name |"`), not that directory entries are absent.
- F-54 step checks detailed format output style, not file-only consistency in recursive mode.
- F-65 step tests filename-only column display (non-recursive name format), never passes an invalid `show` value.
- F-66 step tests recursive path display, never simulates shutdown.
- F-86 step only checks `"in /."` in response text, not that both dirs and files appear with default params.
- F-87 step checks the path format in the summary line, not for an untracked-file trailing note.
- F-89 step tests `limit=1` truncation behavior, never calls with `date_field="created"` and a date filter.
- F-90 step tests single uppercase extension case-insensitivity, not multiple extensions or directory passthrough.
- F-91 step tests `date_field="created"` no-error success case, never passes a traversal path.

**How to Remedy**: Each step needs to be rewritten to test its labeled behavior:
- F-53: Add `expect_not_contains` for any directory name in the result after calling with `show="files"` non-recursive.
- F-54: Add a recursive `show="files"` call and assert directory entries are absent.
- F-65: Add a call with `show="folders"` (or any invalid value) and assert `not result.ok`.
- F-66: This requires shutdown simulation — either implement via a dedicated managed server + shutdown injection, or defer to a unit test and remove from this test's coverage claim.
- F-86: After calling with no parameters, assert both a directory entry (e.g., `"_test/"`) and a file entry appear, confirming `show="all"` default.
- F-87: Add an untracked `.md` file to the vault without scanning, then call `list_vault` and assert the response contains a trailing note about untracked files.
- F-89: Create a file, then call `list_vault` with `date_field="created"` and a `before` date in the future and `after` date set before creation — verify the file appears. Then call with `after` date in the far future — verify file is absent. This distinguishes creation vs modification date.
- F-90: Call with `extensions=[".md", ".txt"]` where both `.md` and `.txt` files exist, plus a directory. Assert `.md` files appear, `.txt` files appear, and the directory also appears (unfiltered).
- F-91: Call with `path="../../etc"` and assert `not result.ok`.

**Resolution (2026-04-29)**: Rewrote all eight misaligned steps and removed F-66 from coverage (shutdown simulation impossible from subprocess test). Added `untracked_note.md` to setup for F-87. Step-by-step changes: F-53 now asserts `"| directory |" not in result.text` after `show="files"` non-recursive; F-54 calls `show="files"` recursive and asserts no `"| directory |"` row; F-65 calls `show="folders"` (invalid) and asserts `not result.ok`; F-66 replaced with a deferred-record step (not a coverage claim); F-86 calls no-params and asserts both `"| directory |"` and `"top.md"` appear (confirming `show="all"` default); F-87 asserts response contains `"untracked file"` trailing note; F-89 calls `date_field="created"` with `after="1d"` (files appear) and `after="2030-01-01"` (files absent); F-90 calls `extensions=[".md", ".txt"]` and asserts `.md`, `.txt`, AND `"| directory |"` all appear; F-91 calls `path="../../etc"` and asserts `not result.ok`. Test passes all steps.

---

### test_list_vault_directories ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-55: `list_vault` with `show: "directories"` non-recursive returns only immediate subdirectories
- F-56: `list_vault` with `show: "directories"` recursive returns complete directory tree sorted by depth then alphabetical
- F-57: `list_vault` with `show: "directories"` includes empty directories (0 children)
- F-62: `list_vault` with `show: "directories"` and `extensions` — extensions silently ignored, only directories returned
- F-63: `list_vault` with `show: "directories"` and date filter — only directories modified within the date range appear
- F-67: `list_vault` directory entry format includes `path` (trailing `/`), `type`, `children`, `updated`, `created`

**Description**:
- F-55: Test asserts a directory name appears but never asserts file entries are absent.
- F-56: Test asserts nested child appears but never checks the depth-then-alphabetical ordering constraint.
- F-57: The step labeled F-57 tests alphabetical sort order (`alpha_pos < beta_pos`), not empty-directory inclusion. While an empty directory (`beta/`) appears incidentally, a `children: 0` or `0 items` value is never asserted.
- F-62: Step only asserts `result.ok`, not that only directory entries (no files) appear.
- F-63: Step labeled F-63 calls with `format="detailed"` and asserts `"Type: directory"` — it does not use a date filter at all.
- F-67: The step labeled F-67 only checks `result.ok` for the extensions call. The five format fields (path with trailing `/`, type, children, updated, created) are never all asserted together in a single step.

**How to Remedy**:
- F-55: Add `expect_not_contains` for any filename that exists in the directory (e.g., assert a known `.md` file name does NOT appear).
- F-56: After the recursive call, extract directory positions from the result text and assert `alpha/child/` position is between `alpha/` and `beta/` (depth ordering), and that `alpha/` < `beta/` (alphabetical).
- F-57: Add an assertion that the empty directory entry contains `"0"` in the children/size field, e.g., `expect_contains("0 items")` or check the children count in detailed format.
- F-62: Add a known `.md` file to the test setup, call with `show="directories"` and `extensions=[".md"]`, and assert the `.md` filename does NOT appear in the result.
- F-63: Add a date-filtered call with `show="directories"` using `after` and `before` parameters. Create a directory, call with `after` set to before creation (should include it) vs. `after` set to the future (should exclude it).
- F-67: Add a dedicated step calling `list_vault` with `show="directories"` and `format="detailed"`, then assert all five fields are present: path ends with `/`, `Type: directory` present, `Children:` field present, `Updated:` field present, `Created:` field present.

**Resolution (2026-04-29)**: Added a `notes.md` file to the setup for F-55/F-62 assertions. Six steps tightened: F-55 now asserts `"notes.md" not in result.text` (files absent from directory listing); F-56 uses position checks for both depth ordering (`alpha_pos < child_pos`) and alphabetical ordering (`alpha_pos < beta_pos`); F-57 calls `format="detailed"` and asserts `"beta/" in result.text` AND `"Children: 0" in result.text` (empty dir shown with zero count); F-62 asserts `"notes.md" not in result.text` AND `"alpha/" in result.text` (extensions silently ignored); F-63 replaced with two date-filtered calls (`after="1d"` dirs appear, `before="2000-01-01"` all absent); F-67 replaced with `format="detailed"` call asserting all five fields: trailing `/`, `Type:`, `Children:`, `Updated:`, `Created:`. Test passes 8/8 steps.

---

### test_list_vault_all ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-61: `list_vault` with `show: "all"` and `extensions` filter — directories unfiltered, only matching files included

**Description**: The test creates a directory and a `.md` file, then calls with `extensions=[".md"]` and asserts both appear. However, there is no non-matching file (e.g., a `.txt` file) whose absence would confirm the extensions filter is actually working. A result that returns all files regardless of extension would pass this test.

**How to Remedy**: Add a `.txt` file (or other non-matching file) to the test fixture, then assert it does NOT appear in the response after the `extensions=[".md"]` call (e.g., `expect_not_contains("myfile.txt")`). This proves the filter excludes non-matching files while leaving directory entries intact.

**Resolution (2026-04-29)**: Added `notes.txt` written directly to the vault in setup (`ctx.cleanup.track_file` registered for cleanup). F-61 now asserts three conditions: `"Projects/" in result.text` (directory unaffected), `"readme.md" in result.text` (matching file present), and `"notes.txt" not in result.text` (non-matching file excluded). A server ignoring the extension filter would fail the third check. Test passes 3/3 steps.

---

### test_list_vault_format ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-71: `list_vault` with `format: "table"` — file Size column shows human-readable size from `formatFileSize`
- F-73: `list_vault` with `format: "table"` — directory Name column trails with `/`
- F-74: `list_vault` with `format: "table"` — non-recursive Name shows filename/dirname only; recursive Name shows relative path
- F-75: `list_vault` with `format: "table"` — dates use `YYYY-MM-DD` format (no time component)
- F-80: `list_vault` with no `format` parameter behaves like `format: "table"`
- F-81: `list_vault` rejects invalid `format` value (e.g., `"verbose"`) with `isError: true`
- F-82: `list_vault` with `format: "table"` and `show: "directories"` — table contains only directory rows

**Description**:
- F-71: The step for F-71 checks that the file name appears and no path prefix is present — it tests Name column format, not the Size column human-readable value.
- F-73: The step for F-73 only asserts `result.ok and has_notes` — it does not check for a trailing `/` on any directory Name column entry.
- F-74: Only the non-recursive half (filename-only Name) is tested. No recursive call is made to verify relative-path names.
- F-75: The date regex `r"20\d\d-"` matches any 4-digit year followed by a dash. It does not require the full `YYYY-MM-DD` pattern or assert absence of a time component.
- F-80: The step for F-80 calls WITH `format="table"` explicitly — it never calls without the `format` parameter to test the default-equals-table behavior.
- F-81: The step for F-81 calls with `date_field="updated"` and asserts `result.ok` (success) — it never passes an invalid `format` value and never asserts rejection.
- F-82: The step for F-82 calls with `format="table"` only (no `show` parameter) and checks for `"Showing"` in the summary — it does not combine `format="table"` with `show="directories"` to verify only directory rows appear.

**How to Remedy**:
- F-71: Assert that a human-readable size unit appears in the response (e.g., `any(u in result.text for u in ["B", "KB", "MB"])`) for a file entry.
- F-73: Assert that a directory name followed by `/` appears in the Name column, e.g., `expect_contains("subdir/")` where `subdir` is a known directory.
- F-74: Add a recursive call and assert a file in a subdirectory appears with a relative path prefix (e.g., `"subdir/notes.md" in result.text`), not just the filename.
- F-75: Use a stricter regex such as `r"\d{4}-\d{2}-\d{2}"` and assert the pattern is NOT followed by a time component (e.g., no `T` or `:` immediately after the date).
- F-80: Add a step that calls `list_vault(path="/")` without any `format` parameter and asserts `"| Name |" in result.text` — proving the table default applies.
- F-81: Add a step that calls `list_vault(path="/", format="verbose")` (or any invalid format string) and asserts `not result.ok`.
- F-82: Add a step that calls with both `format="table"` and `show="directories"` and asserts file entries do NOT appear in the table rows (e.g., assert a known `.md` filename is absent).

**Resolution (2026-04-29)**: Added `subdir/deep.md` to setup for F-74 recursive test. Seven steps rewritten: F-71 now asserts `any(u in result.text for u in [" B", "KB", "MB", "GB"])` on a `show="files"` call (real size unit proven); F-73 asserts `"subdir/" in result.text` (trailing slash on directory Name); F-74 makes two calls — non-recursive asserts `"notes.md" in text` and no path prefix, recursive asserts `"subdir/deep.md" in text`; F-75 checks `re.search(r"\d{4}-\d{2}-\d{2}", text)` is truthy AND `re.search(r"\d{4}-\d{2}-\d{2}[T ]\d{2}:", text)` is falsy (no time component); F-80 calls without `format` param and asserts `"| Name |" in result.text`; F-81 calls `format="verbose"` (invalid) and asserts `not result.ok`; F-82 calls `format="table", show="directories"` and asserts `"notes.md" not in result.text` AND `"subdir/" in result.text`. Test passes 10/10 steps.

---

### test_list_vault_format_detailed ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-76: `list_vault` with `format: "detailed"` returns key-value pair entries separated by `---`
- F-77: `list_vault` with `format: "detailed"` — file entries include `Size` field with human-readable value
- F-79: `list_vault` with `format: "detailed"` — timestamps use ISO 8601 format
- F-83: `list_vault` with `format: "detailed"` and `show: "all"` — directories grouped first, then files

**Description**:
- F-76: The step for F-76 checks that specific field names appear (`has_title`, `has_path`, `has_fqc_id`) but does not assert the `---` separator between entries, nor verifies the key-value format structure itself.
- F-77: The step for F-77 checks that `"Tracked: false"` appears for an untracked file — it is testing the Tracked field, not the Size field. No human-readable size value is asserted.
- F-79: The step for F-79 only asserts `"---" in result.text` (the separator). No ISO 8601 timestamp format check is performed.
- F-83: The step for F-83 calls with `format="detailed"` (no `show="all"`) and asserts `"Showing" in result.text`. It does not use `show="all"` or assert that directories appear before files.

**How to Remedy**:
- F-76: Add assertions for both the `---` separator (e.g., assert it appears between entries when two or more items are listed) and the key-value format (e.g., verify lines matching `r"^\w+: .+"` pattern appear in the response).
- F-77: Add an assertion that `"Size:" in result.text` and that a size unit (`"B"`, `"KB"`, etc.) follows — for a file entry in the detailed format response.
- F-79: Add a regex assertion for ISO 8601 timestamps, e.g., `re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", result.text)` must be truthy.
- F-83: Add a step that calls with `format="detailed"` AND `show="all"` and asserts that a directory entry appears before a file entry in the response text (i.e., find positions of a known directory marker and a known file marker and assert directory position < file position).

**Resolution (2026-04-29)**: Rewrote four misaligned steps. F-76: replaced `has_title/has_path/has_fqc_id` checks with `has_separator = "---" in result.text` and `has_kv_format = bool(re.search(r"^\w[\w ]+: .+", result.text, re.MULTILINE))` — two files in the listing guarantee the separator must appear; F-77: replaced `"Tracked: false"` with `has_size_field = "Size:" in result.text` and `has_size_unit = any(u in result.text for u in [" B", "KB", "MB", "GB"])` — matches both tracked and untracked file entries which both have a `Size:` field with a unit; F-79: replaced `"---" in result.text` with `bool(re.search(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", result.text))` — all timestamps in detailed format use `.toISOString()` which produces the required pattern; F-83: changed call to add `show="all"` and replaced `"Showing" in result.text` with `dir_pos = result.text.find("Type: directory")`, `file_pos = result.text.find("tracked.md")`, assert `dir_pos < file_pos` — source sorts `[...dirs, ...files]` guaranteeing directory entries precede file entries. Test passes 6/6 steps.

---

### test_list_vault_param_validation ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-92: `list_vault` with `extensions` as bare string (not array) — Zod validation rejects before handler
- F-93: `list_vault` with `limit: 0` — Zod validation rejects (must be positive integer)
- F-94: `list_vault` with `limit: -5` — Zod validation rejects (must be positive integer)
- F-95: `list_vault` with `date_field: "modified"` — Zod validation rejects (must be `"updated"` or `"created"`)

**Description**: The test_list_vault_param_validation.py file's four steps are completely misaligned with their labeled behavior IDs. The mapping as implemented:
- Step labeled F-92 tests invalid `after` date format (`"not-a-date"`) — not `extensions` as bare string.
- Step labeled F-93 tests invalid `before` date format (`"also-bad"`) — not `limit: 0`.
- Step labeled F-94 tests a non-existent directory path — not `limit: -5`.
- Step labeled F-95 tests `recursive=True` on a valid path (success case) — not `date_field: "modified"` rejection.

None of the four behaviors listed in the coverage matrix are actually tested. The file appears to have been created with a different set of behaviors than what ended up in the coverage matrix.

**How to Remedy**: Rewrite all four steps to match the labeled behaviors:
- F-92: Call `list_vault(path="/", extensions="md")` (string, not array) and assert `not result.ok`.
- F-93: Call `list_vault(path="/", limit=0)` and assert `not result.ok`.
- F-94: Call `list_vault(path="/", limit=-5)` and assert `not result.ok`.
- F-95: Call `list_vault(path="/", date_field="modified")` and assert `not result.ok`.

The existing date-validation and path-not-found tests should either be moved to `test_list_vault.py` (under appropriate behavior IDs) or kept here with new coverage IDs added to the matrix.

**Resolution (2026-04-29)**: Rewrote all four steps. Each calls `list_vault` with the invalid parameter value described in the behavior spec and asserts `not result.ok` plus a validation keyword (`any(kw in result.text.lower() for kw in ["invalid", "expected", "must be", "enum"])`). The keyword check distinguishes schema validation rejection from an unrelated server error — it is not tied to a specific Zod error message. The old tests (invalid `after`/`before` date format, non-existent path, recursive success) were removed; path-not-found is already covered by F-84 in `test_list_vault`, and invalid date formats are not currently in the coverage matrix. Test passes 4/4 steps.

---

### test_list_vault_fs_resilience ✓ RESOLVED 2026-04-29

**Behaviors affected**
- F-96: `list_vault` skips inaccessible subdirectory (permission denied) without `isError` — returns results for accessible entries
- F-97: `list_vault` skips unreadable file (stat error) without `isError` — returns results for readable files

**Description**:
- F-96: The test asserts `result.ok` (no error) but does not assert that accessible entries appear in the result. A tool returning an empty successful response would pass.
- F-97: The test asserts `result.ok` only. Additionally, `chmod 000` on a file does not guarantee a `stat()` failure on most Unix systems — the OS can still stat a file (report size, timestamps) without read permission, so the test may not actually exercise the stat-failure code path.

**How to Remedy**:
- F-96: After the call, assert that the accessible directory or files that were readable still appear in the result, e.g., `expect_contains("accessible_file.md")`. This proves the tool returned partial results rather than failing silently or returning empty.
- F-97: For the readable-file case, assert that a known readable file in the same directory still appears in the response. For the stat-failure scenario, consider using a symlink pointing to a non-existent target as a more reliable way to trigger a stat error on all platforms, and assert the tool still returns results for the other files.

**Resolution (2026-04-29)**: F-96: changed call from `show="directories"` to default (`show="all"`) with `recursive=True`, added `accessible_shown = "note.txt" in result.text or "accessible" in result.text` — `note.txt` inside `accessible/` only appears if the tool returned partial results rather than failing or returning empty. F-97: replaced `testfile.md`/`chmod 000` (which does not cause stat errors on macOS) with a broken symlink (`os.symlink("/nonexistent/target_fqc_test", broken_abs)`) — following a broken symlink reliably raises ENOENT; added `readable.md` (normal direct-write file) as the control assertion (`readable_shown = "readable" in result.text`); cleaned up the symlink via `os.unlink()` in a `finally` block instead of `ctx.cleanup.track_file()` (vault cleanup follows symlinks and would reject the absolute target as path traversal). Test passes 2/2 steps.

---

### test_large_vault_scale ✓ RESOLVED 2026-04-29

**Behaviors affected**
- SC-01: Large vault mixed-operation correctness (300+ files with interleaved creates, updates, archives from MCP and external sources)
- SC-02: Large vault search correctness (search indexes remain consistent through constant create/update/archive operations with 300+ files)

**Description**:
- SC-01: The test exercises interleaved operations but final count assertions use loose tolerances (`>= expected - 1`) or only check `result.ok` without comparing actual count to expected. Critically, no `get_document` call is made after `update_document` to confirm updated content is actually reflected — updates may fail silently.
- SC-02: The search step asserts `found_created > 0` (at least one result) and the archive-exclusion check only verifies `result.ok` without asserting that archived docs are absent. A server returning all documents including archived ones would still pass.

**How to Remedy**:
- SC-01: After the update phase, sample a subset of updated documents with `get_document` and assert their content matches the expected post-update value. Replace loose count tolerances with exact assertions, or at minimum assert `actual_count == expected_final` rather than only `result.ok`.
- SC-02: After the archive phase, perform a search and assert `expect_not_contains` for a known-archived document title, or assert the count of results equals the known number of active (non-archived) documents. This directly validates that archived docs are excluded from search indexes under load.

**Resolution (2026-04-29)**: Four changes applied. (1) Step 3 (initial count): `passed=` now includes `initial_count == expected_after_seed` — the count was computed but never checked. (2) Step 6 (count after creates): changed `>= expected - 1` to `== expected` — exact assertion; only the initial pre-seed scan uses `background=False`, which is the only scan that must complete before a count check; Steps 5/8/10 use `background=True` to avoid 30s HTTP timeouts caused by the embedding queue flushing during synchronous scan. (3) New Step 7b: `get_document` on the first updated doc asserts `"updated in-place" in result.text` — unique to the post-update body, absent from the original. (4) Step 11 search: changed `found_created > 0` to `found_created == num_creates` using `count("Title: Created Document")` for precision; Step 12 archive exclusion: added `archived_title not in search_result.text` check — first archived doc's title must not appear. Test passes 27/27 steps.

---

### test_large_memory_scale ✓ RESOLVED 2026-04-29

**Behaviors affected**
- SC-03: Large memory collection mixed operations (1000+ memories with rapid save/update/archive/version → updates apply correctly, versions preserved)

**Description**: Three issues:
1. The default `--memory-count` is 100, not 1000+ as the behavior description requires. The behavior explicitly requires "1000+" operations.
2. Version preservation is not directly asserted — no `get_memory` call is made on a pre-update version ID to confirm the old version still exists in the database.
3. The archive-exclusion check uses `expect_contains("Memory ID")` which passes as long as any non-archived memory is listed, without confirming archived memories are absent.

**How to Remedy**:
1. Increase the default `--memory-count` to at least 1000 (or add a `--scale` flag that enables the 1000+ scenario, and mark the test as requiring it in the coverage notes).
2. After updating a memory, save the old version ID and call `get_memory(memory_ids=old_version_id)` — assert the old version's content is still retrievable.
3. After archiving, call `search_memory` or `list_memories` and assert that archived memory IDs do NOT appear in the results.

**Resolution (2026-04-29)**: Three fixes applied. (1) Default `--memory-count` raised from 100 to 1000; docstring notes that `--memory-count 100` should be used for quick logic checks on remote servers. (2) New Step 5b: calls `get_memory(memory_ids=created_memory_ids[0])` (the original pre-update ID) and asserts `original_marker_present=True` and `updated_absent=True` — proves FlashQuery preserves old versions, not just the latest. (3) Archive loop restructured to target `created_memory_ids[num_updates:]` (non-updated memories), ensuring archive-exclusion IDs have no version ambiguity; Step 7 now asserts `sample_archived_id not in list_result.text` rather than `expect_contains("Memory ID")`. Verified PASS (17/17 steps) with `--memory-count 100`.

---

### test_reconciliation_six_categories

**Behaviors affected**
- RO-02: Reconciliation classifies every document into exactly one of six categories (added/resurrected/deleted/disassociated/moved/modified) plus an unchanged count

✓ RESOLVED 2026-04-29: Added resurrected and unchanged category coverage via a second reconciliation pass. resurrected_doc is deleted in pass 1 (→ archived) then restored to disk and scanned before pass 2 (→ resurrected). unchanged is confirmed via the [RECON] server debug log. The exactly-one constraint is validated as: debug log captured + total_classified >= 5 (exact sum cannot be hard-coded due to sentinel rows created by test-setup tool calls). 19/19 steps pass.

---

### test_reconciliation_content_hash_cascade

**Behaviors affected**
- RO-67: After auto-track writes `fqc_owner`/`fqc_type` frontmatter to disk, `fqc_documents.content_hash` is updated to reflect the post-write file content
- RO-68: After auto-track completes, `last_seen_updated_at` on the new plugin row equals `fqc_documents.updated_at` as of the post-frontmatter-write state — no stale timestamp mismatch

✓ RESOLVED 2026-04-29: Split the combined "RO-67+RO-68+RO-69" assertion into two independent steps. RO-67 is now verified via the scanner debug log: after force_file_scan #2, `scanner.ts` emits `scan: file unchanged: <path>` (line 496) when `hashToRow.get(H)` resolves — i.e., the post-write hash is already in the DB. RO-68+RO-69 are verified by the second reconciliation pass producing no 'Synced fields on N modified'. 11/11 steps pass.

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

### test_list_vault
Covers: F-08, F-09, F-10, F-11, F-53, F-54, F-65, F-66, F-68, F-84, F-85, F-86, F-87, F-88, F-89, F-90, F-91

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

### test_reconciliation_movement
Covers: RO-24, RO-25, RO-26, RO-27

### test_reconciliation_modification
Covers: RO-28, RO-29, RO-30, RO-59

### test_reconciliation_frontmatter_discovery
Covers: RO-31, RO-32

### test_reconciliation_policy_validation
Covers: RO-35, RO-36, RO-60

### test_reconciliation_pending_review
Covers: RO-38, RO-39, RO-40, RO-41

### test_reconciliation_multi_table
Covers: RO-52, RO-54, RO-56 (doc-backed multi-table single-pass), RO-58

### test_reconciliation_non_doc_table_isolation
Covers: RO-56 (non-document-backed table not scanned by reconciliation)
Status: PASS (2026-04-22) — 11/11 steps
Registers a plugin with one document-backed table and one plain relational table. Verifies that after two reconciliation passes the plain table records are untouched (count and status unchanged), and the reconciliation summary never mentions the plain table. One debug iteration to fix UUID extraction regex (create_record returns "Created record <uuid>" not "ID: <uuid>").

### test_reconciliation_untrack_policy
Covers: RO-64
Status: PASS (2026-04-22) — PIR-01 fixed
Previously FAIL_DEFECT: `on_moved: untrack` was falling to a no-op else branch in plugin-reconciliation.ts, leaving the plugin row active after move. Now passes 11/11 steps.

### test_reconciliation_keep_tracking_stability
Covers: RO-65
Status: PASS (2026-04-22) — PIR-09 fixed
Previously FAIL_DEFECT: keep-tracking documents moved outside watched folders were re-classified as `moved` on every subsequent reconciliation pass (infinite re-flag). Path 2 re-discovery now correctly identifies the already-tracked document as `unchanged`. Now passes 13/13 steps.

### test_reconciliation_content_hash_cascade
Covers: RO-67, RO-68, RO-69
Status: PASS (2026-04-22)
All three hash cascade behaviors verified: content_hash is updated to post-write file content after auto-track frontmatter write (RO-67); last_seen_updated_at on the plugin row matches updated_at after the hash update (RO-68); explicit force_file_scan after auto-track produces no spurious modified classification on the subsequent reconciliation (RO-69). Zero debug iterations.

### test_plugin_mixed_tables
Covers: P-16
Status: PASS (2026-04-22)
Registers a plugin with one document-backed table (`track_as`, watched folder) and one plain relational table. Verifies no DDL errors on registration, both tables appear in `get_plugin_info`, and records can be created and retrieved in both table types. Note: user-defined column names must not collide with FQC's implicit reserved columns (`id`, `fqc_id`, `instance_id`, `path`, `status`). Two debug iterations to fix a test-authoring column name conflict.

### test_reconciliation_background_scan_cache
Covers: RO-70
Status: PASS (2026-04-22)
Verifies that a background `force_file_scan` does not prematurely consume the staleness cache before the scan completes. Flow: establish staleness cache via initial record tool call → drop a new file into the watched folder via raw vault write → trigger background scan → sleep 5s → call `search_records` → assert the reconciliation response includes "Auto-tracked" for the new file, proving a full diff ran against the post-scan fqc_documents state. Zero debug iterations.

### test_reconciliation_resurrection_with_on_moved
Covers: RO-71, RO-72
Status: PASS (2026-04-22) — 26/26 steps
Both resurrection+on_moved policies verified end-to-end: untrack nets an archived plugin row (RO-71), keep-tracking leaves the row active at the new out-of-folder path (RO-72).

### test_reconciliation_policy_edge_cases
Covers: RO-66, RO-73
Status: PASS (2026-04-22) — 6/6 steps
RO-66: invalid `on_moved` value correctly rejected at `register_plugin` time. RO-73: Path 2 pending review rows include the plugin's canonical folder, enabling downstream skills to identify where out-of-folder documents should live.

### test_reconciliation_discovery_at_scale
Covers: RO-51, RO-62, RO-63
Status: PASS (2026-04-22) — 6/6 steps
Verified with 1,010 documents (above the former 1,000-row Supabase default cap). Server log confirms `added=1010` for both Path 1 (watched folder) and Path 2 (ownership_type) candidate queries. RO-62 confirmed: zero false `deleted` classifications on second reconciliation pass. Test uses log-based assertion for the discovery count since auto-tracking 1,010 files via frontmatter write-back exceeds the 30s HTTP timeout; the [RECON] debug line is emitted before write-back actions begin and is authoritative for the discovery check.

### test_reconciliation_spurious_sync_fields
Covers: RO-74
Status: PASS (2026-04-22) — PIR-02 fixed
Previously FAIL: "Synced fields on 1 modified" appeared on the second reconciliation pass after auto-track. Two root causes: (1) `pg` returns `Date` objects for `TIMESTAMPTZ` columns; reference inequality (`Date !== Date`) caused every document with a plugin row to classify as `modified` on every pass — only visible when `on_modified: sync-fields` is configured because other policies produce no observable signal. Fixed by setting `pg.types.setTypeParser` in `pg-client.ts` to return ISO strings. (2) Scanner's EMBED-DRAIN Phase 2 was bumping `updated_at` when writing embeddings, which is not a content change. Fixed by removing `updated_at` from that update in `scanner.ts`. Now passes 8/8 steps.

### test_plugin_explicit_fqc_id
Covers: P-17
Status: PASS (2026-04-22) — PIR-03 fixed
Previously FAIL: Postgres rejected registration with "column fqc_id specified more than once" when a plugin schema explicitly declared `fqc_id` as a user column. Fixed by adding a `userColNames` set in `buildPluginTableDDL()` (`manager.ts`) and filtering implicit columns whose names collide with user-defined ones before concatenation. Now passes 2/2 steps.

### test_reconciliation_discovery_path_context
Covers: RO-75
Status: PASS (2026-04-22) — PIR-04 fixed
Previously FAIL: `discoveryPath` key was absent from pending review context JSONB. Fixed by adding `discoveryPath` and `designatedFolder` fields to the `DocumentInfo` interface, tracking Path 2 fqcIds in a `path2FqcIds` set, and writing `discoveryPath` into the pending review context in `plugin-reconciliation.ts`. Also fixed a test-side assertion bug: the original regex (`Context: {...}`) could not match the quoted-key JSON format (`"context": {...}`) emitted by the server; replaced with direct JSON array parsing. Now passes 6/6 steps.

### test_create_directory
Covers: F-19, F-20, F-21, F-22, F-29

### test_create_directory_batch
Covers: F-23, F-24, F-25

### test_create_directory_root_path
Covers: F-26, F-27, F-28

### test_create_directory_normalization
Covers: F-30, F-31, F-32

### test_create_directory_sanitization
Covers: F-33, F-34, F-35, F-36

### test_create_directory_rejection
Covers: F-37, F-38, F-39, F-40, F-41, F-42, F-43, F-44, F-45, F-46, F-47, F-48, F-49

### test_create_directory_special
Covers: F-50, F-51, F-52

### test_list_vault_directories
Covers: F-55, F-56, F-57, F-58, F-62, F-63, F-64, F-67

### test_list_vault_all
Covers: F-59, F-60, F-61

### test_list_vault_format
Covers: F-69, F-70, F-71, F-72, F-73, F-74, F-75, F-80, F-81, F-82

### test_list_vault_format_detailed
Covers: F-76, F-77, F-78, F-79, F-83

### test_list_vault_param_validation
Covers: F-92, F-93, F-94, F-95

### test_list_vault_fs_resilience
Covers: F-96, F-97

### test_call_model_by_model
Covers: L-01

### test_call_model_by_purpose
Covers: L-02

### test_llm_cost_tracking
Covers: L-03

### test_call_model_errors
Covers: L-05, L-06

### test_call_model_params
Covers: L-08

### test_call_model_resolution_edge_cases
Covers: L-04, L-07

### test_call_model_bad_provider_param
Covers: L-09

### test_call_model_cost_strict
Covers: L-10, L-11

### test_llm_usage_filters
Covers: L-12, L-13, L-14

---

## PIR Regression Guard Tests — Resolution (2026-04-22)

All four PIR regression guard tests were written on 2026-04-22 to expose confirmed unfixed bugs, then fixed and verified passing the same day. The notes below document why each existing test missed the bug, what the regression guard tests differently, and what was ultimately fixed.

### test_reconciliation_background_scan_race
Covers: RO-76
Status: PASS (2026-04-22) — PIR-05 fixed
Previously FAIL: intermediate record tool call during the background scan consumed the freshly-invalidated cache (cache was cleared before scan started), leaving the post-scan call within the 30s staleness window — new file never seen. Fixed by moving `invalidateReconciliationCache()` to the `.then()` continuation after `runScanOnce()` in `scan.ts`. Also increased test scan wait from 6s to 30s to accommodate remote Supabase latency with 100 bulk files (~25s on hosted Supabase). Now passes 9/9 steps.

---

## PIR Regression Guard Tests — Resolution (2026-04-22)

All four PIR regression guard tests were written on 2026-04-22 to expose confirmed unfixed bugs, then fixed and verified passing the same day. The notes below document why each existing test missed the bug, what the regression guard tests differently, and what was ultimately fixed.

### test_reconciliation_spurious_sync_fields
Covers: RO-74
Status: RESOLVED (2026-04-22) — PIR-02 fixed, all 8 steps pass

**Why the existing test (test_reconciliation_content_hash_cascade) passed despite the bug:**
That test uses `on_modified: ignore`. A spurious `modified` classification under `ignore` produces no observable signal — the summary only emits "Synced fields on N modified" when sync-fields fires. The test checked for absence of that string and found none even when the bug was classifying every doc as `modified` on every pass.

**What this test does differently:**
Uses `on_modified: sync-fields` so a spurious `modified` produces a visible "Synced fields on 1 modified" in the summary. Sequence: register → drop file → sync scan → search_records (auto-track) → sync scan → wait 32s → search_records → assert "Synced fields on" absent.

**What was fixed:**
Two root causes. Primary: `pg` returns `Date` objects for `TIMESTAMPTZ` columns; reference inequality (`a !== b` even for equal dates) caused every doc with a plugin row to classify as `modified`. Fixed by setting `pg.types.setTypeParser(1184/1114)` in `pg-client.ts` to return ISO strings. Secondary: scanner's EMBED-DRAIN Phase 2 was bumping `fqc_documents.updated_at` when writing embeddings (not a content change). Fixed by removing `updated_at` from that update in `scanner.ts`.

---

### test_plugin_explicit_fqc_id
Covers: P-17
Status: RESOLVED (2026-04-22) — PIR-03 fixed, all 2 steps pass

**Why the existing test (test_plugin_mixed_tables) passed despite the bug:**
That test was rewritten during authoring to avoid naming any user column `fqc_id`, per an authoring note: "user-defined column names must not collide with FQC's implicit reserved columns." That workaround prevented the collision and made the defect invisible.

**What this test does differently:**
Explicitly declares `fqc_id UUID REFERENCES fqc_documents(id)` as a user column on the document-backed table — the §8.4.7 CRM plugin pattern. Asserts registration succeeds with no DDL error.

**What was fixed:**
Added a `userColNames` set in `buildPluginTableDDL()` (`manager.ts`) that filters implicit columns whose names collide with user-defined columns before concatenation.

---

### test_reconciliation_discovery_path_context
Covers: RO-75
Status: RESOLVED (2026-04-22) — PIR-04 fixed, all 6 steps pass

**Why the existing test (test_reconciliation_policy_edge_cases / RO-73) passed despite the bug:**
That test asserted the canonical folder string appears in the `clear_pending_reviews` response. It did — `policy.folder` was already written into the context JSONB. The test passed without `discoveryPath` ever existing.

**What this test does differently:**
Asserts specifically on the `discoveryPath` key in the parsed context JSONB — not just the folder string. Uses a Path 2 setup (doc outside canonical folder with `fqc_type` frontmatter).

**What was fixed:**
Added `discoveryPath` and `designatedFolder` to the `DocumentInfo` interface, tracked Path 2 fqcIds in a `path2FqcIds` set during classification, and wrote `discoveryPath` into pending review context in `plugin-reconciliation.ts`. Also fixed a test-side assertion bug: the original regex (`Context: {...}`) could not match the quoted-key JSON format (`"context": {...}`) emitted by the server; replaced with direct JSON array parsing.

---

### test_reconciliation_background_scan_race
Covers: RO-76
Status: RESOLVED (2026-04-22) — PIR-05 fixed, all 9 steps pass

**Why the existing test (test_reconciliation_background_scan_cache / RO-70) passed despite the bug:**
That test sleeps 5 seconds after triggering the background scan, then makes a single record tool call. No call is made in the race window, so the intermediate-call-consuming-the-cache scenario never triggered.

**What this test does differently:**
Pre-populates 100 bulk files (non-watched) to force the scan to take ≥2s. Makes an intermediate `search_records` call immediately after the background scan trigger, while the scan is still running — this is the race window. A third call after a 30s wait asserts "Auto-tracked" for the new file.

**What was fixed:**
Moved `invalidateReconciliationCache()` to the `.then()` continuation after `runScanOnce()` in both background and sync modes in `scan.ts`. Test scan wait increased from 6s to 30s to accommodate remote Supabase latency for 100-file scans (~25s observed).

## 15. Native LLM Access

Behaviors verifying the `call_model` and `get_llm_usage` MCP tools introduced in milestone v3.0. These tools require `llm:` configuration in `flashquery.yml` and a Supabase connection for cost tracking.

### 15.1 get_llm_usage MCP tool (Phase 103)

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-18 | get_llm_usage summary mode returns total_calls, total_spend_usd, avg_cost_per_call_usd, avg_latency_ms, top_purpose, top_model_name, vs_prior_period (REPT-02) | test_get_llm_usage_summary | 2026-04-29 |  |
| L-19 | get_llm_usage by_purpose excludes _direct rows from purposes array; surfaces them in direct_model_calls (REPT-02 / D-08) | test_get_llm_usage_by_purpose | 2026-04-29 |  |
| L-20 | get_llm_usage by_model returns per-model entries with pct_of_total_calls, avg_fallback_position, spend_usd, avg_cost_per_call_usd, avg_latency_ms (REPT-02 / D-10, D-11) | test_get_llm_usage_by_model | 2026-04-29 |  |
| L-21 | get_llm_usage recent returns newest-first entries respecting `limit` parameter; each entry has D-12 fields | test_get_llm_usage_recent | 2026-04-29 |  |
| L-22 | get_llm_usage `trace_id` filter narrows results to matching calls only (REPT-01) | test_get_llm_usage_trace | 2026-04-29 |  |

### 15.2 Embedding Migration (Phase 104)

| ID | Behavior | Covered By | Date Updated | Last Passing |
|----|----------|------------|--------------|--------------|
| L-23 | Embedding semantic search works end-to-end when routed through the `embedding` purpose — save_memory + search_memory return results matching the seed entry (EMBED-01) | test_embedding_migration | 2026-04-29 |  |
