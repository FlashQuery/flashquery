import { ENGLISH_STOPWORDS } from './stopwords.js';

export interface BM25Params {
  k1: number;
  b: number;
}

export interface BM25Preproc {
  stopwords: boolean;
  stemming: boolean;
}

export interface ToolArgSummary {
  name: string;
  description: string;
  required: boolean;
}

export interface ToolSearchDocument {
  server: string;
  tool: string;
  registry_key: string;
  description: string;
  argNames?: string[];
  arg_summary?: ToolArgSummary[];
}

export interface ToolSearchResult extends ToolSearchDocument {
  score: number;
  normalizedScore: number;
}

export interface ToolSearchStats {
  documents: number;
  tokens: number;
  sizeBytes: number;
  termCount: number;
  avgPostingsPerTerm: number;
}

export interface ToolSearchKey {
  server: string;
  tool: string;
  registry_key?: string;
}

export interface Indexer {
  readonly name: string;
  build(tools: ToolSearchDocument[]): Promise<void>;
  addTools(tools: ToolSearchDocument[]): Promise<void>;
  removeTools(keys: Array<string | ToolSearchKey>): Promise<void>;
  search(query: string, k: number): ToolSearchResult[];
  getStats(): ToolSearchStats;
}

interface Posting {
  docId: number;
  tf: number;
}

export const BM25_PARAMS: BM25Params = { k1: 2.0, b: 0.5 };
export const BM25_PREPROC: BM25Preproc = { stopwords: true, stemming: false };
export const NAME_BOOST = 3;
export const BM25_DELTA = 0.25;

function lightStem(token: string): string {
  if (token.length < 4) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ied') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2);
  if (token.endsWith('ches') || token.endsWith('shes')) return token.slice(0, -2);
  if (token.endsWith('xes') && token.length > 4) return token.slice(0, -2);
  if (token.endsWith('ing') && token.length > 5) {
    let base = token.slice(0, -3);
    const last = base.at(-1);
    const previous = base.at(-2);
    if (last !== undefined && last === previous && !'aeiou'.includes(last)) base = base.slice(0, -1);
    return base;
  }
  if (token.endsWith('ed') && token.length > 4) {
    let base = token.slice(0, -2);
    const last = base.at(-1);
    const previous = base.at(-2);
    if (last !== undefined && last === previous && !'aeiou'.includes(last)) base = base.slice(0, -1);
    return base;
  }
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us') && !token.endsWith('is') && token.length > 3) {
    return token.slice(0, -1);
  }
  return token;
}

function splitIdentifier(token: string): string[] {
  if (!token) return [];
  const parts = token.split(/[_\-./]+/).filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    const subparts = part.split(/(?=[A-Z][a-z])|(?<=[a-z])(?=[A-Z])|(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])/);
    for (const subpart of subparts) {
      if (subpart) out.push(subpart.toLowerCase());
    }
  }
  if (parts.length > 1) out.push(parts.join('').toLowerCase());
  return out;
}

function tokenize(text: string, opts: BM25Preproc): string[] {
  if (!text) return [];
  const raw = text.split(/[^A-Za-z0-9_\-.]+/).filter(Boolean);
  const out: string[] = [];
  for (const token of raw) {
    if (/[_\-./]/.test(token) || /[A-Z]/.test(token)) {
      out.push(...splitIdentifier(token));
    } else {
      out.push(token.toLowerCase());
    }
  }

  let filtered = out.filter((token) => token.length >= 2 && !/^\d+$/.test(token));
  if (opts.stopwords) filtered = filtered.filter((token) => !ENGLISH_STOPWORDS.has(token));
  if (opts.stemming) filtered = filtered.map(lightStem);
  return filtered;
}

function registryKeyFor(document: Pick<ToolSearchDocument, 'server' | 'tool' | 'registry_key'>): string {
  return document.registry_key || `${document.server}__${document.tool}`;
}

function keyToRegistryKey(key: string | ToolSearchKey): string {
  if (typeof key === 'string') return key;
  return key.registry_key || `${key.server}__${key.tool}`;
}

export class PureBM25Indexer implements Indexer {
  readonly name = 'pure';

  #params: BM25Params;
  #preproc: BM25Preproc;
  #includeArgs: boolean;
  #nameBoost: number;
  #delta: number;

  #postings = new Map<string, Posting[]>();
  #docLengths: number[] = [];
  #documents: ToolSearchDocument[] = [];
  #keyIndex = new Map<string, number>();
  #deletedDocs = new Set<number>();
  #idfBoosted = new Map<string, number>();
  #idfDelta = new Map<string, number>();
  #liveDocCount = 0;
  #liveTokenCount = 0;
  #avgDl = 0;

  constructor(
    params: BM25Params = BM25_PARAMS,
    preproc: BM25Preproc = BM25_PREPROC,
    includeArgs = false,
    nameBoost = NAME_BOOST
  ) {
    this.#params = { ...params };
    this.#preproc = { ...preproc };
    this.#includeArgs = includeArgs;
    this.#nameBoost = nameBoost;
    this.#delta = BM25_DELTA;
  }

  build(tools: ToolSearchDocument[]): Promise<void> {
    this.#reset();
    this.#addFreshDocuments(tools);
    this.#recomputeIdf();
    return Promise.resolve();
  }

  addTools(tools: ToolSearchDocument[]): Promise<void> {
    let changed = false;
    for (const tool of tools) {
      const key = registryKeyFor(tool);
      const existing = this.#keyIndex.get(key);
      if (existing !== undefined && !this.#deletedDocs.has(existing)) {
        this.#removeLiveDocument(existing);
      }
      this.#indexDocument({ ...tool, registry_key: key });
      changed = true;
    }
    if (changed) this.#recomputeIdf();
    return Promise.resolve();
  }

  removeTools(keys: Array<string | ToolSearchKey>): Promise<void> {
    let changed = false;
    for (const key of keys) {
      const docId = this.#keyIndex.get(keyToRegistryKey(key));
      if (docId === undefined || this.#deletedDocs.has(docId)) continue;
      this.#removeLiveDocument(docId);
      changed = true;
    }
    if (changed) this.#recomputeIdf();
    return Promise.resolve();
  }

  search(query: string, k: number): ToolSearchResult[] {
    if (k <= 0 || this.#liveDocCount === 0) return [];
    const queryTokens = tokenize(query, this.#preproc);
    if (queryTokens.length === 0) return [];

    const seen = new Set<string>();
    const scores = new Float64Array(this.#docLengths.length);
    const oovIdf = Math.log(1 + (this.#liveDocCount + 0.5) / 0.5);
    const oovContribution = oovIdf * (this.#params.k1 + 1 + this.#delta);
    let queryMaxScore = 0;

    for (const token of queryTokens) {
      if (seen.has(token)) continue;
      seen.add(token);

      const postings = this.#postings.get(token);
      if (!postings) {
        queryMaxScore += oovContribution;
        continue;
      }

      const idfBoost = this.#idfBoosted.get(token) ?? 0;
      const idfFloor = this.#idfDelta.get(token) ?? 0;
      queryMaxScore += idfBoost + idfFloor;

      for (const posting of postings) {
        const docLength = this.#docLengths[posting.docId] ?? 0;
        const denom = posting.tf + this.#params.k1 * (1 - this.#params.b + this.#params.b * (docLength / this.#avgDl));
        scores[posting.docId] += (idfBoost * posting.tf) / denom + idfFloor;
      }
    }

    const ranked: Array<{ docId: number; score: number }> = [];
    for (let docId = 0; docId < scores.length; docId++) {
      if (scores[docId] > 0 && !this.#deletedDocs.has(docId)) ranked.push({ docId, score: scores[docId] });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, k).map(({ docId, score }) => ({
      ...this.#documents[docId],
      score,
      normalizedScore: queryMaxScore > 0 ? Math.min(1, score / queryMaxScore) : 0,
    }));
  }

  getStats(): ToolSearchStats {
    let sizeBytes = 0;
    let totalPostings = 0;
    for (const [term, postings] of this.#postings) {
      sizeBytes += term.length * 2 + postings.length * 24;
      totalPostings += postings.length;
    }
    sizeBytes += this.#documents.length * 96 + this.#docLengths.length * 8 + this.#idfBoosted.size * 16;
    return {
      documents: this.#liveDocCount,
      tokens: this.#liveTokenCount,
      sizeBytes,
      termCount: this.#postings.size,
      avgPostingsPerTerm: this.#postings.size ? totalPostings / this.#postings.size : 0,
    };
  }

  #reset(): void {
    this.#postings = new Map();
    this.#docLengths = [];
    this.#documents = [];
    this.#keyIndex = new Map();
    this.#deletedDocs = new Set();
    this.#idfBoosted = new Map();
    this.#idfDelta = new Map();
    this.#liveDocCount = 0;
    this.#liveTokenCount = 0;
    this.#avgDl = 0;
  }

  #addFreshDocuments(tools: ToolSearchDocument[]): void {
    for (const tool of tools) {
      const key = registryKeyFor(tool);
      const existing = this.#keyIndex.get(key);
      if (existing !== undefined && !this.#deletedDocs.has(existing)) this.#removeLiveDocument(existing);
      this.#indexDocument({ ...tool, registry_key: key });
    }
  }

  #indexDocument(tool: ToolSearchDocument): void {
    const nameTokens = tokenize(tool.tool, this.#preproc);
    const descriptionParts = [tool.description];
    if (this.#includeArgs && tool.argNames?.length) descriptionParts.push(tool.argNames.join(' '));
    const descriptionTokens = tokenize(descriptionParts.join(' '), this.#preproc);
    const docLength = nameTokens.length * this.#nameBoost + descriptionTokens.length;
    const docId = this.#docLengths.length;

    this.#docLengths.push(docLength);
    this.#documents.push({
      ...tool,
      argNames: tool.argNames ?? tool.arg_summary?.map((arg) => arg.name) ?? [],
      arg_summary: tool.arg_summary ?? [],
    });
    this.#keyIndex.set(tool.registry_key, docId);
    this.#liveDocCount++;
    this.#liveTokenCount += docLength;

    const termFrequency = new Map<string, number>();
    for (const token of nameTokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + this.#nameBoost);
    for (const token of descriptionTokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);

    for (const [term, tf] of termFrequency) {
      const postings = this.#postings.get(term) ?? [];
      postings.push({ docId, tf });
      this.#postings.set(term, postings);
    }
  }

  #removeLiveDocument(docId: number): void {
    this.#deletedDocs.add(docId);
    this.#liveDocCount--;
    this.#liveTokenCount -= this.#docLengths[docId] ?? 0;
    this.#keyIndex.delete(this.#documents[docId]?.registry_key);

    for (const [term, postings] of this.#postings) {
      const nextPostings = postings.filter((posting) => posting.docId !== docId);
      if (nextPostings.length === 0) {
        this.#postings.delete(term);
      } else if (nextPostings.length !== postings.length) {
        this.#postings.set(term, nextPostings);
      }
    }
  }

  #recomputeIdf(): void {
    this.#avgDl = this.#liveTokenCount / Math.max(1, this.#liveDocCount);
    this.#idfBoosted = new Map();
    this.#idfDelta = new Map();

    const k1PlusOne = this.#params.k1 + 1;
    for (const [term, postings] of this.#postings) {
      const df = postings.length;
      const idf = Math.log(1 + (this.#liveDocCount - df + 0.5) / (df + 0.5));
      this.#idfBoosted.set(term, idf * k1PlusOne);
      this.#idfDelta.set(term, idf * this.#delta);
    }
  }
}
