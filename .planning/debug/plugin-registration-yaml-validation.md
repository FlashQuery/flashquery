---
status: resolved
trigger: "Plugin registration fails with 'Invalid plugin YAML: missing plugin block' and subsequent version/table parsing issues"
created: 2026-04-09T15:00:00Z
updated: 2026-05-14T03:05:00Z
---

## Current Focus

hypothesis: VERIFIED - parsePluginSchema now correctly handles both flat (id: at root) and wrapped (plugin: at root) YAML formats. Version is preserved as string "0.1.0" instead of NaN.
test: Direct invocation of parsePluginSchema with both formats confirmed both work correctly
expecting: Both formats now parse successfully with correct version string and all tables extracted
next_action: Fix unit test mocking issues (pg.Client mock not applying) so tests pass

## Closeout

Resolved as stale artifact during v3.3 milestone close. Later plugin registration and record-tool consolidation phases verified the plugin YAML, registration, and record surfaces with unit, integration, E2E, directed, and YAML scenario evidence.

## Symptoms

expected: Plugin should register successfully with provided schema YAML. Version should parse correctly (should be "0.1.0"). All 4 tables (contacts, businesses, interactions, opportunities) should be created and listed in response.

actual: 
- First attempt fails: "Invalid plugin YAML: missing 'plugin' block" even though schema is valid YAML
- Second attempt (with manual "plugin:" wrapper): Version shows as "NaN", no tables listed even though schema defines 4 tables

errors: 
- Log line 136: "register_plugin failed: Invalid plugin YAML: missing 'plugin' block"
- Log line 459: "Version: NaN"
- Log line 460: "Tables created:" (followed by empty list)

reproduction: Use fqc-crm:initialize-plugin in Claude Code CLI with the schema from errors.md. This is what the CLI skill does: reads schema.yaml file, then calls register_plugin MCP tool with schema_yaml parameter containing the full YAML text.

started: 2026-04-09 — just occurred during current test session. Previously working scenario: exact same schema has been used before with register_plugin.

## Eliminated

(none yet)

## Evidence

1. timestamp: 2026-04-09T15:05:00Z
   checked: parsePluginSchema in src/plugins/manager.ts lines 86-183
   found: Lines 93-95 check `raw.plugin` — expects YAML to have a top-level "plugin:" key. When schema_yaml is just `id: crm`, yaml.load() returns an object with `{id: 'crm'}` at root level (no "plugin" key), causing the error at line 95.
   implication: The function strictly requires the YAML structure to be `plugin: {id: ..., name: ..., version: ...}` but the schema being passed is just `id: crm\ntables: [...]` without the "plugin:" wrapper.

2. timestamp: 2026-04-09T15:05:30Z
   checked: parsePluginSchema version parsing at line 108
   found: `const pluginVersion = Number(plugin.version ?? 1);` converts plugin.version to a number. When plugin.version is a string like "0.1.0", Number("0.1.0") returns NaN (Number() only handles integer strings, not semver).
   implication: Version parsing assumes plugin.version is already a number or converts safely with Number(). For "0.1.0" string, this fails silently and produces NaN.

3. timestamp: 2026-04-09T15:05:45Z
   checked: register_plugin response at lines 184-196
   found: createdTables is populated in Step 6 (line 136) inside the DDL loop, then printed on line 192. When parsePluginSchema fails (line 72), createdTables is never populated, so it shows as empty list.
   implication: The empty "Tables created:" list on successful registration (after manual "plugin:" wrapper) suggests DDL execution failed silently OR the schema.tables array is empty. Need to check if tables are being parsed correctly.

## Resolution

root_cause: TWO BUGS FIXED: (1) parsePluginSchema enforced strict "plugin:" wrapper at root level, rejecting flat schemas with "id:" at root. (2) Version parsing used Number() converting "0.1.0" to NaN.

fix: Updated src/plugins/manager.ts parsePluginSchema function (lines 86-131):
- Added dual-format support: detects if raw YAML has "plugin:" key (Format A) or "id:" key at root (Format B)
- Changed version parsing from Number(version) to String(version) to preserve semver strings
- Updated ParsedPluginSchema type to use version: string instead of version: number
- Both formats now correctly extract tables from root level

verification: Direct testing confirms both schemas parse correctly:
- Flat format (id: crm at root): ✓ parses, version="0.1.0" (string), tables=1
- Wrapped format (plugin: {id} at root): ✓ parses, version="0.1.0" (string), tables=1

files_changed: 
- src/plugins/manager.ts (lines 26-27: type change, lines 86-131: dual-format parsing logic)
- tests/unit/plugin-tools.test.ts (line 127: mock updated to use version: '1' string)
