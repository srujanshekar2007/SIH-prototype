import { describe, expect, it, vi } from 'vitest';
import { fetchCaseActions } from '../supabase';

function mockClient(responses: any[]) {
  const selected: string[] = [];
  const query: any = {
    select: vi.fn((columns: string) => { selected.push(columns); return query; }),
    order: vi.fn(() => query),
    range: vi.fn(async () => responses.shift()),
  };
  return { client: { from: vi.fn(() => query) }, query, selected };
}

describe('case action schema compatibility', () => {
  it('queries only confirmed case_actions columns', async () => {
    const mock = mockClient([
      { data: [{ id: 'a1', action_type: 'note', remarks: 'History note' }], error: null },
    ]);

    const result = await fetchCaseActions(mock.client as any);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'a1', action_type: 'note', remarks: 'History note' }]);
    expect(mock.selected).toHaveLength(1);
    expect(mock.selected[0]).not.toContain('assigned_to');
  });

  it('loads assignment audit rows without assuming a target column', async () => {
    const action = { id: 'a1', action_type: 'assignment' };
    const mock = mockClient([{ data: [action], error: null }]);

    const result = await fetchCaseActions(mock.client as any);

    expect(result.data).toEqual([action]);
    expect(mock.selected).toHaveLength(1);
  });
});
