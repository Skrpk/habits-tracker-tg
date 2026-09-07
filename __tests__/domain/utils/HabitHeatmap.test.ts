import { describe, it, expect } from 'vitest';
import {
  buildHabitActivity,
  ACTIVITY_NONE,
  ACTIVITY_DROPPED,
  ACTIVITY_SKIPPED,
  ACTIVITY_COMPLETED,
  HEATMAP_WINDOW_DAYS,
} from '../../../src/domain/utils/HabitHeatmap';
import { Habit } from '../../../src/domain/entities/Habit';

/**
 * Mirror the exact date→string transform used inside computeCheckHistory /
 * buildHabitActivity (local midnight → toISOString), so expectations hold in
 * any timezone.
 */
function dayStr(d: Date): string {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c.toISOString().split('T')[0];
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function baseHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    userId: 1,
    name: 'Read',
    streak: 0,
    createdAt: daysAgo(5),
    lastCheckedDate: '',
    skipped: [],
    dropped: [],
    checked: [],
    reminderSchedule: { type: 'daily', hour: 22, minute: 0 },
    reminderEnabled: true,
    ...overrides,
  };
}

describe('buildHabitActivity', () => {
  it('spans creation day → today inclusive', () => {
    const habit = baseHabit({ createdAt: daysAgo(5) });
    const activity = buildHabitActivity(habit);

    expect(activity.start).toBe(dayStr(daysAgo(5)));
    expect(activity.end).toBe(dayStr(new Date()));
    expect(activity.days).toHaveLength(6);
  });

  it('clamps the window to the last HEATMAP_WINDOW_DAYS days for old habits', () => {
    const habit = baseHabit({ createdAt: daysAgo(1000), streak: 1000, lastCheckedDate: dayStr(new Date()) });
    const activity = buildHabitActivity(habit);

    expect(activity.start).toBe(dayStr(daysAgo(HEATMAP_WINDOW_DAYS - 1)));
    expect(activity.days).toHaveLength(HEATMAP_WINDOW_DAYS);
  });

  it('encodes completed, skipped and dropped days', () => {
    const habit = baseHabit({
      createdAt: daysAgo(3),
      streak: 1,
      lastCheckedDate: dayStr(new Date()),
      skipped: [{ skippedDay: 1, date: dayStr(daysAgo(2)) }],
      dropped: [{ streakBeforeDrop: 1, date: dayStr(daysAgo(1)) }],
    });

    // days: [-3 completed, -2 skipped, -1 dropped, today completed]
    expect(buildHabitActivity(habit).days).toBe(
      ACTIVITY_COMPLETED + ACTIVITY_SKIPPED + ACTIVITY_DROPPED + ACTIVITY_COMPLETED
    );
  });

  it('leaves days after lastCheckedDate empty rather than inferring them', () => {
    const habit = baseHabit({
      createdAt: daysAgo(3),
      streak: 2,
      lastCheckedDate: dayStr(daysAgo(2)),
    });

    expect(buildHabitActivity(habit).days).toBe(
      ACTIVITY_COMPLETED + ACTIVITY_COMPLETED + ACTIVITY_NONE + ACTIVITY_NONE
    );
  });

  it('returns an all-empty window for a freshly created habit', () => {
    // Habits are created with lastCheckedDate: '' — nothing is inferred yet.
    const habit = baseHabit({ createdAt: daysAgo(2) });

    expect(buildHabitActivity(habit).days).toBe(ACTIVITY_NONE.repeat(3));
  });

  it('does not infer completions for a disabled habit, but keeps explicit events', () => {
    const habit = baseHabit({
      createdAt: daysAgo(2),
      streak: 3,
      lastCheckedDate: dayStr(new Date()),
      disabled: true,
      skipped: [{ skippedDay: 1, date: dayStr(daysAgo(1)) }],
    });

    expect(buildHabitActivity(habit).days).toBe(ACTIVITY_NONE + ACTIVITY_SKIPPED + ACTIVITY_NONE);
  });

  it('uses the explicit checked[] array for non-daily habits', () => {
    const habit = baseHabit({
      createdAt: daysAgo(3),
      streak: 2,
      lastCheckedDate: dayStr(daysAgo(1)),
      reminderSchedule: { type: 'weekly', daysOfWeek: [1, 4], hour: 9, minute: 0 },
      checked: [{ date: dayStr(daysAgo(3)) }, { date: dayStr(daysAgo(1)) }],
    });

    expect(buildHabitActivity(habit).days).toBe(
      ACTIVITY_COMPLETED + ACTIVITY_NONE + ACTIVITY_COMPLETED + ACTIVITY_NONE
    );
  });

  it('collapses to a single day when createdAt is in the future', () => {
    const habit = baseHabit({ createdAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) });
    const activity = buildHabitActivity(habit);

    expect(activity.start).toBe(activity.end);
    expect(activity.days).toHaveLength(1);
  });

  it('stays aligned across a DST boundary (day count matches the window)', () => {
    // 2025-03-30 is the EU DST switch; iterate a window that straddles it.
    const now = new Date(2025, 3, 5, 12, 0, 0);
    const created = new Date(2025, 2, 20, 12, 0, 0);
    const activity = buildHabitActivity(baseHabit({ createdAt: created }), HEATMAP_WINDOW_DAYS, now);

    expect(activity.days).toHaveLength(17); // Mar 20 → Apr 5 inclusive
    expect(activity.start).toBe(dayStr(created));
    expect(activity.end).toBe(dayStr(now));
  });
});
