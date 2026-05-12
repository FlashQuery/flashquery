import { describe, expect, it } from 'vitest';
import {
  mergeSearchResults,
  resolveEntityTypes,
  resolveSearchIntent,
  resolveSearchMode,
  validateSearchInput,
  type SearchResultItem,
} from '../../src/mcp/utils/search-results.js';

describe('search helper validation', () => {
  it('accepts filesystem, semantic, and mixed modes and defaults to mixed', () => {
    expect(resolveSearchMode(undefined)).toBe('mixed');
    expect(resolveSearchMode('filesystem')).toBe('filesystem');
    expect(resolveSearchMode('semantic')).toBe('semantic');
    expect(resolveSearchMode('mixed')).toBe('mixed');
    expect(validateSearchInput({ query: 'x', mode: 'regex' })).toMatchObject({ error: 'invalid_input' });
  });

  it('rejects empty query without filters unless list_all is true', () => {
    expect(validateSearchInput({ query: '' })).toMatchObject({ error: 'invalid_input' });
    expect(validateSearchInput({ query: '', list_all: true, entity_types: ['documents'] })).toBeNull();
  });

  it('enters list mode for empty filtered searches and requires explicit entity_types', () => {
    expect(validateSearchInput({ query: '', tags: ['phase125'] })).toMatchObject({ error: 'invalid_input' });
    expect(resolveSearchIntent({ query: '', tags: ['phase125'], entity_types: ['memories'] }, { documents: true, memories: true }).intent).toMatchObject({
      mode: 'list',
      list_mode: true,
      entity_types: ['memories'],
    });
  });

  it('rejects semantic mode with empty query', () => {
    expect(validateSearchInput({ query: '', mode: 'semantic', list_all: true, entity_types: ['documents'] })).toMatchObject({
      error: 'invalid_input',
      details: { field: 'query' },
    });
  });

  it('narrows omitted entity_types to enabled domains and reports disabled explicit domains', () => {
    expect(resolveEntityTypes(undefined, { documents: true, memories: false })).toEqual({
      entityTypes: ['documents'],
      warnings: [],
    });
    expect(resolveEntityTypes(['documents', 'memories'], { documents: true, memories: false })).toEqual({
      entityTypes: ['documents'],
      warnings: ['memory_category_disabled'],
    });
    expect(resolveEntityTypes(['memories'], { documents: true, memories: false })).toMatchObject({
      warnings: ['memory_category_disabled'],
      error: {
        error: 'unsupported',
        identifier: 'memories',
        details: { disabled_category: 'memory' },
      },
    });
  });

  it('represents embedding unavailable fallback and unsupported semantic intent as warnings/errors', () => {
    const mixed = resolveSearchIntent({ query: 'alpha', mode: 'mixed', entity_types: ['documents'] }, { documents: true, memories: false });
    expect(mixed.intent).toMatchObject({ requested_mode: 'mixed' });

    const semanticWithoutFallback = resolveSearchIntent({ query: '', mode: 'semantic', entity_types: ['memories'] }, { documents: true, memories: true });
    expect(semanticWithoutFallback.error).toMatchObject({ error: 'invalid_input' });
  });
});

describe('search result merge and ranking', () => {
  it('dedupes mixed-mode document and memory results by fq_id/memory_id and aggregates match_source', () => {
    const results: SearchResultItem[] = [
      { entity_type: 'documents', identifier: 'doc path', path: 'A.md', fq_id: 'doc-1', score: 0.4, match_source: ['filesystem'] },
      { entity_type: 'documents', identifier: 'doc path', path: 'A.md', fq_id: 'doc-1', score: 0.9, match_source: ['semantic'] },
      { entity_type: 'memories', identifier: 'mem-1', memory_id: 'mem-1', score: 0.7, match_source: ['semantic'] },
      { entity_type: 'memories', identifier: 'mem-1', memory_id: 'mem-1', score: 0.2, match_source: ['list'] },
    ];

    expect(mergeSearchResults(results, 10)).toEqual([
      expect.objectContaining({ fq_id: 'doc-1', score: 0.9, match_source: ['filesystem', 'semantic'] }),
      expect.objectContaining({ memory_id: 'mem-1', score: 0.7, match_source: ['semantic', 'list'] }),
    ]);
  });

  it('applies one global limit after merge, dedupe, and deterministic sorting', () => {
    const results: SearchResultItem[] = [
      { entity_type: 'memories', identifier: 'mem-b', memory_id: 'mem-b', score: 0.8, match_source: ['semantic'] },
      { entity_type: 'documents', identifier: 'b', path: 'B.md', fq_id: 'doc-b', score: 0.8, match_source: ['semantic'] },
      { entity_type: 'documents', identifier: 'a', path: 'A.md', fq_id: 'doc-a', score: 0.8, match_source: ['filesystem'] },
    ];

    expect(mergeSearchResults(results, 2).map((result) => result.identifier)).toEqual(['a', 'b']);
  });
});
