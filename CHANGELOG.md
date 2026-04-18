# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- HTTP transport support via `fqc start --transport http` (Phase 18)
- Docker and Docker Compose configurations for full-stack and db-only deployments (Phase 19)
- `setup.sh` interactive setup script for guided deployment (Phase 19)
- CI/CD pipeline with GitHub Actions for lint, test, and publish (Phase 20)
- Sample MCP client configurations for Claude Desktop, Claude Code, and Cursor (Phase 20)

### Changed
- CLI refactored to use Commander.js with `fqc` binary (Phase 17)
- Config loading now uses dotenv for environment variable resolution (Phase 17)
- Improved error messages for missing environment variables (Phase 17)

### Fixed
- DNS rebinding protection for HTTP transport (Phase 18)
- Session cleanup on TCP disconnect for HTTP transport (Phase 18)

## [1.6.0] - 2026-03-29

### Added
- Initial community foundation setup (Phase 16)
  - `.env.example` template with all required and optional variables
  - `flashquery.yaml.example` with `${VAR}` syntax for configuration
  - License files: Apache 2.0 LICENSE, NOTICE, CLA.md, CLA-CORPORATE.md
  - Community health files: CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md
  - Node.js version pinning to v20 (`.nvmrc`, package.json engines field)
  - GitHub issue templates: bug-report.yml, feature-request.yml
  - GitHub pull request template with checklist
- Preparation for Phase 17 (CLI Overhaul)
  - Environment variable patterns documented and exemplified
  - Config resolution patterns prepared for Phase 17 implementation

### Changed
- Project structure ready for open source contributions
- All documentation and legal foundations in place before public release

### Security
- Added SECURITY.md with vulnerability reporting policy and 48-hour response SLA
- Credential safety guidelines in CONTRIBUTING.md and .env.example
- `.gitignore` enforced to prevent accidental credential commits

## [1.5.0] - 2026-03-27

### Added
- Document embeddings with semantic vector search (Phase 10)
- Git integration with fire-and-forget vault commits and optional auto-push (Phase 11)
- Plugin system with dynamic table creation and full relational record CRUD (Phase 12)
- Backup CLI command for coherent vault + database snapshots (Phase 12.1)
- Tier 2 compound tools: append_to_doc, update_doc_header, insert_doc_link, apply_tags, get_briefing, get_doc_outline (Phase 13)
- Unified taxonomy system with tag synchronization, archive lifecycle, and memory versioning (Phase 14)
- Discrepancy detection CLI (`flashquery scan`) for vault/database integrity checks (Phase 14)
- Demo CRM plugin as reference implementation with E2E integration test (Phase 15)
- Claude Code skills for CRM operations (Phase 15)

### Changed
- Improved vault file organization with automated tagging and archiving
- Enhanced MCP tool registry with dynamic plugin loading
- Better error messages and validation for plugin registration

## [1.0.0] - 2026-03-25

### Added
- TypeScript ESM scaffold with CLI entry point (Phase 1)
- Configuration system with YAML + Zod v4 and environment variable expansion (Phase 2)
- Structured logging with stdout and file output, level filtering (Phase 3)
- Supabase connection with pgvector support and two-client architecture (Phase 4)
- Vault initialization with markdown project hierarchy and gray-matter frontmatter (Phase 5)
- Embedding providers: OpenAI, OpenRouter, Ollama (Phase 6)
- MCP Server (stdio transport) with memory tools: save/search/list_memories, list_projects (Phase 7)
- Document tools: create/get/search_documents (Phase 8)
- Project tools: get_project_info with full E2E test suite (Phase 9)
- Comprehensive README with setup and usage instructions (Phase 9)

### Security
- Initial credential management with environment variables
- `.gitignore` configured to exclude `.env` files

---

## How to Update This Changelog

When making releases:

1. Replace `[Unreleased]` at the top with the new version and date: `[X.Y.Z] - YYYY-MM-DD`
2. Move all content from the `[Unreleased]` section into the new version section
3. Add a new empty `[Unreleased]` section at the top
4. Use these categories (in order): **Added**, **Changed**, **Deprecated**, **Removed**, **Fixed**, **Security**
5. Keep entries concise and organized by category

Example:

```markdown
## [Unreleased]

### Added
- New feature description

## [2.0.0] - 2026-12-25

### Added
- Feature A
- Feature B

### Changed
- Behavior change
```
