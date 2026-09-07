import { Habit } from '../entities/Habit';
import { computeCheckHistory } from './HabitAnalytics';

/** Days shown in the admin activity heatmap (trailing window ending today). */
export const HEATMAP_WINDOW_DAYS = 365;

/** One character per day. Kept single-char so a year fits in ~365 bytes. */
export const ACTIVITY_NONE = '0';
export const ACTIVITY_DROPPED = '1';
export const ACTIVITY_SKIPPED = '2';
export const ACTIVITY_COMPLETED = '3';

export interface HabitActivity {
  /** YYYY-MM-DD of the first day in `days` */
  start: string;
  /** YYYY-MM-DD of the last day in `days` */
  end: string;
  /** `days.length === daysBetween(start, end) + 1`, one ACTIVITY_* char per day */
  days: string;
}

/**
 * Mirrors the date normalization inside `computeCheckHistory` (local midnight →
 * `toISOString()`), so the window boundaries and the history entries always agree
 * on what a given calendar day is called. On a non-UTC runtime both are shifted
 * the same way, which keeps the heatmap internally consistent.
 */
function toDayString(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
}

function typeToChar(type: 'completed' | 'skipped' | 'dropped'): string {
  if (type === 'completed') return ACTIVITY_COMPLETED;
  if (type === 'skipped') return ACTIVITY_SKIPPED;
  return ACTIVITY_DROPPED;
}

/**
 * Compact per-day activity for one habit, covering the last `windowDays` days
 * (clamped to the habit's creation date).
 *
 * Caveats inherited from `computeCheckHistory` (see CLAUDE.md gotcha #14):
 * - days after `lastCheckedDate` are never inferred as completed, so trailing
 *   misses render as gaps;
 * - an *interior* silently-missed day still infers as completed;
 * - for `disabled` habits or habits with reminders off, only explicit
 *   skips/drops are returned — completions are not inferred at all.
 */
export function buildHabitActivity(
  habit: Habit,
  windowDays: number = HEATMAP_WINDOW_DAYS,
  now: Date = new Date()
): HabitActivity {
  const end = toDayString(now);

  const windowStart = new Date(now);
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (windowDays - 1));
  let start = toDayString(windowStart);

  if (habit.createdAt) {
    const created = toDayString(new Date(habit.createdAt));
    if (created > start) start = created;
  }
  // Habit created in the future (clock skew / bad data) — collapse to a single day.
  if (start > end) start = end;

  const byDate = new Map<string, string>();
  for (const entry of computeCheckHistory(habit)) {
    byDate.set(entry.date, typeToChar(entry.type));
  }

  // Iterate in UTC: the calendar-day sequence is identical to advancing local
  // midnight, and it cannot drift across a DST boundary.
  const chars: string[] = [];
  const cursor = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (cursor.getTime() <= last.getTime()) {
    const key = cursor.toISOString().split('T')[0];
    chars.push(byDate.get(key) || ACTIVITY_NONE);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return { start, end, days: chars.join('') };
}
