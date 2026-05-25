---
phase: 150
slug: config-metadata-typing
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-25
---

# Phase 150 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| YAML config file -> config loader | User-authored config is parsed, env-expanded, normalized, and annotated with runtime metadata. | Config values, raw env references, runtime metadata |
| Config loader -> LLM config sync | Raw API key references cross into DB persistence through `getLlmApiKeyRefs`. | Raw `${ENV_VAR}` refs; resolved secrets must not cross |
| Config loader -> MCP host exposure | Host tool exposure decisions cross from config metadata into MCP tool registration and delegated surfaces. | Host tool allow/exclude metadata |
| Public `FlashQueryConfig` consumers -> runtime metadata | External callers receive a public config object and must not depend on hidden underscore fields. | Public config shape and private metadata accessors |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-150-01 | Information Disclosure | `getLlmApiKeyRefs`, `syncLlmConfigToDb` | mitigate | Raw refs are captured before env expansion and stored in typed metadata; T-U-028 asserts `${OPENAI_API_KEY}` is returned while `sk-resolved-secret` is absent. | closed |
| T-150-02 | Elevation of Privilege | `getResolvedHostToolExposure` | mitigate | Loaded configs return stored exposure and manual configs recompute from `hostMcpTools`; T-U-027 covers both paths. | closed |
| T-150-03 | Tampering | `FlashQueryConfig` public shape | mitigate | Runtime metadata is stored in module-local `WeakMap<FlashQueryConfig, ConfigRuntimeMetadata>`; T-U-029 verifies selected underscore side-channel casts are removed. | closed |
| T-150-04 | Repudiation | Config warning accessors | mitigate | Deprecation and startup warning metadata remains observable through accessors; T-U-026 verifies both warning channels. | closed |
| T-150-SC | Tampering | Package installs | accept | No dependency installation or package-manager task was in scope for this phase. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-150-SC | T-150-SC | No package installs occurred, so package legitimacy risk is not applicable to this phase. | GSD security gate | 2026-05-25 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-25 | 5 | 5 | 0 | Codex |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-25
