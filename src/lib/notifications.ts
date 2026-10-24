import type { CaseRow } from './supabase';

export type DeadlineNotification = {
  case: CaseRow;
  kind: 'overdue' | 'due-soon';
  deadlineAt: string;
  deadlineMs: number;
};

const HOUR_MS = 60 * 60 * 1000;

/** Classify authorized, active cases using the same recorded dates as Alerts & Deadlines. */
export function getDeadlineNotifications(
  cases: CaseRow[],
  now = new Date(),
  dueSoonHours = 48,
): DeadlineNotification[] {
  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) return [];

  const uniqueCases = new Map<string, CaseRow>();
  for (const complaint of cases) {
    if (complaint?.id && !uniqueCases.has(complaint.id)) uniqueCases.set(complaint.id, complaint);
  }

  const notifications: DeadlineNotification[] = [];
  for (const complaint of uniqueCases.values()) {
    // Disposed is the only terminal case status in the database enum. Transferred and
    // Escalated remain active and continue to need deadline monitoring.
    if (complaint.status === 'Disposed') continue;

    const deadlines = [complaint.next_action_at, complaint.expected_disposal_at]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => ({ value, time: Date.parse(value) }))
      .filter((deadline) => Number.isFinite(deadline.time))
      .sort((a, b) => a.time - b.time);

    const oldestMissed = deadlines.find((deadline) => deadline.time < nowMs);
    if (oldestMissed) {
      notifications.push({ case: complaint, kind: 'overdue', deadlineAt: oldestMissed.value, deadlineMs: oldestMissed.time });
      continue;
    }

    const nextDeadline = deadlines[0];
    if (nextDeadline && nextDeadline.time <= nowMs + dueSoonHours * HOUR_MS) {
      notifications.push({ case: complaint, kind: 'due-soon', deadlineAt: nextDeadline.value, deadlineMs: nextDeadline.time });
    }
  }

  return notifications.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'overdue' ? -1 : 1;
    return a.deadlineMs - b.deadlineMs;
  });
}
