import { describe, it, expect } from 'vitest';
import { computeCheckHistory } from '../../../src/domain/utils/HabitAnalytics';
import { Habit } from '../../../src/domain/entities/Habit';

/**
 * Mirror the exact date→string transform used inside computeCheckHistory
 * (local midnight → toISOString), so expectations are timezone-agnostic.
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

function baseHabit(overrides: Partial<Habit>): Habit {
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
    ...overrides,
  };
}

describe('computeCheckHistory — daily inference bounded by lastCheckedDate (fix #2)', () => {
  it('marks every day completed when the user has checked through today', () => {
    const habit = baseHabit({
      createdAt: daysAgo(3),
      streak: 4,
      lastCheckedDate: dayStr(daysAgo(0)),
    });
    const history = computeCheckHistory(habit);
    // creation day .. today inclusive = 4 days, all completed
    expect(history.map(h => h.type)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(history.at(-1)).toMatchObject({ date: dayStr(daysAgo(0)), streak: 4 });
  });

  it('does NOT infer a silently-missed yesterday as completed (scenario A)', () => {
    // Last real interaction was 2 days ago; yesterday + today were never answered.
    const habit = baseHabit({
      createdAt: daysAgo(4),
      streak: 3,
      lastCheckedDate: dayStr(daysAgo(2)),
    });
    const history = computeCheckHistory(habit);
    const byDate = new Map(history.map(h => [h.date, h]));

    // Days up to and including the last interaction are completed.
    expect(byDate.get(dayStr(daysAgo(2)))?.type).toBe('completed');
    // Yesterday and today are gaps — not present, not completed.
    expect(byDate.has(dayStr(daysAgo(1)))).toBe(false);
    expect(byDate.has(dayStr(daysAgo(0)))).toBe(false);
    // No day is wrongly completed after the last interaction.
    expect(history.every(h => h.date <= dayStr(daysAgo(2)))).toBe(true);
  });

  it('does NOT infer the paused/ignored trailing run as completed (scenario B)', () => {
    // Abandoned 5 days ago; nothing answered since — mimics the auto-pause window.
    const habit = baseHabit({
      createdAt: daysAgo(8),
      streak: 4,
      lastCheckedDate: dayStr(daysAgo(5)),
      remindersPausedUntil: dayStr(daysAgo(2)), // pause state present, but irrelevant to inference
    });
    const history = computeCheckHistory(habit);
    // Nothing after the last interaction is inferred.
    expect(history.every(h => h.date <= dayStr(daysAgo(5)))).toBe(true);
    // The last completed entry keeps the real streak.
    expect(history.at(-1)).toMatchObject({ date: dayStr(daysAgo(5)), streak: 4 });
  });

  it('still renders an explicit skip as skipped and preserves the streak', () => {
    const skipDate = dayStr(daysAgo(1));
    const habit = baseHabit({
      createdAt: daysAgo(3),
      streak: 3,
      lastCheckedDate: dayStr(daysAgo(0)),
      skipped: [{ skippedDay: 2, date: skipDate }],
    });
    const history = computeCheckHistory(habit);
    const skipEntry = history.find(h => h.date === skipDate);
    expect(skipEntry?.type).toBe('skipped');
    // Today (after the skip) is completed and the streak resumed climbing.
    expect(history.at(-1)).toMatchObject({ date: dayStr(daysAgo(0)), type: 'completed' });
  });

  it('renders today as completed once it has been checked', () => {
    const habit = baseHabit({
      createdAt: daysAgo(1),
      streak: 2,
      lastCheckedDate: dayStr(daysAgo(0)),
    });
    const history = computeCheckHistory(habit);
    expect(history.at(-1)).toMatchObject({ date: dayStr(daysAgo(0)), type: 'completed' });
  });
});
