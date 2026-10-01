/**
 * Per-day reminder delivery log (admin "Reminders" stats). Bucketed by the
 * reminder's `targetDate` — the user's LOCAL day — so an answer, which carries
 * the same targetDate (see root gotcha #1), finds its record without a scan.
 */
export type ReminderResponse = 'complete' | 'drop' | 'skip';

/** `reminder` = a habit reminder was sent; `pause` = auto-pause notice was sent instead. */
export type ReminderLogKind = 'reminder' | 'pause';

export interface ReminderLogEntry {
  kind: ReminderLogKind;
  userId: number;
  habitId: string;
  habitName: string;
  username?: string;
  targetDate: string; // YYYY-MM-DD, user-local
  sentAt: string; // ISO UTC of the first send that day
  sends: number; // > 1 when "Check later" re-asked the same day
  response?: ReminderResponse; // latest answer to a sent reminder
  respondedAt?: string; // ISO UTC
}

export interface ReminderLogSentInput {
  kind: ReminderLogKind;
  userId: number;
  habitId: string;
  habitName: string;
  username?: string;
  targetDate: string;
}

export interface ReminderDaySummary {
  date: string;
  sent: number; // reminders (not pause notices) sent, re-asks counted once
  sends: number; // total messages incl. "Check later" re-asks
  complete: number;
  drop: number;
  skip: number;
  noAnswer: number;
  paused: number; // auto-pause notices
  users: number; // distinct users who got a reminder or pause notice
}
