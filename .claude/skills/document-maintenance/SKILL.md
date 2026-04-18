# Document Maintenance Skill

**Version:** 1.0.0
**Purpose:** Prompt review of README.md and ARCHITECTURE.md at natural phase/milestone completion checkpoints

## Overview

The document maintenance skill helps keep FlashQuery documentation in sync with code changes. It provides two review rules:

1. **README Review** — Ensures quickstart is current, links work, MCP client examples are up-to-date
2. **ARCHITECTURE.md Review** — Ensures deployment paths, data flow diagrams, and config examples match the code

Use this skill when:
- Completing a phase with code changes
- Shipping a milestone release
- Adding a new feature with user-facing behavior
- Changing deployment architecture
- Updating CLI commands or config file structure

## Rules

- `rules/readme-review.md` — README.md checklist and review prompts
- `rules/architecture-review.md` — ARCHITECTURE.md checklist and review prompts

## Invocation Pattern

In Phase XX execution plans (from Phase 21 onward), add a checkpoint task:

```yaml
<task type="checkpoint:human-verify">
  <what-built>[Feature/code changes from this phase]</what-built>
  <how-to-verify>
    Use the document maintenance skill to review docs:
    - Run README review: [@.claude/skills/document-maintenance/rules/readme-review.md]
    - Run ARCHITECTURE.md review: [@.claude/skills/document-maintenance/rules/architecture-review.md]
    Confirm all checklist items are addressed or note which are not.
  </how-to-verify>
  <resume-signal>Type "docs verified" or describe issues found</resume-signal>
</task>
```

## Example Usage

**At Phase 21 completion (after major feature):**
- Execute the phase's code tasks
- Before marking phase complete, run README review
- Check if quickstart still works
- Verify all links resolve
- Check if new commands are documented
- Mark checkpoint complete

**At milestone completion (v1.7 release):**
- Run both README and ARCHITECTURE.md reviews
- Ensure CHANGELOG reflects all changes
- Verify deployment guides are current
- Update version number in ARCHITECTURE.md

## Typical Checklist

### README Review
- Quickstart still works (copy-paste exact steps)
- All relative links resolve (README.md, ARCHITECTURE.md, etc.)
- MCP client config examples use current paths/flags
- Badges render (CI, license, Node version)
- CLI commands match current package.json scripts

### ARCHITECTURE.md Review
- All 4 deployment paths are current
- Data flow diagram matches actual code flow
- Config examples in flashquery.yaml.example are current
- All referenced files exist (setup.sh, docker-compose.yml, etc.)
- Component descriptions match src/ directory structure

## Future Expansions

This skill can be extended to include:
- CONTRIBUTING.md review (when dev instructions change)
- CHANGELOG.md automation (extract from commits)
- Breaking change detection (when API changes)
- API documentation generation (from MCP tool handlers)

---

**Location:** `.claude/skills/document-maintenance/`
**Last Updated:** 2026-03-30
