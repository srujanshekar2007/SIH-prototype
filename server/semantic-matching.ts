import { createHash } from 'node:crypto';

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const MATCHING_VERSION = 'institution-blocked-cosine-v1';
export const MAX_AUTHORIZED_CASES = 500;
export const MAX_CANDIDATE_PAIRS = 25000;
export const EMBEDDING_BATCH_SIZE = 64;
export const MAX_UNCACHED_EMBEDDINGS_PER_RUN = 128;
export const EMBEDDING_REQUEST_TIMEOUT_MS = 20_000;

export function resolveSimilarityThreshold(configured: string | undefined, requested: unknown):
  | { value: number; source: 'configured' | 'request' }
  | { error: 'invalid_configuration' | 'invalid_request' } {
  const configuredValue = Number(configured ?? '0.78');
  if ((configured !== undefined && !configured.trim()) || !Number.isFinite(configuredValue) || configuredValue < 0 || configuredValue > 1) {
    return { error: 'invalid_configuration' };
  }
  if (requested === undefined || requested === null) return { value: configuredValue, source: 'configured' };
  if (typeof requested !== 'number' || !Number.isFinite(requested) || requested < 0 || requested > 1) {
    return { error: 'invalid_request' };
  }
  return { value: requested, source: 'request' };
}

export type ComplaintForMatching = {
  id: string;
  case_number: string;
  institution_id: string;
  category: string | null;
  subject: string | null;
  description: string | null;
  status: string;
  bureau_id: string | null;
  assigned_officer_id?: string | null;
  received_at: string;
  institutions?: { name?: string | null; aicte_permanent_id?: string | null; internal_id?: string | null } | null;
  bureaus?: { name?: string | null } | null;
};

export type CandidatePair = { source: ComplaintForMatching; target: ComplaintForMatching; key: string };
export type PersistedSuggestion = CandidatePair & {
  similarity: number;
  sourceTextHash: string;
  targetTextHash: string;
  matchingFields: string[];
  reasons: string[];
  explanation: Record<string, unknown>;
  shouldInsert: boolean;
};
export type MatchingProfile = { active: boolean; is_admin: boolean; role: string; bureau_id: string | null; can_manage_bureau?: boolean | null };

export function canActorCompareCase(row: ComplaintForMatching, profile: MatchingProfile, actorId: string): boolean {
  if (!profile.active) return false;
  if (profile.is_admin) return true;
  if (row.assigned_officer_id === actorId && ['pgrc_officer', 'rb_officer', 'bureau_officer'].includes(profile.role)) return true;
  return ['pgrc_officer', 'rb_officer', 'bureau_officer'].includes(profile.role)
    && profile.can_manage_bureau !== false
    && row.bureau_id === profile.bureau_id;
}

export function parseEmbeddingBatch(payload: unknown, expectedCount: number, dimensions = 1536): number[][] {
  const data = (payload as { data?: { index?: number; embedding?: number[] }[] } | null)?.data;
  if (!Array.isArray(data) || data.length !== expectedCount) throw new Error('The embedding provider returned an incomplete response.');
  const ordered = [...data].sort((a, b) => Number(a.index) - Number(b.index));
  if (ordered.some((item, index) => item.index !== index || !Array.isArray(item.embedding) || item.embedding.length !== dimensions || item.embedding.some((value) => !Number.isFinite(value)))) {
    throw new Error('The embedding provider returned an invalid vector.');
  }
  return ordered.map((item) => item.embedding!);
}

export class EmbeddingProviderError extends Error {
  constructor(public readonly kind: 'timeout' | 'rate_limit' | 'provider' | 'invalid_response') {
    super(`Embedding provider ${kind.replace('_', ' ')}.`);
  }
}

export async function requestEmbeddingBatch(
  texts: string[],
  apiKey: string,
  model: string,
  fetcher: typeof fetch = fetch,
): Promise<number[][]> {
  let response: Response;
  try {
    response = await fetcher('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts, encoding_format: 'float' }),
      signal: AbortSignal.timeout(EMBEDDING_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new EmbeddingProviderError('timeout');
    throw new EmbeddingProviderError('provider');
  }
  if (response.status === 429) throw new EmbeddingProviderError('rate_limit');
  if (!response.ok) throw new EmbeddingProviderError('provider');
  try {
    return parseEmbeddingBatch(await response.json(), texts.length);
  } catch {
    throw new EmbeddingProviderError('invalid_response');
  }
}

export function complaintEmbeddingText(row: ComplaintForMatching): string | null {
  const fields = [
    row.subject && `Subject: ${row.subject}`,
    row.category && `Category: ${row.category}`,
    row.description && `Description: ${row.description}`,
  ].filter(Boolean);
  const text = redactComplaintIdentifiers(fields.join('\n')).replace(/\s+/g, ' ').trim().slice(0, 8000);
  const words = text.match(/[\p{L}\p{N}]+/gu) || [];
  return words.length >= 5 ? text : null;
}

/** Remove common structured personal identifiers before text is hashed, cached, or sent to embeddings. */
export function redactComplaintIdentifiers(value: string): string {
  return value
    // Labels may follow a field prefix such as "Description: Complainant: ...".
    // Remove only the labelled value, so same-line complaint narrative survives.
    .replace(/\b(?:complainant|student|applicant|parent|contact person)(?:'s)?(?:\s+(?:full\s+)?name)?\s*[:=#-]\s*[^,\n;.]+/giu, '[redacted name]')
    .replace(/\b(?:sample\s+)?(?:student|roll|registration|enrollment|application|employee)\s*(?:id|number|no\.?)\s*[:=#-]\s*[A-Z0-9][A-Z0-9_-]*/giu, '[redacted identifier]')
    .replace(/\b(?:sample\s+)?(?:e-?mail|phone|mobile|contact number)\s*[:=#-]\s*[^,\n;.]+/giu, '[redacted contact]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[redacted email]')
    .replace(/\b(?:aadhaar|aadhar|pan|passport|voter)\s*(?:id|number|no\.?)?\s*[:=#-]?\s*[A-Z0-9-]{6,}\b/giu, '[redacted identity number]')
    .replace(/\+?\d[\d\s().-]{8,}\d/g, (match) => {
      const digits = match.replace(/\D/g, '');
      return digits.length >= 10 && digits.length <= 15 ? '[redacted phone]' : match;
    });
}

export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function relationshipKey(a: string, b: string): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

export function buildCandidatePairs(
  rows: ComplaintForMatching[],
  existing: Map<string, { review_status: string; semantic_similarity: number | null; semantic_model: string | null; source_text_hash: string | null; target_text_hash: string | null; explanation?: { threshold?: number } | null }>,
  model: string,
  limit = MAX_CANDIDATE_PAIRS,
  threshold?: number,
): CandidatePair[] {
  const institutions = new Map<string, ComplaintForMatching[]>();
  for (const row of rows) {
    if (!row.institution_id || !row.bureau_id || !complaintEmbeddingText(row)) continue;
    const group = institutions.get(row.institution_id) || [];
    group.push(row);
    institutions.set(row.institution_id, group);
  }
  const pairs: CandidatePair[] = [];
  for (const group of institutions.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const first = group[i];
        const second = group[j];
        if (first.bureau_id === second.bureau_id) continue;
        const source = first.id < second.id ? first : second;
        const target = source === first ? second : first;
        const key = relationshipKey(source.id, target.id);
        const row = existing.get(key);
        if (row && row.review_status !== 'pending') continue;
        const sourceHash = textHash(complaintEmbeddingText(source)!);
        const targetHash = textHash(complaintEmbeddingText(target)!);
        const scoreIsCurrent = row?.semantic_similarity !== null && row?.semantic_similarity !== undefined
          && row.semantic_model === model && row.source_text_hash === sourceHash && row.target_text_hash === targetHash;
        const thresholdIsCurrent = threshold === undefined || row?.explanation?.threshold === threshold;
        if (scoreIsCurrent && thresholdIsCurrent) continue;
        pairs.push({ source, target, key });
        if (pairs.length > limit) throw new Error('Too many cross-bureau candidates for one run. Narrow the authorized institution scope or use indexed retrieval for a larger dataset.');
      }
    }
  }
  return pairs;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || a.length !== b.length || a.some((value) => !Number.isFinite(value)) || b.some((value) => !Number.isFinite(value))) {
    throw new Error('The embedding provider returned an invalid vector.');
  }
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) throw new Error('The embedding provider returned a zero vector.');
  return Math.max(-1, Math.min(1, dot / Math.sqrt(normA * normB)));
}

export function makeSuggestion(pair: CandidatePair, vectors: Map<string, number[]>, threshold: number): PersistedSuggestion {
  const sourceText = complaintEmbeddingText(pair.source)!;
  const targetText = complaintEmbeddingText(pair.target)!;
  const similarity = cosineSimilarity(vectors.get(pair.source.id) || [], vectors.get(pair.target.id) || []);
  const reasons = [
    'Same canonical institution record',
    `Different handling units: ${pair.source.bureaus?.name || 'Bureau/Cell'} and ${pair.target.bureaus?.name || 'Bureau/Cell'}`,
    `Semantic complaint-text cosine similarity ${similarity.toFixed(3)}`,
  ];
  if (pair.source.category && pair.target.category && pair.source.category !== pair.target.category) {
    reasons.push(`Categories differ (${pair.source.category} / ${pair.target.category}); retained for review`);
  }
  return {
    ...pair,
    similarity,
    sourceTextHash: textHash(sourceText),
    targetTextHash: textHash(targetText),
    matchingFields: ['subject', 'category', 'description', 'institution_id', 'bureau_id'],
    reasons,
    explanation: {
      method: 'Cosine similarity between OpenAI text embeddings of subject, category, and description.',
      scoreMeaning: 'Raw cosine similarity in [-1, 1]; it is not a probability or a verified duplicate score.',
      threshold,
      humanReviewRequired: true,
      contextualDifferences: {
        category: pair.source.category === pair.target.category ? 'same' : 'different or missing',
        status: pair.source.status === pair.target.status ? 'same' : 'different',
        receivedDate: [pair.source.received_at, pair.target.received_at],
      },
    },
    shouldInsert: similarity >= threshold,
  };
}

