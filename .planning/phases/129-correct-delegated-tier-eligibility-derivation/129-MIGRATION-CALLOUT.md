---
phase: 129-correct-delegated-tier-eligibility-derivation
requirement: POST-01
updated: 2026-05-13
---

# PR Migration Callout: Delegated Tier Eligibility

Deployments with delegated purpose configurations that use `tools: ["tier:read-only"]` or `tools: ["tier:read-write"]` may gain exactly these corrected tier-derived tools after this change:

- `list_vault`
- `copy_document`
- `insert_in_doc`
- `replace_doc_section`

This expansion is intentional. The prior narrower delegated tier behavior was a bug caused by a hand-maintained allow-list drifting from the canonical metadata/category rules, and it is not preserved as a compatibility default per Phase 129 decision D-10.

Deployments that need narrower delegated behavior should use per-purpose `excludedTools` / YAML `excluded_tools` entries to remove any of the newly available tools from a purpose-specific tool belt.
