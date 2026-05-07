# Security Policy

## Reporting a Vulnerability

FlashQuery takes security seriously. If you discover a security vulnerability, **please do not open a public issue**. Instead, report it privately using GitHub's security advisory system.

### How to Report

1. Go to the [Security Advisories page](https://github.com/brainshower/flashquery-core/security/advisories)
2. Click "Report a vulnerability"
3. Fill in the vulnerability details:
   - **Title:** Brief summary (e.g., "SQL injection in query builder")
   - **Description:** Detailed explanation with reproduction steps
   - **Severity:** Critical / High / Medium / Low
   - **CVSS Score:** If known

Alternatively, you can email [security@flashquery.dev](mailto:security@flashquery.dev) with vulnerability details.

### Response Timeline

- **Acknowledgment:** Within 48 hours
- **Initial Assessment:** Within 1 week
- **Fix & Patch Release:** As soon as feasible (typically within 2 weeks for critical vulnerabilities)
- **Public Disclosure:** After patch is released and users have time to upgrade

## Supported Versions

Security fixes are provided for the following versions:

| Version | Status | Support Until |
|---------|--------|----------------|
| 1.6.x   | Current | 2027-03-29 |
| 1.5.x   | Maintenance | 2026-09-29 |
| 1.4.x and earlier | End of Life | Not supported |

## Security Best Practices

When using FlashQuery, follow these security recommendations:

### Environment Variables

- **Never commit `.env` files** to version control — use `.env.example` as a template
- **Rotate API keys regularly** for OpenAI, OpenRouter, and other external services
- **Use strong database credentials** for Supabase connections
- **Enable Supabase RLS** (Row Level Security) for production deployments

### Deployment

- **Run as non-root user** in Docker containers
- **Enable TLS/HTTPS** for HTTP transport (Phase 18)
- **Restrict network access** to the MCP server port (default 3100)
- **Use VPC or firewall rules** to limit incoming connections
- **Keep dependencies updated** — run `npm audit` regularly and address findings

### Data Security

- **Encrypt vault backups** before storing remotely
- **Use private git repositories** for vault storage
- **Limit file permissions** on vault directories (chmod 700)
- **Audit vault access logs** regularly

## Phase Audit Log

### Phase 109 — reference-syntax-in-call-model (2026-05-02)

**Auditor:** gsd-security-auditor (claude-sonnet-4-6)
**ASVS Level:** 1
**Result:** SECURED — 6/6 mitigate threats closed, 7/7 accept threats closed

#### Threat Verification

| Threat ID | Category | Disposition | Evidence |
|-----------|----------|-------------|----------|
| T-109-04 | Tampering | mitigate | Regex `[^}]*?` at `src/llm/reference-resolver.ts:80` excludes `}` from inner capture. Path traversal guard `rel.startsWith('..')` at `src/mcp/utils/resolve-document.ts:87-89` (UUID path) and `106-108` (path path). |
| T-109-08 | Tampering | mitigate | `hydrateMessages` uses position-aware substitution on the ORIGINAL string (lines 225-241 of `src/llm/reference-resolver.ts`); resolved content is never re-scanned. Unit test U-RR-13 (`tests/unit/reference-resolver.test.ts:198-223`) enforces single-pass invariant. |
| T-109-09 | Tampering | mitigate | Handler order in `src/mcp/tools/llm.ts`: Step 1 (unconfigured guard) lines 122-135 → Step 1.5 (reference resolution) lines 137-174 → Step 1b (trace pre-snapshot) lines 176-205. Parse/resolution failures return before pre-snapshot query is reached. |
| T-109-10 | Information Disclosure | mitigate | Tool description at `src/mcp/tools/llm.ts:88` states "messages are forwarded to the provider as-is — prompt safety is the caller's responsibility." |
| T-109-11 | Denial of Service | mitigate | `Promise.all(parsed.map(...))` at `src/llm/reference-resolver.ts:142` bounds parallelism to ParsedRef count; each slot reads one file and makes at most one Supabase query. |
| T-109-12 | Tampering | mitigate | Handler returns `isError:true` before `client.complete()` on FailedRef (lines 158-167) and ParseRefError (lines 143-151) in `src/mcp/tools/llm.ts`. `expect(completeMock).not.toHaveBeenCalled()` assertions at `tests/unit/llm-tool.test.ts:382` (U-RR-INT-03) and `414` (U-RR-INT-04) lock this invariant. |
| T-109-01 | Tampering | accept | Accepted risk: `resolveAndBuildDocument` relocation from documents.ts to document-output.ts. |
| T-109-02 | Info Disclosure | accept | Accepted risk: DocumentRequestError envelope shape. |
| T-109-03 | EoP | accept | Accepted risk: export of `resolveAndBuildDocument`. |
| T-109-05 | DoS | accept | Accepted risk: `parseReferences` scanning large content. |
| T-109-06 | DoS | accept | Accepted risk: reference amplification. |
| T-109-07 | Info Disclosure | accept | Accepted risk: resolved content in LLM prompt. |
| T-109-13 | Info Disclosure | accept | Accepted risk: failure response leaking paths. |

#### Unregistered Threat Flags

None — all SUMMARY.md threat flags map to registered threat IDs in the register above.

## Known Vulnerabilities

None currently known. Security vulnerabilities are addressed as they are discovered and reported.

## Security Patches

Security patches are released as maintenance versions (e.g., 1.6.1, 1.6.2). Subscribe to [GitHub releases](https://github.com/brainshower/flashquery-core/releases) to be notified of security updates.

## Thank You

We appreciate the work of security researchers who responsibly disclose vulnerabilities. Your contributions help keep FlashQuery safe for everyone.
