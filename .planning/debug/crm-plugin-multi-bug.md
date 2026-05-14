---
status: resolved
trigger: CRM plugin test session - multiple failures: registry insert type error, EISDIR, stale tags, table not found
created: 2026-04-09T17:00:00Z
updated: 2026-05-14T03:05:00Z
---

## Current Focus

hypothesis: All four bugs identified and fixed
test: Code review of applied fixes and manual verification steps
expecting: User confirms fixes resolve original test case issues
next_action: User to re-run original CRM plugin test with fixes applied

## Closeout

Resolved as stale artifact during v3.3 milestone close. The CRM/plugin/record surfaces have since been rebuilt and verified through Phases 126 and 128, including plugin and record consolidation, final surface cleanup, and scenario coverage.

## Symptoms

expected: 
- Plugin registers with version 0.1.0 stored correctly in database
- Documents created in CRM/Contacts/ directory should not conflict with existing directory
- No legacy tags like #status/active should appear in generated content
- Plugin tables should be queryable immediately after registration

actual: 
- Registry insert fails with integer type error for version string "0.1.0"
- create_document fails with EISDIR when path is existing directory
- Generated Alex Jablonsky doc includes #status/active tag in vault and database record
- search_records and create_record fail with "table not found" before re-registration
- After re-registration, tables work but plugin_registry table remains empty

errors: 
- EISDIR: illegal operation on a directory, rename '/Users/matt/Documents/Obsidian/Vault/CRM/Contacts.fqc-tmp' -> '/Users/matt/Documents/Obsidian/Vault/CRM/Contacts'
- WARN register_plugin: registry insert failed: invalid input syntax for type integer: "0.1.0"
- ERROR search_records failed: Plugin 'crm' instance 'default' table 'contacts' not found
- ERROR create_record failed: Plugin 'crm' instance 'default' table 'contacts' not found
- Tag issue: #status/active appears in Alex Jablonsky document despite being removed in prior phase

started: 2026-04-09 15:19:09 UTC during plugin test session

## Eliminated

(none yet)

## Evidence

- timestamp: 2026-04-09T17:00:15Z
  checked: Symptom classification
  found: Four distinct failure modes suggest separate bugs rather than cascade
  implication: Need to investigate each independently, prioritize by blockage (registry type error blocks everything)

- timestamp: 2026-04-09T17:02:30Z
  checked: Plugin registry schema in src/storage/supabase.ts:298
  found: schema_version column defined as INTEGER, not TEXT/VARCHAR
  implication: BUG #1 ROOT CAUSE - Line 158 in plugins.ts inserts schema.plugin.version (string "0.1.0") into INTEGER column, causing "invalid input syntax for type integer" error

- timestamp: 2026-04-09T17:03:45Z
  checked: vault.ts writeMarkdown and path handling (lines 120-144)
  found: mkdir creates intermediate directories (line 130), then rename tries to rename temp file to absolutePath (line 144). When relativePath is directory path like "CRM/Contacts", mkdir succeeds but rename fails with EISDIR
  implication: BUG #2 ROOT CAUSE - writeMarkdown doesn't validate that relativePath is a file path, not directory. When path parameter omitted and defaults to folder, mkdir treats "CRM/Contacts.fqc-tmp" → "CRM/Contacts" as directory rename, fails

- timestamp: 2026-04-09T17:04:20Z
  checked: CRM add-contact skill documentation (fqc-crm-plugins line 72)
  found: Skill explicitly instructs to pass tags: ["#status/active"] to create_document
  implication: BUG #3 ROOT CAUSE - Outdated skill documentation. Status tags were removed in phase 31. Skill needs update to remove #status/active from tag list

- timestamp: 2026-04-09T17:05:30Z
  checked: Plugin tables "not found" error and flow sequence (plugins.ts lines 156-178)
  found: DDL executes successfully (creates tables), but then registry INSERT fails (line 158) due to schema_version type error. Then pluginManager.loadEntry happens at line 173, AFTER failed insert. But database insert error is logged as WARN, not thrown, so loadEntry still executes. However, if insert fails, the entry isn't persisted to DB, so subsequent server restarts can't reload it.
  implication: BUG #4 ROOT CAUSE - Cascade failure: registry insert fails (Bug #1) → database record never created → on server restart, initPlugins finds no registry row → pluginManager has no entry → subsequent create_record/search_records fail with "table not found" even though tables exist in DB. BUT: in same session before restart, pluginManager.loadEntry DOES execute at line 173, so tables should be found. Error timeline suggests tables work after re-registration (line 101 in error log says "tables work"), supporting this analysis.

## Resolution

root_cause: Four distinct bugs identified
  1. schema_version column type INTEGER but code inserts string "0.1.0" → type error, registry row not created, persistence broken across restarts
  2. create_document doesn't validate relativePath is file not directory → EISDIR when path is directory
  3. CRM add-contact skill documentation outdated, still references #status/active tag removed in phase 31
  4. Caused by #1: Plugin tables created in DB but not persisted to plugin_registry, so initPlugins can't reload them on restart (tables found in same session via in-memory loadEntry, but lost on restart)

fix: APPLIED
  1. FIX #1 - src/storage/supabase.ts line 298: Changed schema_version column from INTEGER to TEXT, default '1.0.0'. Added Phase 40 migration to convert existing INTEGER columns to TEXT safely.
  2. FIX #2 - src/mcp/tools/documents.ts: Added stat import, added directory validation check in create_document path handling (lines 299-319). Rejects directory paths with helpful error message.
  3. FIX #3 - flashquery-core-plugins/apps/fqc-crm/skills/add-contact/SKILL.md line 72: Updated tag documentation to remove #status/active instruction. Now advises "Do not include status tags — those are managed by the system."

verification: READY
files_changed: 
  - /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-core/src/storage/supabase.ts
  - /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-core/src/mcp/tools/documents.ts
  - /Users/matt/Documents/Claude/Projects/FlashQuery/flashquery-core-plugins/apps/fqc-crm/skills/add-contact/SKILL.md
