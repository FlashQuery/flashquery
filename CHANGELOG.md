# Changelog

All notable changes to FlashQuery will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-04-25

This release introduces native filesystem navigation to the vault. The new `create_directory` and `list_vault` tools give AI agents direct control over vault structure, replacing `list_files` with a significantly more capable listing interface that supports filtering by type, date, extension, and format.

### Added
- `create_directory` MCP tool for creating subdirectories within the vault, with path traversal protection and conflict detection
- `list_vault` MCP tool for browsing vault files and directories with filtering by date, type, and subdirectory
- `remove_directory` tool migrated from `documents.ts` to the new filesystem module (`files.ts`) with vault-root guard
- Shared path-validation utilities (`src/mcp/utils/path-validation.ts`): sanitization, illegal-character detection, null-byte rejection, and 4096-byte path length enforcement
- Response-format utilities: `formatTableHeader`, `formatTableRow`, `formatFileSize`, `parseDateFilter`
- Filesystem integration test suite covering 16 composition scenarios (IF-01..IF-16)
- Directed scenario test coverage for `create_directory` (34 scenarios) and `list_vault` (F-08..F-97)

### Changed
- `remove_directory` is now part of the filesystem tool group alongside `create_directory` and `list_vault`

### Removed
- `list_files` tool replaced by the more capable `list_vault`

### Fixed
- Path traversal edge case in `create_directory` when a segment contains null bytes
- Sanitization trigger condition in `sanitized_directory_usable` that failed to activate on certain illegal character inputs
- `remove_directory`: vault-root guard now applied before path validation, preventing removal of the vault root
- Path bug in IF-03 filesystem integration test
- `SIGHUP` now triggers graceful shutdown; previously an unhandled `SIGHUP` caused Node.js to exit immediately, bypassing the shutdown coordinator and leaving Supabase connections and the git mutex in an inconsistent state

## [1.0.0] - 2026-04-23 (INITIAL OPEN SOURCE RELEASE)

### Added
- TypeScript ESM scaffold with `flashquery` CLI entry point
- YAML configuration system with Zod validation and `${ENV_VAR}` expansion
- Structured logging with stdout and file output, configurable log levels
- Supabase connection with pgvector support and two-client architecture (anon + service-role)
- Vault initialization with markdown project hierarchy and gray-matter frontmatter parsing
- Embedding providers: OpenAI, OpenRouter, Ollama
- MCP server with stdio transport — memory tools: `save_memory`, `search_memory`, `list_memories`, `list_projects`
- MCP document tools: `create_document`, `get_document`, `search_documents`
- MCP project tools: `get_project_info`
- Compound tools: `append_to_doc`, `update_doc_header`, `insert_doc_link`, `apply_tags`, `get_briefing`, `get_doc_outline`
- Relational record CRUD via plugin system with dynamic table creation
- Git integration with fire-and-forget vault commits and optional auto-push
- Unified taxonomy with tag synchronization, archive lifecycle, and memory versioning
- Discrepancy detection (`flashquery scan`) for vault/database integrity checks
- HTTP transport support via `flashquery start --transport http`
- Docker and Docker Compose configurations for full-stack, FlashQuery-only, and db-only deployments
- Interactive `setup.sh` script for guided first-run deployment
- CI/CD pipeline with GitHub Actions (lint, test, publish, Docker smoke test)
- MCP client configuration examples for Claude Desktop, Claude Code, and Cursor (stdio and HTTP)
- Community health files: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.env.example`
- Apache 2.0 license with `NOTICE`, `CLA.md`, and `CLA-CORPORATE.md`
- `npm run preflight` script and pre-push skill for CI validation before pushing
- Demo CRM plugin as reference implementation with integration tests

### Fixed
- `search_memory` and `search_all` degrade gracefully when the embedding API is unreachable
- 59 integration test failures from frontmatter field renames and MCP protocol corrections
- 10 macOS-only unit test failures in git-manager and compound tools
- Supabase builder type narrowing in the vault scanner
- Package renamed from `flashquery-core` to `flashquery`; binary standardized to `flashquery`

### Security
- Credential management via environment variables; `.gitignore` blocks `.env` commits
- DNS rebinding protection for HTTP transport
- Session cleanup on TCP disconnect for HTTP transport
- Vulnerability reporting policy in `SECURITY.md` with 48-hour response SLA

---

[Unreleased]: https://github.com/FlashQuery/flashquery/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/FlashQuery/flashquery/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/FlashQuery/flashquery/releases/tag/v1.0.0
