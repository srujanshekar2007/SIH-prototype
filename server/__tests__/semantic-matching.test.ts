import { describe, expect, it, vi } from 'vitest';
import {
  buildCandidatePairs,
  canActorCompareCase,
  complaintEmbeddingText,
  cosineSimilarity,
  EmbeddingProviderError,
  makeSuggestion,
  parseEmbeddingBatch,
  redactComplaintIdentifiers,
  relationshipKey,
  requestEmbeddingBatch,
  textHash,
  type ComplaintForMatching,
} from '../semantic-matching';

const sameInstitution = '11111111-1111-4111-8111-111111111111';
const otherInstitution = '22222222-2222-4222-8222-222222222222';
const bureauA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const bureauB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const actor = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const complaint = (overrides: Partial<ComplaintForMatching> = {}): ComplaintForMatching => ({
  id: crypto.randomUUID(), case_number: 'SYNTH-001', institution_id: sameInstitution,
  category: 'Student grievance', subject: 'Scholarship not credited after approval',
  description: 'The approved student scholarship payment has not reached the student account for this academic term.',
  status: 'Pending', bureau_id: bureauA, assigned_officer_id: null, received_at: '2026-01-01',
  bureaus: { name: 'Regulation Bureau' }, institutions: { name: 'Synthetic College' }, ...overrides,
});

describe('semantic overlap matching boundaries', () => {
  it('scores different wording with a semantically close embedding as a candidate, without asserting truth', () => {
    const a = complaint({ id: 'case-a' });
    const b = complaint({ id: 'case-b', bureau_id: bureauB, subject: 'Approved grant still missing from learner account', description: 'A learner reports that their sanctioned education grant has not been paid this term.' });
    const pairs = buildCandidatePairs([a, b], new Map(), 'text-embedding-3-small');
    const suggestion = makeSuggestion(pairs[0], new Map([['case-a', [1, 0]], ['case-b', [0.92, 0.392]]]), 0.78);
    expect(suggestion.similarity).toBeGreaterThan(0.78);
    expect(suggestion.shouldInsert).toBe(true);
    expect(suggestion.explanation.humanReviewRequired).toBe(true);
  });

  it('never compares semantically similar text for different institution identifiers', () => {
    const pairs = buildCandidatePairs([
      complaint({ id: 'case-a' }),
      complaint({ id: 'case-b', institution_id: otherInstitution, bureau_id: bureauB }),
    ], new Map(), 'text-embedding-3-small');
    expect(pairs).toEqual([]);
  });

  it('does not compare same-bureau records, and retains unrelated same-institution cases only below threshold', () => {
    const a = complaint({ id: 'case-a' });
    const sameBureau = complaint({ id: 'case-b' });
    expect(buildCandidatePairs([a, sameBureau], new Map(), 'text-embedding-3-small')).toEqual([]);
    const otherBureau = complaint({ id: 'case-c', bureau_id: bureauB, subject: 'Laboratory equipment inventory mismatch', description: 'A fictional institution reports discrepancies in the laboratory asset register and procurement ledger.' });
    const pair = buildCandidatePairs([a, otherBureau], new Map(), 'text-embedding-3-small')[0];
    const suggestion = makeSuggestion(pair, new Map([['case-a', [1, 0]], ['case-c', [-1, 0]]]), 0.78);
    expect(suggestion.similarity).toBe(-1);
    expect(suggestion.shouldInsert).toBe(false);
  });

  it('does not embed missing, empty, or very short complaint text', () => {
    expect(complaintEmbeddingText(complaint({ subject: null, category: null, description: null }))).toBeNull();
    expect(complaintEmbeddingText(complaint({ subject: 'Late fee', category: null, description: '' }))).toBeNull();
    expect(buildCandidatePairs([
      complaint({ id: 'case-a', subject: null, category: null, description: '' }),
      complaint({ id: 'case-b', bureau_id: bureauB }),
    ], new Map(), 'text-embedding-3-small')).toEqual([]);
  });

  it('redacts common labelled personal identifiers and direct email/phone values before embedding', () => {
    const safeText = complaintEmbeddingText(complaint({
      subject: 'Scholarship payment delayed',
      description: 'Complainant: Fictional Person\nSample student ID: DEMO-12345\nSample email: demo@example.test\nPhone: +91 98765 43210\nThe approved scholarship has not been credited for this term.',
    }));
    expect(safeText).toContain('The approved scholarship has not been credited');
    expect(safeText).not.toMatch(/Fictional Person|DEMO-12345|demo@example\.test|98765/);
    expect(redactComplaintIdentifiers('Student email demo@example.test and contact +1 (555) 123-4567')).not.toMatch(/demo@example\.test|555/);
  });

  it('skips confirmed/rejected pairs and avoids recomputing unchanged pending pairs', () => {
    const a = complaint({ id: 'case-a' });
    const b = complaint({ id: 'case-b', bureau_id: bureauB });
    const key = relationshipKey(a.id, b.id);
    const hashA = textHash(complaintEmbeddingText(a)!);
    const hashB = textHash(complaintEmbeddingText(b)!);
    expect(buildCandidatePairs([a, b], new Map([[key, { review_status: 'confirmed', semantic_similarity: null, semantic_model: null, source_text_hash: null, target_text_hash: null }]]), 'text-embedding-3-small')).toEqual([]);
    expect(buildCandidatePairs([a, b], new Map([[key, { review_status: 'pending', semantic_similarity: 0.9, semantic_model: 'text-embedding-3-small', source_text_hash: hashA, target_text_hash: hashB }]]), 'text-embedding-3-small')).toEqual([]);
  });

  it('checks caller action scope separately from RLS-visible reads', () => {
    const caseRow = complaint({ id: 'restricted', bureau_id: bureauA, assigned_officer_id: actor });
    expect(canActorCompareCase(caseRow, { active: true, is_admin: false, role: 'rb_officer', bureau_id: bureauA, can_manage_bureau: false }, actor)).toBe(true);
    expect(canActorCompareCase(caseRow, { active: true, is_admin: false, role: 'rb_officer', bureau_id: bureauB, can_manage_bureau: false }, 'other-user')).toBe(false);
    expect(canActorCompareCase(caseRow, { active: false, is_admin: true, role: 'administrator', bureau_id: null }, actor)).toBe(false);
    expect(canActorCompareCase(caseRow, { active: true, is_admin: true, role: 'administrator', bureau_id: null }, actor)).toBe(true);
  });

  it('rejects invalid provider payloads and invalid vectors', () => {
    expect(() => parseEmbeddingBatch({ data: [] }, 1, 2)).toThrow(/incomplete/);
    expect(() => parseEmbeddingBatch({ data: [{ index: 0, embedding: [1, Number.NaN] }] }, 1, 2)).toThrow(/invalid vector/);
    expect(parseEmbeddingBatch({ data: [{ index: 0, embedding: [0.25, 0.75] }] }, 1, 2)).toEqual([[0.25, 0.75]]);
    expect(() => cosineSimilarity([], [1])).toThrow(/invalid vector/);
  });

  it('maps provider timeouts and rate limits without leaking provider responses', async () => {
    await expect(requestEmbeddingBatch(['fictional complaint text'], 'test-key', 'test-model', vi.fn().mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' })) as typeof fetch))
      .rejects.toMatchObject({ kind: 'timeout' } satisfies Partial<EmbeddingProviderError>);
    await expect(requestEmbeddingBatch(['fictional complaint text'], 'test-key', 'test-model', vi.fn().mockResolvedValue(new Response('', { status: 429 })) as typeof fetch))
      .rejects.toMatchObject({ kind: 'rate_limit' } satisfies Partial<EmbeddingProviderError>);
  });
});
