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

## Known Vulnerabilities

None currently known. Security vulnerabilities are addressed as they are discovered and reported.

## Security Patches

Security patches are released as maintenance versions (e.g., 1.6.1, 1.6.2). Subscribe to [GitHub releases](https://github.com/brainshower/flashquery-core/releases) to be notified of security updates.

## Thank You

We appreciate the work of security researchers who responsibly disclose vulnerabilities. Your contributions help keep FlashQuery safe for everyone.
