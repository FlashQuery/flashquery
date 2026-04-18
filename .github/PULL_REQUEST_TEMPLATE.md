## What

Brief description of what this PR does. One sentence is great.

Example: "Add semantic search tool for document vectors"

## Why

Why is this change needed? What problem does it solve? What context should reviewers know?

Example:
- Solves issue #123 (users want to find related documents)
- Enables Phase 10 (embeddings) by providing the vector search backend
- Required for the semantic search feature

## How

How does this change work? Walk through the technical approach.

Example:
- Adds `search_semantic` MCP tool that accepts a query string
- Tool converts query to embedding using the configured provider
- Queries pgvector table for nearest neighbors with cosine similarity
- Returns top 5 matches with score and metadata

## Testing

What testing did you do? How can reviewers verify this works?

Example:
- [ ] Unit tests added for embedding provider (unit.test.ts)
- [ ] Integration tests run against local Supabase (integration.test.ts)
- [ ] Manual test: `npm run test:e2e` passes all E2E tests
- [ ] Tested with:
  - OpenAI embeddings (text-embedding-3-small)
  - Ollama embeddings (local, no API key)

## Checklist

- [ ] Tests pass locally: `npm test`
- [ ] Code follows project conventions (see CONTRIBUTING.md)
- [ ] No new dependencies added (or added with justification)
- [ ] CHANGELOG.md updated with this change
- [ ] Documentation updated (README, inline comments, etc.)
- [ ] No sensitive credentials, API keys, or `.env` files in commits
- [ ] Commits are logical and atomic (one feature per commit)

## Breaking Changes

Does this PR introduce breaking changes? Examples: API changes, config format changes, removed features.

If yes, list them and explain the migration path for users.

If no, you can delete this section.

## Related Issues

Closes #123
Related to #456

(Use "Closes #X" to auto-close issues when the PR is merged)
