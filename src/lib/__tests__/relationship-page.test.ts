import { describe, expect, it, vi } from 'vitest';
import { fetchRelationshipReviewPage } from '../supabase';

describe('paginated relationship review query', () => {
  it('calls the authorized page RPC with filters and a bounded offset', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { rows: [{ id: 'relation-51', review_status: 'pending' }], total_count: 71 },
      error: null,
    });
    const result = await fetchRelationshipReviewPage({ rpc } as any, {
      page: 3,
      pageSize: 25,
      status: 'pending',
      bureauId: 'bureau-id',
      institutionId: 'institution-id',
      minimumSimilarity: 0.65,
    });

    expect(rpc).toHaveBeenCalledWith('dashboard_relationship_review_page', {
      p_review_status: 'pending',
      p_bureau_id: 'bureau-id',
      p_institution_id: 'institution-id',
      p_min_similarity: 0.65,
      p_page_size: 25,
      p_page_offset: 50,
    });
    expect(result).toEqual({ data: { rows: [{ id: 'relation-51', review_status: 'pending' }], totalCount: 71 }, error: null });
  });

  it('keeps page failures distinct from an empty result', async () => {
    const error = { code: '57014', message: 'canceling statement due to statement timeout' };
    const result = await fetchRelationshipReviewPage({ rpc: vi.fn().mockResolvedValue({ data: null, error }) } as any, {
      page: 1, pageSize: 25, status: null, bureauId: null, institutionId: null, minimumSimilarity: null,
    });
    expect(result.data).toBeNull();
    expect(result.error).toBe(error);
  });

  it('rejects malformed page counts instead of displaying them as zero', async () => {
    const result = await fetchRelationshipReviewPage({ rpc: vi.fn().mockResolvedValue({ data: { rows: [], total_count: '0' }, error: null }) } as any, {
      page: 1, pageSize: 25, status: null, bureauId: null, institutionId: null, minimumSimilarity: null,
    });
    expect(result.data).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });
});
