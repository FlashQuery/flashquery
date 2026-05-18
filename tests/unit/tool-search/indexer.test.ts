import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  BM25_DELTA,
  BM25_PARAMS,
  BM25_PREPROC,
  NAME_BOOST,
  PureBM25Indexer,
  type ToolSearchDocument,
} from '../../../src/services/tool-search/indexer.js';
import { ENGLISH_STOPWORDS } from '../../../src/services/tool-search/stopwords.js';

const EPSILON = 1e-9;

const EXPECTED_STOPWORDS = [
  'i',
  'me',
  'my',
  'myself',
  'we',
  'our',
  'ours',
  'ourselves',
  'you',
  'your',
  'yours',
  'yourself',
  'yourselves',
  'he',
  'him',
  'his',
  'himself',
  'she',
  'her',
  'hers',
  'herself',
  'it',
  'its',
  'itself',
  'they',
  'them',
  'their',
  'theirs',
  'themselves',
  'what',
  'which',
  'who',
  'whom',
  'this',
  'that',
  'these',
  'those',
  'am',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'having',
  'do',
  'does',
  'did',
  'doing',
  'would',
  'should',
  'could',
  'ought',
  "i'm",
  "you're",
  "he's",
  "she's",
  "it's",
  "we're",
  "they're",
  "i've",
  "you've",
  "we've",
  "they've",
  "i'd",
  "you'd",
  "he'd",
  "she'd",
  "we'd",
  "they'd",
  "i'll",
  "you'll",
  "he'll",
  "she'll",
  "we'll",
  "they'll",
  "let's",
  "that's",
  "who's",
  "what's",
  "here's",
  "there's",
  "when's",
  "where's",
  "why's",
  "how's",
  'a',
  'an',
  'the',
  'and',
  'but',
  'if',
  'or',
  'because',
  'as',
  'until',
  'while',
  'of',
  'at',
  'by',
  'for',
  'with',
  'about',
  'against',
  'between',
  'into',
  'through',
  'during',
  'before',
  'after',
  'above',
  'below',
  'to',
  'from',
  'up',
  'down',
  'in',
  'out',
  'on',
  'off',
  'over',
  'under',
  'again',
  'further',
  'then',
  'once',
  'here',
  'there',
  'when',
  'where',
  'why',
  'how',
  'all',
  'any',
  'both',
  'each',
  'few',
  'more',
  'most',
  'other',
  'some',
  'such',
  'only',
  'own',
  'same',
  'so',
  'than',
  'too',
  'very',
];

function makeTool(server: string, tool: string, description: string, argNames: string[] = []): ToolSearchDocument {
  return {
    server,
    tool,
    registry_key: `${server}__${tool}`,
    description,
    argNames,
    arg_summary: argNames.map((name) => ({ name, description: `${name} argument`, required: true })),
  };
}

function corpus(): ToolSearchDocument[] {
  return [
    makeTool('brave', 'web_search', 'Search web pages and current public internet results', ['query']),
    makeTool('github', 'search_repositories', 'Find source code repositories by owner language and topic', ['q']),
    makeTool('flashquery', 'write_document', 'Create or update a markdown document in the local vault', [
      'path',
      'content',
    ]),
    makeTool('flashquery', 'search', 'Search memories and documents with filesystem semantic or mixed modes', ['query']),
    makeTool('database', 'query_rows', 'Run readonly SQL queries against relational records', ['sql']),
    makeTool('flashquery', 'call_macro', 'Run deterministic macro workflows with tool calls budgets and tracing', [
      'source',
    ]),
  ];
}

function resultKeys(indexer: PureBM25Indexer, query: string, limit = 8): string[] {
  return indexer.search(query, limit).map((result) => result.registry_key);
}

describe('PureBM25Indexer', () => {
  it('T-U-022 makes addTools equivalent to one-shot build for the same live tools', () => {
    const tools = corpus();
    const oneShot = new PureBM25Indexer();
    oneShot.build(tools);

    const incremental = new PureBM25Indexer();
    incremental.build(tools.slice(0, 3));
    incremental.addTools(tools.slice(3));

    expect(resultKeys(incremental, 'search local documents')).toEqual(resultKeys(oneShot, 'search local documents'));
    expect(incremental.getStats().documents).toBe(oneShot.getStats().documents);
  });

  it('T-U-023 tolerates nonexistent removes and preserves remaining rankings', () => {
    const tools = corpus();
    const reference = new PureBM25Indexer();
    reference.build(tools.filter((tool) => tool.registry_key !== 'github__search_repositories'));

    const indexer = new PureBM25Indexer();
    indexer.build(tools);
    indexer.removeTools(['github__search_repositories', 'ghost__missing']);

    expect(resultKeys(indexer, 'local markdown document')).toEqual(resultKeys(reference, 'local markdown document'));
    expect(indexer.search('repository language topic', 3).some((result) => result.registry_key === 'github__search_repositories')).toBe(
      false
    );
  });

  it('T-U-024 prevents duplicate documents across add/remove/add round trips', () => {
    const tools = corpus();
    const indexer = new PureBM25Indexer();
    indexer.build(tools);
    indexer.addTools(tools.slice(0, 2));
    expect(indexer.getStats().documents).toBe(tools.length);

    indexer.removeTools(['brave__web_search']);
    expect(indexer.getStats().documents).toBe(tools.length - 1);

    indexer.addTools([tools[0]]);
    indexer.addTools([tools[0]]);
    expect(indexer.getStats().documents).toBe(tools.length);
    expect(resultKeys(indexer, 'current internet web pages').filter((key) => key === 'brave__web_search')).toHaveLength(1);
  });

  it('T-U-025 reports live document and token counts, not deleted docs', () => {
    const tools = corpus();
    const indexer = new PureBM25Indexer();
    indexer.build(tools.slice(0, 4));
    const before = indexer.getStats();

    indexer.addTools([tools[4], tools[0]]);
    indexer.removeTools(['brave__web_search', 'ghost__missing']);
    const after = indexer.getStats();

    expect(after.documents).toBe(4);
    expect(after.tokens).toBeGreaterThan(0);
    expect(after.tokens).toBeLessThan(before.tokens + 30);

    const reference = new PureBM25Indexer();
    reference.build([tools[1], tools[2], tools[3], tools[4]]);
    expect(after.termCount).toBe(reference.getStats().termCount);
    expect(Math.abs(after.avgPostingsPerTerm - reference.getStats().avgPostingsPerTerm)).toBeLessThan(EPSILON);
  });

  it('T-U-026 exports the pinned algorithm constants', () => {
    expect(BM25_PARAMS).toEqual({ k1: 2.0, b: 0.5 });
    expect(BM25_DELTA).toBe(0.25);
    expect(NAME_BOOST).toBe(3);
    expect(BM25_PREPROC).toEqual({ stopwords: true, stemming: false });
  });

  it('T-U-027 keeps the inline 153-word English stopword set from the POC', () => {
    expect(ENGLISH_STOPWORDS).toEqual(new Set(EXPECTED_STOPWORDS));
    expect(ENGLISH_STOPWORDS.size).toBe(153);
  });

  it('returns empty results for empty queries and empty corpora', () => {
    const indexer = new PureBM25Indexer();
    expect(indexer.search('', 8)).toEqual([]);
    expect(indexer.search('   ', 8)).toEqual([]);
    expect(indexer.search('anything', 8)).toEqual([]);
  });

  it('keeps build and addTools idempotent for duplicate keys', () => {
    const tools = corpus();
    const indexer = new PureBM25Indexer();
    indexer.build(tools);
    indexer.build(tools);
    indexer.addTools(tools);

    expect(indexer.getStats().documents).toBe(tools.length);
    expect(resultKeys(indexer, 'vault document')).toEqual(resultKeys(indexer, 'vault document'));
  });
});

describe('BM25 POC fixtures', () => {
  it('parses query fixture JSON and keeps copied corpus files nonempty', async () => {
    const [queries, callMacroQueries, corpusText, flashqueryCorpusText] = await Promise.all([
      readFile('tests/fixtures/tool-search/queries.json', 'utf8'),
      readFile('tests/fixtures/tool-search/queries-call-macro.json', 'utf8'),
      readFile('tests/fixtures/tool-search/corpus.md', 'utf8'),
      readFile('tests/fixtures/tool-search/corpus-flashquery.md', 'utf8'),
    ]);

    expect(JSON.parse(queries)).toHaveLength(48);
    expect(JSON.parse(callMacroQueries)).toHaveLength(18);
    expect(corpusText.trim().length).toBeGreaterThan(0);
    expect(flashqueryCorpusText.trim().length).toBeGreaterThan(0);
  });
});
