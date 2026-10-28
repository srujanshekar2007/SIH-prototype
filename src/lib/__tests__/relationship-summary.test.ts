import { describe, expect, it, vi } from 'vitest';
import { fetchDashboardRelationshipSummary } from '../supabase';

describe('dashboard relationship summary', () => {
  it('calls the scoped summary RPC and normalizes its response shape', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { pending_count: 8, case_ids: ['case-1'], by_bureau: [{ name: 'RB', value: 8 }], recent: [{ id: 'rel-1' }] },
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

  it('explains how to repair a missing summary function or stale PostgREST schema cache', async () => {
    const result = await fetchDashboardRelationshipSummary({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST202', message: 'Could not find the function public.dashboard_relationship_summary without parameters in the schema cache' },
      }),
    } as any);
    expect(result.data).toBeNull();
    expect(result.error?.message).toContain('202610280001_dashboard_relationship_rpcs.sql');
    expect(result.error?.message).toContain("NOTIFY pgrst, 'reload schema'");
  });

  it('accepts a genuine empty result but rejects missing or malformed counts', async () => {
    const empty = await fetchDashboardRelationshipSummary({ rpc: vi.fn().mockResolvedValue({ data: { pending_count: 0, case_ids: [], by_bureau: [], recent: [] }, error: null }) } as any);
    expect(empty.data?.pending_count).toBe(0);
    expect(empty.error).toBeNull();

    for (const data of [null, {}, { pending_count: '0', case_ids: [], by_bureau: [], recent: [] }, { pending_count: -1, case_ids: [], by_bureau: [], recent: [] }, { pending_count: 0 }]) {
      const result = await fetchDashboardRelationshipSummary({ rpc: vi.fn().mockResolvedValue({ data, error: null }) } as any);
      expect(result.data).toBeNull();
      expect(result.error).toBeInstanceOf(Error);
    }
  });

  it('turns thrown network errors into an explicit failed result', async () => {
    const error = new Error('network unavailable');
    const result = await fetchDashboardRelationshipSummary({ rpc: vi.fn().mockRejectedValue(error) } as any);
    expect(result).toEqual({ data: null, error });
  });
});
