import { describe, it, expect } from 'vitest';
import {
  EvaluateReminderPauseUseCase,
  isAutoPauseEligible,
  addDays,
} from '../../../src/domain/use-cases/EvaluateReminderPauseUseCase';
import type { Habit, ReminderSchedule } from '../../../src/domain/entities/Habit';

function daily(hour = 9): ReminderSchedule {
  return { type: 'daily', hour, minute: 0, timezone: 'UTC' };
}

function createHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1',
    userId: 100,
    name: 'Run',
    streak: 0,
    createdAt: new Date('2025-01-01'),
    lastCheckedDate: '',
    skipped: [],
    dropped: [],
    checked: [],
    reminderSchedule: daily(),
    reminderEnabled: true,
    ...overrides,
  };
}

// Fixed threshold/pause so tests don't depend on env.
const evaluate = new EvaluateReminderPauseUseCase(2, 7);
const TODAY = '2025-02-15';

function only(result: { toSend: any[]; pausedNow: any[] }) {
  return result;
}

describe('EvaluateReminderPauseUseCase.filterDueHabits', () => {
  it('first-ever occurrence is not a miss (sends, sets baseline)', () => {
    const { toSend, pausedNow } = evaluate.filterDueHabits([createHabit()], TODAY);
    expect(pausedNow).toHaveLength(0);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].update).toEqual({ missedReminderCount: 0, lastReminderDate: TODAY });
  });

  it('counts a miss when the previous reminder went unanswered', () => {
    const habit = createHabit({ lastReminderDate: '2025-02-14', lastCheckedDate: '2025-02-10' });
    const { toSend } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend[0].update).toEqual({ missedReminderCount: 1, lastReminderDate: TODAY });
  });

  it('does not count a miss when the previous reminder was answered', () => {
    const habit = createHabit({ lastReminderDate: '2025-02-14', lastCheckedDate: '2025-02-14' });
    const { toSend } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend[0].update).toEqual({ missedReminderCount: 0, lastReminderDate: TODAY });
  });

  it('does not count a miss for a more-recent proactive check (< guard, not !=)', () => {
    // Reminded on the 14th, but the user checked on the 15th earlier (proactive/backfill)
    const habit = createHabit({
      lastReminderDate: '2025-02-14',
      lastCheckedDate: '2025-02-15',
      missedReminderCount: 0,
    });
    const { toSend } = evaluate.filterDueHabits([habit], '2025-02-16');
    expect(toSend[0].update).toEqual({ missedReminderCount: 0, lastReminderDate: '2025-02-16' });
  });

  it('same-day re-ask (postpone) resends without touching counters', () => {
    const habit = createHabit({ lastReminderDate: TODAY, lastCheckedDate: '2025-02-10', missedReminderCount: 1 });
    const { toSend } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].update).toEqual({});
  });

  it('pauses on the 2nd consecutive miss (targetDate + 7 days)', () => {
    const habit = createHabit({
      lastReminderDate: '2025-02-14',
      lastCheckedDate: '2025-02-10',
      missedReminderCount: 1, // one miss already
    });
    const { toSend, pausedNow } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend).toHaveLength(0);
    expect(pausedNow).toHaveLength(1);
    expect(pausedNow[0].update).toEqual({ remindersPausedUntil: '2025-02-22', missedReminderCount: 0 });
  });

  it('resumes (fresh slate) once the pause has expired', () => {
    const habit = createHabit({
      remindersPausedUntil: '2025-02-15', // expires today (targetDate >= pausedUntil)
      missedReminderCount: 0,
      lastReminderDate: '2025-02-07',
    });
    const { toSend } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend[0].update).toEqual({
      remindersPausedUntil: undefined,
      missedReminderCount: 0,
      lastReminderDate: TODAY,
    });
  });

  it('skips a habit still within an active pause (neither sends nor pauses)', () => {
    const habit = createHabit({ remindersPausedUntil: '2025-02-20' });
    const { toSend, pausedNow } = evaluate.filterDueHabits([habit], TODAY);
    expect(toSend).toHaveLength(0);
    expect(pausedNow).toHaveLength(0);
  });

  it.each<[string, ReminderSchedule]>([
    ['weekly', { type: 'weekly', daysOfWeek: [1], hour: 9, minute: 0, timezone: 'UTC' }],
    ['monthly', { type: 'monthly', daysOfMonth: [15], hour: 9, minute: 0, timezone: 'UTC' }],
    ['interval', { type: 'interval', intervalDays: 3, hour: 9, minute: 0, timezone: 'UTC' }],
  ])('never miss-tracks or pauses a %s habit, even after an ignored reminder', (_label, schedule) => {
    const habit = createHabit({
      reminderSchedule: schedule,
      lastReminderDate: '2025-02-14',
      lastCheckedDate: '2025-01-01',
      missedReminderCount: 1,
    });
    const { toSend, pausedNow } = only(evaluate.filterDueHabits([habit], TODAY));
    expect(pausedNow).toHaveLength(0);
    expect(toSend).toHaveLength(1);
    expect(toSend[0].update).toEqual({}); // untouched
  });
});

describe('helpers', () => {
  it('isAutoPauseEligible is true only for daily (and undefined defaults to daily)', () => {
    expect(isAutoPauseEligible({ type: 'daily', hour: 9, minute: 0 })).toBe(true);
    expect(isAutoPauseEligible(undefined)).toBe(true);
    expect(isAutoPauseEligible({ type: 'weekly', daysOfWeek: [1], hour: 9, minute: 0 })).toBe(false);
    expect(isAutoPauseEligible({ type: 'monthly', daysOfMonth: [1], hour: 9, minute: 0 })).toBe(false);
    expect(isAutoPauseEligible({ type: 'interval', intervalDays: 2, hour: 9, minute: 0 })).toBe(false);
  });

  it('addDays does UTC date math across month boundaries', () => {
    expect(addDays('2025-02-15', 7)).toBe('2025-02-22');
    expect(addDays('2025-02-26', 7)).toBe('2025-03-05');
    expect(addDays('2025-12-30', 3)).toBe('2026-01-02');
  });
});
