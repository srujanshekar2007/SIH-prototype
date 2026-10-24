import { describe, expect, it } from 'vitest';
import { getDeadlineNotifications } from '../notifications';
import type { CaseRow } from '../supabase';

const now = new Date('2026-10-24T12:00:00.000Z');
const makeCase = (overrides: Partial<CaseRow> = {}): CaseRow => ({
  id: 'case-1', case_number: 'CASE-1', institution_id: 'inst-1', category: 'Academic', subject: 'Test subject',
  description: null, status: 'Pending', bureau_id: 'bureau-1', assigned_officer_id: 'officer-1',
  received_at: '2026-10-01T00:00:00.000Z', created_at: '2026-10-01T00:00:00.000Z',
  next_action_at: null, expected_disposal_at: null, priority: 'Normal',
  institutions: { name: 'Test Institute', region: null, internal_id: 'I-1' }, bureaus: { name: 'Test Bureau' },
  ...overrides,
});

describe('deadline notifications', () => {
  it('classifies the two supported deadlines in one unique case notification', () => {
    const rows = [
      makeCase({ id: 'overdue', case_number: 'OVERDUE', next_action_at: '2026-10-22T12:00:00.000Z' }),
      makeCase({ id: 'soon', case_number: 'SOON', next_action_at: '2026-10-26T00:00:00.000Z' }),
      makeCase({ id: 'later', case_number: 'LATER', next_action_at: '2026-10-26T12:00:01.000Z' }),
      makeCase({ id: 'invalid', next_action_at: 'not-a-date' }),
      makeCase({ id: 'missing' }),
    ];

    expect(getDeadlineNotifications(rows, now).map(({ case: complaint, kind }) => [complaint.case_number, kind])).toEqual([
      ['OVERDUE', 'overdue'], ['SOON', 'due-soon'],
    ]);
  });

  it('orders oldest overdue first, then the earliest upcoming deadline', () => {
    const rows = [
      makeCase({ id: 'due-late', next_action_at: '2026-10-26T11:00:00.000Z' }),
      makeCase({ id: 'overdue-recent', next_action_at: '2026-10-23T12:00:00.000Z' }),
      makeCase({ id: 'overdue-old', next_action_at: '2026-10-20T12:00:00.000Z' }),
      makeCase({ id: 'due-early', next_action_at: '2026-10-25T12:00:00.000Z' }),
    ];

    expect(getDeadlineNotifications(rows, now).map(({ case: complaint }) => complaint.id)).toEqual([
      'overdue-old', 'overdue-recent', 'due-early', 'due-late',
    ]);
  });

  it('uses an overdue operational date first and includes expected disposal when it is the relevant date', () => {
    const rows = [
      makeCase({ id: 'both', next_action_at: '2026-10-23T12:00:00.000Z', expected_disposal_at: '2026-10-26T00:00:00.000Z' }),
      makeCase({ id: 'disposal', expected_disposal_at: '2026-10-25T12:00:00.000Z' }),
    ];
    const notifications = getDeadlineNotifications(rows, now);

    expect(notifications.map(({ case: complaint, kind }) => [complaint.id, kind])).toEqual([
      ['both', 'overdue'], ['disposal', 'due-soon'],
    ]);
    expect(notifications[0].deadlineAt).toBe('2026-10-23T12:00:00.000Z');
  });

  it('excludes only Disposed cases and includes transferred and escalated cases while active', () => {
    const rows = [
      makeCase({ id: 'disposed', status: 'Disposed', next_action_at: '2026-10-23T12:00:00.000Z' }),
      makeCase({ id: 'transferred', status: 'Transferred', next_action_at: '2026-10-23T12:00:00.000Z' }),
      makeCase({ id: 'escalated', status: 'Escalated', next_action_at: '2026-10-25T12:00:00.000Z' }),
    ];

    expect(getDeadlineNotifications(rows, now).map(({ case: complaint }) => complaint.id)).toEqual(['transferred', 'escalated']);
  });

  it('includes deadlines exactly now and exactly 48 hours away, but not later deadlines', () => {
    const rows = [
      makeCase({ id: 'now', next_action_at: now.toISOString() }),
      makeCase({ id: 'boundary', next_action_at: '2026-10-26T12:00:00.000Z' }),
      makeCase({ id: 'outside', next_action_at: '2026-10-26T12:00:01.000Z' }),
    ];

    expect(getDeadlineNotifications(rows, now).map(({ case: complaint, kind }) => [complaint.id, kind])).toEqual([
      ['now', 'due-soon'], ['boundary', 'due-soon'],
    ]);
  });

  it('does not duplicate a case if the same row appears twice in input', () => {
    const row = makeCase({ next_action_at: '2026-10-23T12:00:00.000Z' });
    expect(getDeadlineNotifications([row, row], now)).toHaveLength(1);
  });
});
