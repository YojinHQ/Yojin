/** English stopwords — common words that dilute BM25 scoring. */
const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'it',
  'its',
  'this',
  'that',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'can',
  'not',
  'no',
  'so',
  'if',
  'as',
  'up',
  'out',
  'about',
  'into',
  'over',
  'after',
]);

/**
 * BM25Okapi index for lexical similarity search. Zero dependencies.
 *
 * Uses the Lucene/ATIRE IDF variant: log((N - n + 0.5) / (n + 0.5) + 1)
 * which prevents negative IDF for terms appearing in >50% of documents.
 *
 * Pre-computes TF maps and IDF values at build() time so search() is O(query_terms × N)
 * with only map lookups — no per-document tokenization or frequency counting.
 */
export class BM25Index {
  /** Per-document token lengths (for length normalization). */
  private docLens: number[] = [];
  /** Pre-computed per-document term frequency maps. */
  private docTfMaps: Map<string, number>[] = [];
  /** Pre-computed IDF for each term in the corpus. */
  private idf = new Map<string, number>();
  private avgDocLen = 0;
  private readonly k1: number;
  private readonly b: number;

  constructor(options?: { k1?: number; b?: number }) {
    this.k1 = options?.k1 ?? 1.2;
    this.b = options?.b ?? 0.75;
  }

  /** Tokenize text: lowercase, split on word boundaries, remove stopwords. */
  tokenize(text: string): string[] {
    const raw = text.toLowerCase().match(/\b\w+\b/g);
    if (!raw) return [];
    return raw.filter((t) => !STOPWORDS.has(t));
  }

  /** Build index from raw text documents. Pre-computes TF maps and IDF values. */
  build(documents: string[]): void {
    const tokenized = documents.map((d) => this.tokenize(d));
    const N = tokenized.length;
    const docFreq = new Map<string, number>();

    // Pre-compute per-document TF maps and document frequencies
    this.docTfMaps = [];
    this.docLens = [];
    let totalLen = 0;

    for (const doc of tokenized) {
      const tf = new Map<string, number>();
      const seen = new Set<string>();

      for (const term of doc) {
        tf.set(term, (tf.get(term) ?? 0) + 1);
        if (!seen.has(term)) {
          docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
          seen.add(term);
        }
      }

      this.docTfMaps.push(tf);
      this.docLens.push(doc.length);
      totalLen += doc.length;
    }

    this.avgDocLen = N > 0 ? totalLen / N : 0;

    // Pre-compute IDF for every term in the corpus
    this.idf.clear();
    for (const [term, n] of docFreq) {
      this.idf.set(term, Math.log((N - n + 0.5) / (n + 0.5) + 1));
    }
  }

  /** Score a query against all documents, return top-N ranked results. */
  search(query: string, topN?: number): Array<{ index: number; score: number }> {
    const N = this.docTfMaps.length;
    if (N === 0) return [];

    const queryTerms = this.tokenize(query);
    if (queryTerms.length === 0) return [];

    const scores: Array<{ index: number; score: number }> = [];

    for (let i = 0; i < N; i++) {
      const tf = this.docTfMaps[i];
      const docLen = this.docLens[i];

      let score = 0;
      for (const term of queryTerms) {
        const termIdf = this.idf.get(term);
        if (termIdf === undefined) continue;

        const termTf = tf.get(term);
        if (termTf === undefined) continue;

        const tfNorm =
          (termTf * (this.k1 + 1)) / (termTf + this.k1 * (1 - this.b + this.b * (docLen / this.avgDocLen)));
        score += termIdf * tfNorm;
      }

      scores.push({ index: i, score });
    }

    // Normalize scores to 0-1 range (divide by max score)
    const maxScore = scores.reduce((max, s) => Math.max(max, s.score), 0);
    if (maxScore > 0) {
      for (const s of scores) {
        s.score = s.score / maxScore;
      }
    }

    scores.sort((a, b) => b.score - a.score);
    const limit = topN ?? scores.length;
    return scores.slice(0, limit);
  }
}
