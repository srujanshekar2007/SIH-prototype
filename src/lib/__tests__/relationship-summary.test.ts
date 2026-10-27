import { describe, expect, it, vi } from 'vitest';
import { fetchDashboardRelationshipSummary } from '../supabase';

describe('dashboard relationship summary', () => {
  it('calls the scoped summary RPC and normalizes its response shape', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { pending_count: '8', case_ids: ['case-1'], by_bureau: [{ name: 'RB', value: 8 }], recent: [{ id: 'rel-1' }] },
      error: null,
    });
    const result = await fetchDashboardRelationshipSummary({ rpc } as any);

    expect(rpc).toHaveBeenCalledWith('dashboard_relationship_summary');
    expect(result).toEqual({
      data: { pending_count: 8, case_ids: ['case-1'], by_bureau: [{ name: 'RB', value: 8 }], recent: [{ id: 'rel-1' }] },
      error: null,
    });
  });

  it('does not replace RPC failures with fabricated empty summary data', async () => {
    const error = { message: 'permission denied' };
    const result = await fetchDashboardRelationshipSummary({ rpc: vi.fn().mockResolvedValue({ data: null, error }) } as any);
    expect(result).toEqual({ data: null, error });
  });
});
