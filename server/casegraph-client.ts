import type { CandidatePair } from './semantic-matching';
import { CASEGRAPH_MODEL_ID, complaintEmbeddingText, relationshipKey } from './semantic-matching';

export const MAX_CASEGRAPH_CASES_PER_REQUEST = 40;
const REQUEST_TIMEOUT_MS = 45_000;

export class CaseGraphServiceError extends Error {
  constructor(public readonly kind: 'timeout' | 'unavailable' | 'invalid_response') {
    super(`CaseGraph matching service ${kind.replace('_', ' ')}.`);
  }
}

type MatchResponse = {
  model_id?: unknown;
  matches?: { complaint_a_id?: unknown; complaint_b_id?: unknown; similarity?: unknown }[];
};

/** Sends only redacted text from already-authorized candidates; never complaint metadata. */
export async function requestCaseGraphScores(
  pairs: CandidatePair[],
  serviceUrl: string,
  serviceKey: string,
  fetcher: typeof fetch = fetch,
): Promise<Map<string, number>> {
  const batches: CandidatePair[][] = [];
  let batch: CandidatePair[] = [];
  let ids = new Set<string>();
  for (const pair of pairs) {
    const nextIds = new Set(ids).add(pair.source.id).add(pair.target.id);
    if (nextIds.size > MAX_CASEGRAPH_CASES_PER_REQUEST && batch.length) {
      batches.push(batch);
      batch = [];
      ids = new Set<string>();
    }
    batch.push(pair);
    ids.add(pair.source.id);
    ids.add(pair.target.id);
  }
  if (batch.length) batches.push(batch);

  const result = new Map<string, number>();
  for (const current of batches) {
    const candidateIds = new Set(current.flatMap(({ source, target }) => [source.id, target.id]));
    const rows = new Map<string, CandidatePair['source']>();
    for (const pair of current) {
      rows.set(pair.source.id, pair.source);
      rows.set(pair.target.id, pair.target);
    }
    const complaints = [...candidateIds].map((id) => ({ id, original_text: complaintEmbeddingText(rows.get(id)!) }));
    if (complaints.some((item) => !item.original_text)) throw new CaseGraphServiceError('invalid_response');

    let response: Response;
    try {
      response = await fetcher(`${serviceUrl.replace(/\/+$/, '')}/api/v1/matches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ complaints, threshold: -1 }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new CaseGraphServiceError(error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'unavailable');
    }
    if (!response.ok) throw new CaseGraphServiceError('unavailable');

    try {
      const payload = await response.json() as MatchResponse;
      if (payload.model_id !== CASEGRAPH_MODEL_ID || !Array.isArray(payload.matches)) throw new Error('invalid response');
      const expected = new Set(current.map(({ source, target }) => relationshipKey(source.id, target.id)));
      for (const match of payload.matches) {
        if (typeof match.complaint_a_id !== 'string' || typeof match.complaint_b_id !== 'string'
          || typeof match.similarity !== 'number' || !Number.isFinite(match.similarity)
          || match.similarity < -1 || match.similarity > 1) throw new Error('invalid score');
        const key = relationshipKey(match.complaint_a_id, match.complaint_b_id);
        // The model scores all pairs in its request; only persist pairs selected by AICTE's
        // same-institution/cross-bureau eligibility block.
        if (expected.has(key)) result.set(key, match.similarity);
      }
    } catch {
      throw new CaseGraphServiceError('invalid_response');
    }
  }
  if (result.size !== pairs.length) throw new CaseGraphServiceError('invalid_response');
  return result;
}
