# README Review Checklist

**Purpose:** Ensure README.md remains accurate, links work, and quickstart instructions are current after code changes.

**Trigger:** After completing a phase with code changes, before marking phase complete, run this review.

**Duration:** 10-15 minutes. Check each item, note any issues found.

## Quick Checks

### Metadata
- [ ] Title is "# FlashQuery"
- [ ] Description paragraph is current (mentions "local-first data management layer")
- [ ] Version badge (if present) matches package.json version
- [ ] Node.js version requirement matches config documentation

### Quickstart Section
- [ ] Title is "## Quickstart" (or "Getting Started")
- [ ] Instructions are copy-paste accurate
- [ ] Docker steps still match docker-compose.yml structure
- [ ] Setup script reference is correct (setup.sh path)
- [ ] Example commands use current CLI syntax

### MCP Configuration
- [ ] Claude Desktop config path is correct (user's config directory reference)
- [ ] Claude Code config matches current executable and paths
- [ ] JSON configs have absolute paths (not relative)
- [ ] All example configs are valid JSON (no syntax errors)
- [ ] Config snippets reference current MCP tool names

### Links and References
- [ ] Link to ARCHITECTURE.md resolves
- [ ] Link to CONTRIBUTING.md resolves
- [ ] Link to LICENSE file resolves
- [ ] All relative links use correct paths
- [ ] External GitHub links (LICENSE, CONTRIBUTING) point to correct URLs

### Badges
- [ ] License badge (Apache 2.0) renders correctly
- [ ] GitHub Actions CI badge passes or is accurate
- [ ] Node.js version badge matches minimum requirement
- [ ] Supabase logo/reference is current (if present)

### Installation Instructions
- [ ] npm install instructions are accurate
- [ ] npm scripts listed match package.json
- [ ] Environment variable setup (.env.example reference) is mentioned
- [ ] Configuration file location (flashquery.yaml) is documented

### Features Section
- [ ] Listed features match v1.5 or current shipped features
- [ ] No features listed that are still in-progress or deferred
- [ ] Feature descriptions are concise and accurate

### Components / Architecture Section
- [ ] High-level architecture overview is accurate
- [ ] All major components are mentioned
- [ ] Data flow is correctly described
- [ ] References to deployment paths are current

### Navigation
- [ ] "See Also" or "More Information" section links to ARCHITECTURE.md
- [ ] Links to CLI documentation (if exists)
- [ ] Links to plugin documentation (if exists)

## Deep Dive (if code changed significantly)

### If CLI commands changed:
- [ ] `flashquery start` help text matches README
- [ ] `flashquery backup` help text matches README
- [ ] `flashquery scan` help text matches README
- [ ] Any new CLI flags are documented

### If MCP tools changed:
- [ ] Tool list in README matches current MCP handlers
- [ ] Tool descriptions are accurate
- [ ] Tool parameters match current implementation
- [ ] Examples show current tool usage

### If configuration changed:
- [ ] flashquery.yaml example in README reflects current schema
- [ ] All required fields are documented
- [ ] Example values are realistic and safe to copy
- [ ] YAML syntax is valid and indentation is correct

### If deployment changed:
- [ ] Docker quickstart matches Dockerfile
- [ ] docker-compose paths are correct
- [ ] Environment variables in example match actual requirements
- [ ] Supabase setup instructions are current

## Issue Reporting

If you find an issue:
1. Note which checklist item failed
2. Describe the issue (what should it be?)
3. Propose a fix or research needed
4. If multiple issues, list them all before fixing

**Minor issues** (typos, outdated version number): Fix directly, commit in this task's summary.

**Major issues** (incorrect instructions, broken links): Report to plan executor as blocker; may require phase extension.

---

**How to use this skill:**
1. Open FlashQuery-Core README.md
2. Go through checklist items one by one
3. Test quickstart steps if code changed significantly
4. Record findings in phase SUMMARY.md
