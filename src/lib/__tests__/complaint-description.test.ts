import { describe, expect, it, vi } from 'vitest';
import { fetchComplaintCases } from '../supabase';

describe('complaint descriptions', () => {
  it('selects and preserves the stored description in complaint rows', async () => {
    const description = 'Complainant: Sample Student\nEvidence: Submitted document';
    const query: any = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      range: vi.fn(async () => ({ data: [{ id: 'case-1', description }], error: null })),
    };
    const client = { from: vi.fn(() => query) };

    const result = await fetchComplaintCases(client as any);

    expect(client.from).toHaveBeenCalledWith('complaints');
    expect(query.select.mock.calls[0][0]).toContain('description');
    expect(result.error).toBeNull();
    expect(result.data?.[0].description).toBe(description);
  });
});
