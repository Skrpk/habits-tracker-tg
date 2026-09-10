import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CheckHabitReminderDueUseCase } from '../../../src/domain/use-cases/CheckHabitReminderDueUseCase';
import type { Habit, ReminderSchedule } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createMinimalHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    userId: 1,
    name: 'Test',
    streak: 0,
    createdAt: new Date('2025-01-01'),
    lastCheckedDate: '',
    skipped: [],
    dropped: [],
    ...overrides,
  };
}

describe('CheckHabitReminderDueUseCase', () => {
  let useCase: CheckHabitReminderDueUseCase;

  beforeEach(() => {
    useCase = new CheckHabitReminderDueUseCase();
  });

  describe('isDue', () => {
    it('returns false when reminderEnabled is false', () => {
      const habit = createMinimalHabit({
        reminderEnabled: false,
        reminderSchedule: { type: 'daily', hour: 22, minute: 0 },
      });
      const date = new Date('2025-02-15T22:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(false);
    });

    it('returns true for daily schedule when hour and minute match', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'daily', hour: 22, minute: 0 },
      });
      const date = new Date('2025-02-15T22:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(true);
    });

    it('returns false for daily schedule when time does not match', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'daily', hour: 22, minute: 0 },
      });
      expect(useCase.isDue(habit, new Date('2025-02-15T21:00:00Z'), 'UTC')).toBe(false);
      expect(useCase.isDue(habit, new Date('2025-02-15T22:30:00Z'), 'UTC')).toBe(false);
    });

    it('defaults to daily 22:00 when no schedule', () => {
      const habit = createMinimalHabit({ reminderSchedule: undefined });
      const date = new Date('2025-02-15T22:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(true);
    });

    it('returns true for weekly when day of week is in daysOfWeek and time matches', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'weekly', daysOfWeek: [1, 3, 5], hour: 9, minute: 0 },
      });
      const wednesday = new Date('2025-02-19T09:00:00Z'); // 3 = Wednesday
      expect(useCase.isDue(habit, wednesday, 'UTC')).toBe(true);
    });

    it('returns false for weekly when day of week is not in daysOfWeek', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'weekly', daysOfWeek: [1, 3, 5], hour: 9, minute: 0 },
      });
      const sunday = new Date('2025-02-16T09:00:00Z'); // 0 = Sunday
      expect(useCase.isDue(habit, sunday, 'UTC')).toBe(false);
    });

    it('returns true for monthly when day of month is in daysOfMonth and time matches', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'monthly', daysOfMonth: [1, 15, 30], hour: 10, minute: 0 },
      });
      const date = new Date('2025-02-15T10:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(true);
    });

    it('returns false for monthly when day of month is not in daysOfMonth', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'monthly', daysOfMonth: [1, 15], hour: 10, minute: 0 },
      });
      const date = new Date('2025-02-20T10:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(false);
    });

    it('returns true for interval when days since start is multiple of intervalDays', () => {
      const habit = createMinimalHabit({
        createdAt: new Date('2025-02-10'),
        reminderSchedule: {
          type: 'interval',
          intervalDays: 2,
          hour: 8,
          minute: 0,
          startDate: '2025-02-10',
        },
      });
      const date = new Date('2025-02-14T08:00:00Z'); // 4 days later, 4 % 2 === 0
      expect(useCase.isDue(habit, date, 'UTC')).toBe(true);
    });

    it('returns false for interval when days since start is not multiple of intervalDays', () => {
      const habit = createMinimalHabit({
        reminderSchedule: {
          type: 'interval',
          intervalDays: 2,
          hour: 8,
          minute: 0,
          startDate: '2025-02-10',
        },
      });
      const date = new Date('2025-02-13T08:00:00Z'); // 3 days later, 3 % 2 !== 0
      expect(useCase.isDue(habit, date, 'UTC')).toBe(false);
    });

    // Regression: a habit whose reminderSchedule.timezone differs from the
    // user's preference timezone (user changed timezone in Settings after
    // creating the habit) used to fire `userOffset` hours early, because the
    // caller pre-converted the date into the user's zone and isDue converted
    // that shifted date again. Real report: 21:00 Europe/Kyiv schedule on a
    // Europe/Rome user fired at 18:00 Rome instead of 20:00 Rome.
    describe('schedule timezone differing from the user timezone', () => {
      const habit = createMinimalHabit({
        reminderSchedule: { type: 'daily', hour: 21, minute: 0, timezone: 'Europe/Kyiv' },
      });

      it('fires at 21:00 in the schedule timezone, not offset by the user timezone', () => {
        // 2026-09-10: Kyiv is UTC+3, Rome is UTC+2.
        // 21:00 Kyiv === 18:00 UTC.
        expect(useCase.isDue(habit, new Date('2026-09-10T18:00:00Z'), 'Europe/Rome')).toBe(true);
      });

      it('does not fire early at the double-converted hour', () => {
        // The bug matched at 16:00 UTC (18:00 Rome): 16 + 2 (Rome) + 3 (Kyiv) = 21.
        expect(useCase.isDue(habit, new Date('2026-09-10T16:00:00Z'), 'Europe/Rome')).toBe(false);
      });

      it('is unaffected by which timezone the caller passes as the fallback', () => {
        const instant = new Date('2026-09-10T18:00:00Z');
        expect(useCase.isDue(habit, instant, 'Europe/Rome')).toBe(true);
        expect(useCase.isDue(habit, instant, 'Europe/Kyiv')).toBe(true);
        expect(useCase.isDue(habit, instant, 'UTC')).toBe(true);
      });

      it('falls back to the user timezone when the schedule carries none', () => {
        const noTz = createMinimalHabit({
          reminderSchedule: { type: 'daily', hour: 21, minute: 0 },
        });
        // 21:00 Rome === 19:00 UTC in September.
        expect(useCase.isDue(noTz, new Date('2026-09-10T19:00:00Z'), 'Europe/Rome')).toBe(true);
        expect(useCase.isDue(noTz, new Date('2026-09-10T21:00:00Z'), 'Europe/Rome')).toBe(false);
      });

      it('resolves weekly day-of-week in the schedule timezone', () => {
        // 2026-09-10T22:30:00Z is Thursday in UTC but already Friday (01:30) in Kyiv.
        const weekly = createMinimalHabit({
          reminderSchedule: { type: 'weekly', daysOfWeek: [5], hour: 1, minute: 30, timezone: 'Europe/Kyiv' },
        });
        expect(useCase.isDue(weekly, new Date('2026-09-10T22:30:00Z'), 'Europe/Rome')).toBe(true);
      });
    });

    it('returns true for interval on start date (day 0)', () => {
      const habit = createMinimalHabit({
        reminderSchedule: {
          type: 'interval',
          intervalDays: 3,
          hour: 12,
          minute: 0,
          startDate: '2025-02-10',
        },
      });
      const date = new Date('2025-02-10T12:00:00Z');
      expect(useCase.isDue(habit, date, 'UTC')).toBe(true);
    });
  });

  describe('getScheduleDescription', () => {
    it('formats daily schedule', () => {
      const schedule: ReminderSchedule = { type: 'daily', hour: 22, minute: 0 };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every day at 22:00 UTC');
    });

    it('formats daily with timezone', () => {
      const schedule: ReminderSchedule = { type: 'daily', hour: 9, minute: 30, timezone: 'Europe/London' };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every day at 09:30 Europe/London');
    });

    it('formats weekly schedule with day names', () => {
      const schedule: ReminderSchedule = {
        type: 'weekly',
        daysOfWeek: [1, 3, 5],
        hour: 18,
        minute: 0,
      };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every Monday, Wednesday, Friday at 18:00 UTC');
    });

    it('formats monthly schedule with ordinals', () => {
      const schedule: ReminderSchedule = {
        type: 'monthly',
        daysOfMonth: [1, 15, 22],
        hour: 10,
        minute: 0,
      };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every 1st, 15th, 22nd of the month at 10:00 UTC');
    });

    it('formats interval schedule (singular day)', () => {
      const schedule: ReminderSchedule = { type: 'interval', intervalDays: 1, hour: 8, minute: 0 };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every 1 day at 08:00 UTC');
    });

    it('formats interval schedule (plural days)', () => {
      const schedule: ReminderSchedule = { type: 'interval', intervalDays: 3, hour: 8, minute: 0 };
      expect(useCase.getScheduleDescription(schedule)).toBe('Every 3 days at 08:00 UTC');
    });
  });
});
