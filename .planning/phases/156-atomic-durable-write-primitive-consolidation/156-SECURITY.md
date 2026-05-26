---
phase: 156
slug: atomic-durable-write-primitive-consolidation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-26
---

# Phase 156 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| MCP/tool caller -> storage helper | Callers validate and resolve vault paths before invoking storage. | Vault-relative/absolute local paths and markdown bytes. |
| Storage helper -> filesystem | Filesystem operations can fail or partially complete. | Markdown bytes, temp files, rename operations, fsync calls. |
| Test injection -> production module | Tests inject operations to simulate filesystem behavior. | Test-only function references and fake handles. |
| Plugin reconciliation -> vault files | Plugin-owned metadata writes must preserve folder/path constraints. | Frontmatter updates for ownership/type fields. |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-156-01 | Tampering | `writeVaultFile` commit sequence | mitigate | Same-directory unique temp files and atomic rename implemented in `src/storage/vault-write.ts`; T-U-031/T-U-032 verify sequence and uniqueness. | closed |
| T-156-02 | Repudiation | filesystem failure handling | mitigate | Write, temp sync, rename, and directory sync errors propagate; T-U-029/T-U-031/T-I-039 cover surfaced failures. | closed |
| T-156-03 | Denial of Service | temp files after failed writes | mitigate | Best-effort temp cleanup in `writeVaultFile`; startup cleanup removes legacy and unique temp names; T-I-041 verifies cleanup. | closed |
| T-156-04 | Elevation of Privilege | absolute path input | mitigate | `writeVaultFile` remains an internal storage helper; existing callers retain path validation and no MCP tool exposes it directly. | closed |
| T-156-SC | Tampering | native/package dependency supply chain | mitigate | No native dependency or package install was added; macOS durable behavior remains behind the adapter fallback. | closed |
| T-156-05 | Tampering | `VaultManager.writeMarkdown` | mitigate | Normal markdown writes now delegate to `writeVaultFile`; T-I-040 verifies representative routing. | closed |
| T-156-06 | Repudiation | `atomicWriteFrontmatter` | mitigate | Catch-and-swallow branch removed; T-I-039 proves write failures reach callers. | closed |
| T-156-07 | Tampering | document resolver repair | mitigate | Targeted repair serialization delegates to `writeVaultFile`; resolver unit tests assert the durable boundary. | closed |
| T-156-08 | Elevation of Privilege | plugin reconciliation paths | mitigate | Plugin reconciliation still uses existing path boundaries and now inherits surfaced errors through `atomicWriteFrontmatter`. | closed |
| T-156-09 | Tampering | direct vault write bypass | mitigate | T-U-030 scans production source and allowlists only primitive internals or Phase 161 deferred boundaries. | closed |
| T-156-10 | Repudiation | final evidence | mitigate | `156-03-SUMMARY.md` records command outcomes, required test IDs, and write-path inventory. | closed |
| T-156-11 | Tampering | stale temp cleanup | mitigate | T-I-041 verifies legacy and unique temp cleanup while preserving normal markdown files. | closed |
| T-156-12 | Information Disclosure | error/log output | accept | Surfacing local filesystem errors is required for REQ-020; no new secret logging or content dumping was introduced. | closed |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-156-01 | T-156-12 | Caller-visible filesystem errors are intentional for failure transparency; existing local path exposure behavior is unchanged. | Implementation audit | 2026-05-26 |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-26 | 13 | 13 | 0 | Codex inline security audit |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-26
