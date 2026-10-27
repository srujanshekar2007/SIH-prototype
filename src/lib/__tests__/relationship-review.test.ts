import { describe, expect, it, vi } from 'vitest';
import { recordRelationshipReview } from '../relationship-review';

describe('recordRelationshipReview', () => {
  it.each(['confirmed', 'rejected'] as const)('records an official %s decision without updating complaint records', async (decision) => {
    const eq = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn((_payload: unknown) => ({ eq }));
    const from = vi.fn((table: string) => ({ update: (payload: unknown) => ({ ...update(payload), table }) }));
    const client = { from };
    await recordRelationshipReview(client, 'relation-id', decision, 'official-id', '2026-10-27T00:00:00.000Z');
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('case_relationships');
    expect(update).toHaveBeenCalledWith({ review_status: decision, reviewed_at: '2026-10-27T00:00:00.000Z', reviewed_by: 'official-id' });
    expect(eq).toHaveBeenCalledWith('id', 'relation-id');
  });
});
