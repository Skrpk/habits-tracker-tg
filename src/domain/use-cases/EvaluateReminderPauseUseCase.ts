import { Habit, ReminderSchedule } from '../entities/Habit';

/**
 * Auto-pause reminders after N consecutive ignored daily reminders.
 *
 * DAILY habits only — weekly/monthly/interval fire too rarely to be a nag/block
 * risk and are never miss-tracked or paused. The decision is PURE: `filterDueHabits`
 * returns the habits to send plus the exact `Partial<Habit>` updates, and performs
 * no persistence. The caller (reminder cron) persists a "toSend" update only after
 * the send succeeds, and "pausedNow" updates immediately (see api/reminders.ts).
 */

/** Consecutive misses that trigger a pause. */
export const REMINDER_MISS_THRESHOLD = parseInt(process.env.REMINDER_MISS_THRESHOLD || '2', 10);
/** Days a daily habit's reminders are paused once the threshold is hit. */
export const REMINDER_PAUSE_DAYS = parseInt(process.env.REMINDER_PAUSE_DAYS || '7', 10);

/** Only daily habits participate in auto-pause. A missing schedule defaults to daily (matches isDue). */
export function isAutoPauseEligible(schedule: ReminderSchedule | undefined): boolean {
  return !schedule || schedule.type === 'daily';
}

/** Add `n` days to a `YYYY-MM-DD` string, returning `YYYY-MM-DD` (UTC math, DST-safe). */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

export interface ReminderDecision {
  habit: Habit;
  update: Partial<Habit>;
}

export interface FilterDueResult {
  /** Habits that should be reminded now; persist `update` AFTER a successful send. */
  toSend: ReminderDecision[];
  /** Habits paused this tick; persist `update` immediately and send a one-time notice. */
  pausedNow: ReminderDecision[];
}

export class EvaluateReminderPauseUseCase {
  constructor(
    private threshold: number = REMINDER_MISS_THRESHOLD,
    private pauseDays: number = REMINDER_PAUSE_DAYS
  ) {}

  /**
   * Decide, for each due habit at `targetDate`, whether to send (and how to update
   * its miss state) or to pause it. Pure — no repository writes.
   */
  filterDueHabits(habits: Habit[], targetDate: string): FilterDueResult {
    const toSend: ReminderDecision[] = [];
    const pausedNow: ReminderDecision[] = [];

    for (const habit of habits) {
      // Non-daily schedules are never miss-tracked or paused.
      if (!isAutoPauseEligible(habit.reminderSchedule)) {
        toSend.push({ habit, update: {} });
        continue;
      }

      const pausedUntil = habit.remindersPausedUntil;
      // Defensive: still within an active pause (the cron gate normally filters these out).
      if (pausedUntil && targetDate < pausedUntil) {
        continue;
      }
      // Pause expired → resume with a clean slate (no miss counting on the resume occurrence).
      if (pausedUntil && targetDate >= pausedUntil) {
        toSend.push({
          habit,
          update: { remindersPausedUntil: undefined, missedReminderCount: 0, lastReminderDate: targetDate },
        });
        continue;
      }

      // Same-day re-ask (e.g. a "Check later" postpone re-firing) — resend, don't touch counters.
      if (habit.lastReminderDate === targetDate) {
        toSend.push({ habit, update: {} });
        continue;
      }

      // Was the previous reminder unanswered? Use `<` (not `!=`) so a more-recent
      // proactive check (lastCheckedDate past lastReminderDate) is not a false miss.
      const missed =
        !!habit.lastReminderDate &&
        habit.lastReminderDate !== targetDate &&
        (habit.lastCheckedDate || '') < habit.lastReminderDate;

      const newCount = missed ? (habit.missedReminderCount || 0) + 1 : 0;

      if (newCount >= this.threshold) {
        pausedNow.push({
          habit,
          update: { remindersPausedUntil: addDays(targetDate, this.pauseDays), missedReminderCount: 0 },
        });
      } else {
        toSend.push({
          habit,
          update: { missedReminderCount: newCount, lastReminderDate: targetDate },
        });
      }
    }

    return { toSend, pausedNow };
  }
}
