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
  it('falls back to the initial-schema action fields when assignment migration is absent', async () => {
    const mock = mockClient([
      { data: null, error: { code: '42703', message: 'column case_actions.assigned_to does not exist' } },
      { data: null, error: { code: '42703', message: 'column case_actions.assigned_to does not exist' } },
      { data: [{ id: 'a1', action_type: 'note', remarks: 'History note' }], error: null },
    ]);

    const result = await fetchCaseActions(mock.client as any);

    expect(result.error).toBeNull();
    expect(result.data).toEqual([{ id: 'a1', action_type: 'note', remarks: 'History note', assigned_to: null, assigned_to_profile: null }]);
    expect(mock.selected).toHaveLength(3);
    expect(mock.selected[2]).not.toContain('assigned_to');
  });

  it('retains assignment details when the migration is present', async () => {
    const action = { id: 'a1', assigned_to: 'officer-1', assigned_to_profile: { display_name: 'Officer' } };
    const mock = mockClient([{ data: [action], error: null }]);

    const result = await fetchCaseActions(mock.client as any);

    expect(result.data).toEqual([action]);
    expect(mock.selected).toHaveLength(1);
  });
});
