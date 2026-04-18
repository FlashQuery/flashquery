# Contributing to FlashQuery

Thank you for your interest in contributing to FlashQuery! Whether you're fixing bugs, adding features, improving documentation, or enhancing the test suite, you're helping us build a better open source project.

This guide walks you through local setup, branch conventions, CLA requirements, trademark policy, and testing procedures.

## Quick Start (5 Steps)

Get up and running in under 10 minutes:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/brainshower/flashquery-core
   cd flashquery-core
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Copy the environment template:**
   ```bash
   cp .env.example .env
   ```

4. **Fill in your credentials:**
   See [Credential Setup](#credential-setup) below to find your Supabase and embedding API keys.

5. **Verify the setup:**
   ```bash
   npm test
   ```

If all tests pass, you're ready to contribute!

## Credential Setup

To run the full test suite and work with the system, you'll need to configure a few environment variables. You can skip optional variables initially and add them as needed.

### Required Variables

**SUPABASE_URL**
- Where to get it: [Supabase Dashboard](https://app.supabase.com) → Your Project → Settings → API → Project URL
- Example: `https://my-project.supabase.co`
- Impact: Application will not start without this

**SUPABASE_ANON_KEY**
- Where to get it: [Supabase Dashboard](https://app.supabase.com) → Your Project → Settings → API → anon public key
- Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- Impact: Required for database connection

**SUPABASE_SERVICE_ROLE_KEY**
- Where to get it: [Supabase Dashboard](https://app.supabase.com) → Your Project → Settings → API → service_role secret key
- Example: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...`
- Impact: Required for schema creation at startup

### Optional Variables

**EMBEDDING_API_KEY**
- Where to get it:
  - OpenAI: [https://platform.openai.com/api-keys](https://platform.openai.com/api-keys)
  - OpenRouter: [https://openrouter.ai/keys](https://openrouter.ai/keys)
  - Ollama: [https://ollama.ai](https://ollama.ai) (local, no key needed)
- Impact: If blank, embedding tests use mocked embeddings. You can add this later to test semantic search.

**EMBEDDING_PROVIDER**
- Options: `openai`, `openrouter`, `ollama`
- Default: `openai`

**VAULT_PATH**
- Local directory for markdown files
- Default: `./vault`
- Example: `/Users/username/Documents/MyVault`

**LOG_LEVEL**
- Options: `debug`, `info`, `warn`, `error`
- Default: `info`

**GIT_AUTHOR_NAME** and **GIT_AUTHOR_EMAIL**
- Used for auto-commits to the vault repository
- Defaults: `FlashQuery` and `bot@flashquery.dev`

**GIT_AUTO_PUSH**
- Auto-push vault commits to remote (`true` or `false`)
- Default: `false`

### Testing Without Full Credentials

Many unit and integration tests run with mocked Supabase responses. You can get started with just the required variables and add embedding credentials as you explore semantic search features.

## Branch and Commit Conventions

### Branch Naming

Use descriptive branch names with a type prefix:

- `fix/issue-123-description` — Bug fixes
- `feat/description` — New features
- `docs/description` — Documentation improvements
- `refactor/description` — Code refactoring (no behavior changes)
- `test/description` — Test additions or improvements

Examples:
- `fix/vault-path-windows-resolution`
- `feat/semantic-memory-search`
- `docs/plugin-api-guide`
- `refactor/reduce-supabase-client-complexity`

### Commit Messages

Use Conventional Commits format:

```
<type>(<scope>): <subject>

<body (optional)>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Examples:
- `feat(memory): add semantic search across memory with pgvector`
- `fix(vault): resolve file encoding issue on Windows`
- `docs(contributing): add credential setup guide`
- `test(e2e): add full CRM plugin workflow test`

### Pull Request Checklist

Before submitting a pull request:

- [ ] Tests pass locally (`npm test`)
- [ ] No new console errors or warnings in logs
- [ ] If you changed user-facing behavior, update [CHANGELOG.md](./CHANGELOG.md)
- [ ] Self-review: code is readable, comments are clear, no obvious issues
- [ ] (If adding files) Follow project conventions (TypeScript, ESM imports, error handling)

## CLA Requirement

To protect the project's intellectual property, we require a Contributor License Agreement (CLA) for **code contributions only**.

### What Requires a CLA

- Pull requests that modify code in `src/` directory (core MCP tools, config, storage, embedding, logging modules)

### What Does NOT Require a CLA

- Documentation improvements (README, guides, examples)
- Test additions and improvements
- Comments, docstrings, or code cleanup
- Bug reports and feature requests (GitHub issues)
- Examples and sample configurations

This boundary keeps the project open to small contributions while protecting core code.

### Signing the CLA

1. **For individual contributors:** Read and agree to [legal/CLA.md](./legal/CLA.md)
   - When you submit a pull request that modifies `src/`, include this statement in your PR description:
   ```
   I agree to the Individual Contributor License Agreement (ICLA) as documented in legal/CLA.md.
   ```

2. **For corporate contributors:** Read and execute [legal/CLA-CORPORATE.md](./legal/CLA-CORPORATE.md)
   - Have an authorized representative of your company sign the agreement
   - Submit the signed agreement to the maintainers before employees submit code
   - Employees must also execute [legal/CLA.md](./legal/CLA.md)

## Trademark Policy

FlashQuery is a trademark of FlashQuery Inc. To protect our brand while enabling community forks:

**If you fork this project, you must not use "FlashQuery" in the name.** Instead, use a descriptive name or include "-derived" or "-fork":

### ✅ Acceptable fork names:
- `crmquery` — descriptive, no FlashQuery reference
- `flashquery-derived` — clearly indicates derivative work
- `flashquery-fork` — clearly indicates fork
- `memory-layer` — descriptive alternative

### ❌ Unacceptable fork names:
- `FlashQuery-Pro` — implies official product variant
- `FlashQuery-Community` — implies official community edition
- `FlashQuery-Plus` — implies official feature upgrade

This protects FlashQuery's brand identity while respecting your right to build on our work.

## Tests and Verification

### Running Tests

```bash
# Unit and integration tests
npm test

# Integration tests only (requires local Supabase: supabase start)
npm run test:integration

# Run specific test file
npm test -- memory.test.ts

# Watch mode (re-run on file changes)
npm test -- --watch
```

### Test Organization

- **Unit tests** (`tests/unit/*.test.ts`): Mock external dependencies, run in ~seconds
- **Integration tests** (`tests/integration/*.test.ts`): Require local Supabase, test real storage ops
- **MCP protocol tests** (`tests/mcp/*.test.ts`): Spawn FlashQuery as subprocess, verify MCP protocol compliance

### Writing Tests

Use Vitest syntax (similar to Jest):

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

describe('my feature', () => {
  it('should do something', () => {
    expect(true).toBe(true);
  });
});
```

## Code Style and Architecture

### Understand the Project

For deeper dives beyond this guide:

- **Architecture overview:** See [ARCHITECTURE.md](./docs/ARCHITECTURE.md)
- **MCP tools and API:** See [docs/plugin-api.md](./docs/plugin-api.md) (reference docs)
- **Docker and deployment:** See [docker/README.md](./docker/README.md) (Docker setup guide)
- **Plugin authoring:** See [docs/plugin-guide.md](./docs/plugin-guide.md) (build custom plugins)

### Code Conventions

- **Language:** TypeScript (strict mode)
- **Module system:** ESM only (no CommonJS)
- **Error handling:** Typed error returns at module boundaries, try/catch in MCP tool handlers
- **Validation:** Zod for all external input (config, MCP parameters)
- **Async:** async/await throughout (no raw Promises)
- **Logging:** Structured format via logger module: `[YYYY-MM-DD HH:MM:SS] LEVEL Message`

### File Organization

```
flashquery-core/src/
├── index.ts                 # CLI entry, startup
├── config/
│   └── loader.ts            # YAML parsing, env var resolution
├── mcp/
│   ├── server.ts            # MCP setup
│   └── tools/               # MCP tool implementations
├── storage/
│   ├── supabase.ts          # Supabase clients
│   └── vault.ts             # Vault file ops
├── embedding/
│   └── provider.ts          # Embedding generation
└── logging/
    └── logger.ts            # Structured logging
```

## Community and Conduct

We follow the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md). Our community values:

- **Respect:** Treat everyone with respect regardless of background or experience level
- **Constructive feedback:** Help others improve; be open to critique of your own work
- **Inclusivity:** Welcome diverse perspectives and experiences
- **Good faith:** Assume good intent and address conflicts privately

See [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) for the full covenant.

## Security Issues

Found a security vulnerability? **Please do not open a public issue.**

Instead, use [GitHub's private security advisory feature](https://github.com/FlashQuery/flashquery-core/security/advisories):

1. Go to [Security Advisories](https://github.com/FlashQuery/flashquery-core/security/advisories)
2. Click "Report a vulnerability"
3. Describe the issue and steps to reproduce
4. We'll acknowledge within 48 hours and work toward a fix

See [SECURITY.md](./SECURITY.md) for our full vulnerability response policy.

## Questions?

- **How do I...?** Ask in [GitHub Discussions](https://github.com/FlashQuery/flashquery-core/discussions)
- **I found a bug:** Open an issue using the [Bug Report](https://github.com/FlashQuery/flashquery-core/issues/new?template=bug-report.yml) template
- **I have an idea:** Open an issue using the [Feature Request](https://github.com/FlashQuery/flashquery-core/issues/new?template=feature-request.yml) template
- **Something else:** Reach out to maintainers at [the official contact]

Thank you for contributing! 🙏
