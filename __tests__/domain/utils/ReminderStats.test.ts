import { describe, it, expect } from 'vitest';
import { summarizeReminderDay, trailingDates, isReminderClickCallback } from '../../../src/domain/utils/ReminderStats';
import type { ReminderLogEntry } from '../../../src/domain/entities/ReminderLog';

function entry(overrides: Partial<ReminderLogEntry> = {}): ReminderLogEntry {
  return {
    kind: 'reminder',
    userId: 1,
    habitId: 'h1',
    habitName: 'Run',
    targetDate: '2026-09-30',
    sentAt: '2026-09-30T20:00:00.000Z',
    sends: 1,
    ...overrides,
  };
}

describe('summarizeReminderDay', () => {
  it('counts answers by kind, unanswered reminders, pause notices and distinct users', () => {
    const s = summarizeReminderDay('2026-09-30', [
      entry({ userId: 1, habitId: 'a', response: 'complete' }),
      entry({ userId: 1, habitId: 'b', response: 'drop' }),
      entry({ userId: 2, habitId: 'c', response: 'skip', sends: 2 }),
      entry({ userId: 2, habitId: 'd' }),
      entry({ userId: 3, habitId: 'e', kind: 'pause' }),
    ]);
    expect(s).toEqual({
      date: '2026-09-30',
      sent: 4,
      sends: 5,
      complete: 1,
      drop: 1,
      skip: 1,
      noAnswer: 1,
      paused: 1,
      users: 3,
      active: 0,
    });
  });

  it('is all zeros for an empty day', () => {
    expect(summarizeReminderDay('2026-09-30', [])).toMatchObject({ sent: 0, noAnswer: 0, paused: 0, users: 0 });
  });
});

describe('trailingDates', () => {
  it('lists dates newest first, crossing month boundaries', () => {
    expect(trailingDates('2026-10-02', 4)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30', '2026-09-29']);
  });
});

describe('isReminderClickCallback', () => {
  it('counts every button on a reminder message (they carry the reminder date)', () => {
    for (const data of [
      'habit_check:1700000000000-abc123:yes:2026-10-19',
      'habit_check:1700000000000-abc123:no:2026-10-19',
      'habit_check:1700000000000-abc123:skip:2026-10-19',
      'habit_check:1700000000000-abc123:cancel:2026-10-19',
      'habit_skip_confirm:1700000000000-abc123:2026-10-19',
      'habit_postpone:1700000000000-abc123:2026-10-19',
      'resume_reminders:1700000000000-abc123',
    ]) {
      expect(isReminderClickCallback(data)).toBe(true);
    }
  });

  it('ignores the same buttons from /myhabits (no date) and unrelated callbacks', () => {
    for (const data of [
      'habit_check:1700000000000-abc123:yes',
      'habit_check:1700000000000-abc123:skip',
      'habit_skip_confirm:1700000000000-abc123',
      'habit_view:1700000000000-abc123',
      'settings_language',
      'language_select:en',
    ]) {
      expect(isReminderClickCallback(data)).toBe(false);
    }
  });
});
