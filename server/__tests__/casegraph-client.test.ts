import { describe, expect, it, vi } from 'vitest';
import { requestCaseGraphScores, CaseGraphServiceError } from '../casegraph-client';
import { makeSuggestionFromScore, type ComplaintForMatching } from '../semantic-matching';

const complaint = (id: string, bureau: string): ComplaintForMatching => ({
  id, case_number: id, institution_id: 'institution', category: 'scholarship',
  subject: `Scholarship payment complaint from ${id}`, description: 'The scholarship payment has not been credited to the student account.',
  status: 'Pending', bureau_id: bureau, received_at: '2026-10-01',
});

describe('CaseGraph server integration', () => {
  it('sends only redacted candidate text with the server key and validates the model score', async () => {
    const source = complaint('case-a', 'bureau-a');
    source.description = 'Complainant: Sensitive Person. Scholarship payment is not credited to the student account.';
    const target = complaint('case-b', 'bureau-b');
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer server-key');
      const body = JSON.parse(String(init?.body));
      expect(body.threshold).toBe(-1);
      expect(JSON.stringify(body)).not.toContain('Sensitive Person');
      return Response.json({
        model_id: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
        matches: [{ complaint_a_id: 'case-a', complaint_b_id: 'case-b', similarity: 0.83 }],
      });
    });
    const pairs = [{ source, target, key: 'case-a:case-b' }];
    const scores = await requestCaseGraphScores(pairs, 'https://matching.example/', 'server-key', fetcher as typeof fetch);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(scores.get('case-a:case-b')).toBe(0.83);
    const suggestion = makeSuggestionFromScore(pairs[0], 0.83, 0.78, 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2');
    expect(suggestion.shouldInsert).toBe(true);
    expect(suggestion.explanation.scoreMeaning).toContain('not a probability');
  });

  it('fails closed on an invalid response and classifies service timeouts', async () => {
    const pairs = [{ source: complaint('case-a', 'bureau-a'), target: complaint('case-b', 'bureau-b'), key: 'case-a:case-b' }];
    await expect(requestCaseGraphScores(pairs, 'https://matching.example', 'key', (async () => Response.json({ model_id: 'wrong', matches: [] })) as typeof fetch))
      .rejects.toBeInstanceOf(CaseGraphServiceError);
    const timeout = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    await expect(requestCaseGraphScores(pairs, 'https://matching.example', 'key', (async () => { throw timeout; }) as typeof fetch))
      .rejects.toMatchObject({ kind: 'timeout' });
  });
});
