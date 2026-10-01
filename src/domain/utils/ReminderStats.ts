import { ReminderDaySummary, ReminderLogEntry } from '../entities/ReminderLog';

export function summarizeReminderDay(date: string, entries: ReminderLogEntry[]): ReminderDaySummary {
  const summary: ReminderDaySummary = {
    date,
    sent: 0,
    sends: 0,
    complete: 0,
    drop: 0,
    skip: 0,
    noAnswer: 0,
    paused: 0,
    users: 0,
  };
  const users = new Set<number>();

  for (const e of entries) {
    users.add(e.userId);
    if (e.kind === 'pause') {
      summary.paused++;
      continue;
    }
    summary.sent++;
    summary.sends += e.sends || 1;
    if (e.response === 'complete') summary.complete++;
    else if (e.response === 'drop') summary.drop++;
    else if (e.response === 'skip') summary.skip++;
    else summary.noAnswer++;
  }

  summary.users = users.size;
  return summary;
}

/** `count` YYYY-MM-DD dates ending at `endDate` inclusive, newest first. */
export function trailingDates(endDate: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${endDate}T00:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().split('T')[0]);
    d.setUTCDate(d.getUTCDate() - 1);
  }
  return out;
}
