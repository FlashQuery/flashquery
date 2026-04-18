# ARCHITECTURE.md Review Checklist

**Purpose:** Ensure ARCHITECTURE.md remains accurate and reflects current system design, deployment options, and code structure.

**Trigger:** After completing a phase with architectural or deployment changes, before marking phase complete, run this review.

**Duration:** 15-20 minutes. Verify each section against current code.

## Document Structure

- [ ] Document begins with overview section
- [ ] Contains system design diagrams or ASCII representations
- [ ] All 4 deployment paths are documented (Docker full, Docker Supabase-only, Local Docker, Standalone)
- [ ] Contains data model/schema overview
- [ ] Contains MCP tools reference
- [ ] Version number matches package.json

## Overview Section

- [ ] Describes FlashQuery's purpose (data management layer for AI)
- [ ] Mentions all major data types (memory, documents, vault, projects, records)
- [ ] Explains the MCP server architecture
- [ ] Mentions Supabase as backend
- [ ] Mentions vault as Git-backed markdown folder

## Deployment Paths

### Path 1: Docker Compose (Full Stack)
- [ ] docker-compose.yml exists and path is correct
- [ ] Includes Supabase, Kong gateway, Postgres, PostgREST, GoTrue
- [ ] Environment variables documented
- [ ] Startup sequence explained
- [ ] Example .env file referenced or shown
- [ ] Port mappings are accurate (5432, 8000, 8080, etc.)

### Path 2: Docker Compose (Supabase Only)
- [ ] docker-compose.db-only.yml exists and path is correct
- [ ] Includes Postgres + pgvector, PostgREST, GoTrue only
- [ ] Kong is omitted (direct port access)
- [ ] Configuration differences from full stack explained
- [ ] Use case explained (local development)

### Path 3: Local Docker (External Supabase)
- [ ] Docker container runs FlashQuery app only
- [ ] Supabase instance (local or cloud) configured externally
- [ ] Environment variables needed are documented
- [ ] Connection steps are clear
- [ ] Prerequisite (Supabase instance) explained

### Path 4: Standalone (No Docker)
- [ ] Node.js installation instructions are accurate
- [ ] npm install and build steps documented
- [ ] setup.sh script is referenced
- [ ] Manual Supabase setup steps documented
- [ ] Environment variable setup explained

## Data Model / Schema Section

- [ ] All 5 core tables are documented:
  - [ ] fqc_memory (with embedding columns)
  - [ ] fqc_documents (with content_hash, embedding)
  - [ ] fqc_projects
  - [ ] fqc_plugin_registry
  - [ ] fqc_plugin_logs
- [ ] Primary keys and relationships shown
- [ ] Vector column (pgvector) is mentioned
- [ ] Embedding dimensions documented (if configurable)
- [ ] Any optional v1.5 columns (versioning, archival) documented

## Component Architecture

### MCP Server
- [ ] Purpose and role explained
- [ ] Transport options listed (stdio at v1.5, HTTP as option)
- [ ] Tool registration lifecycle documented
- [ ] Error handling approach described

### CLI Commands
- [ ] `flashquery start` purpose and options documented
- [ ] `flashquery backup` behavior and options documented
- [ ] `flashquery scan` purpose and usage documented
- [ ] `--help` flag output matches documentation

### Core Services
- [ ] Config service documented (Zod validation, YAML loading)
- [ ] Supabase service documented (connection, schema setup)
- [ ] Vault service documented (filesystem, Git operations)
- [ ] GitManager documented (commit, push workflow)
- [ ] Embedding service documented (provider options, async)

### MCP Tools (by category)
- [ ] Memory tools (save_memory, search_memory, list_memories, etc.)
- [ ] Document tools (create_document, get_document, search_documents, etc.)
- [ ] Project tools (list_projects, etc.)
- [ ] Plugin tools (register_plugin, get_plugin_info, etc.)
- [ ] Record tools (create_record, get_record, search_records, etc.)
- [ ] Compound tools (get_briefing, get_doc_outline, etc.)

## Configuration Section

### flashquery.yaml Schema
- [ ] All required fields documented
- [ ] All optional fields and defaults shown
- [ ] Embedding provider options documented (OpenAI, OpenRouter)
- [ ] Log level options explained
- [ ] Vault path behavior explained
- [ ] Project configuration structure shown

### Environment Variables
- [ ] .env.example path referenced
- [ ] All required env vars listed
- [ ] OpenAI/OpenRouter API key setup explained
- [ ] Supabase connection vars documented
- [ ] Docker-specific vars explained

### Example Configuration
- [ ] flashquery.yaml.example exists and path is correct
- [ ] Example includes all major sections
- [ ] Environment variable references use correct syntax ($VAR_NAME)
- [ ] Example is valid YAML (no syntax errors)
- [ ] Comments explain each section

## Data Flow Section

- [ ] MCP tool → Supabase writes documented
- [ ] Vault writes (Git commits) documented
- [ ] Embedding pipeline (async fire-and-forget) documented
- [ ] Document discrepancy detection (scan command) documented
- [ ] Tag synchronization (frontmatter ↔ Supabase) documented
- [ ] Plugin registration and tool loading documented

## File Structure

- [ ] `.claude/skills/` directory pattern explained
- [ ] Plugin structure (schema.yaml, skills/) shown
- [ ] flashquery-core/src/ structure documented:
  - [ ] /cli — CLI commands
  - [ ] /config — Config validation
  - [ ] /mcp — MCP server and tools
  - [ ] /services — Core services
  - [ ] /types — TypeScript types

## Extensibility / Plugin System

- [ ] Plugin registration process documented
- [ ] Plugin schema YAML format shown
- [ ] CRM plugin as example referenced
- [ ] How to add custom tables documented
- [ ] Custom MCP tools from plugins explained

## Security Considerations

- [ ] Database security (connection strings, role isolation)
- [ ] API key security (environment variables, .env.example)
- [ ] JWT auth with Supabase explained
- [ ] Service role key usage (admin operations) documented
- [ ] Any DNS rebinding protection (HTTP transport) noted

## Troubleshooting Section (if present)

- [ ] Common setup issues addressed
- [ ] Connection timeout debugging explained
- [ ] Embedding provider errors documented
- [ ] Docker networking issues addressed
- [ ] Vault Git errors explained

## Links and References

- [ ] Link to README.md works
- [ ] Link to CONTRIBUTING.md works
- [ ] Link to plugin documentation works
- [ ] Link to MCP specification works (if external)
- [ ] All relative paths are correct

## Version and Update Notes

- [ ] Version number at top matches package.json
- [ ] "Last Updated" timestamp is recent (within phase completion)
- [ ] Major version changes documented (if any)
- [ ] Breaking changes documented (if any)

## Issue Reporting

If you find an issue:
1. Note which checklist item failed
2. Describe the issue (what is wrong vs. what should it be?)
3. Check if the code or the docs are wrong (don't assume docs are wrong first!)
4. Research code to verify (check actual implementation files)
5. Record findings in phase SUMMARY.md

**Minor issues** (typos, version number bump): Fix directly in ARCHITECTURE.md.

**Moderate issues** (outdated path, wrong port number): Verify in code first, then fix docs if code is correct.

**Major issues** (entire section is wrong, missing major component): Report as blocker; may require code changes too.

---

**How to use this skill:**
1. Open ARCHITECTURE.md
2. Go through each section, comparing to actual code
3. Test relevant configuration steps if code changed
4. Record findings in phase SUMMARY.md
5. Fix minor issues, escalate major issues
