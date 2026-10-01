import { describe, it, expect } from 'vitest';
import { summarizeReminderDay, trailingDates } from '../../../src/domain/utils/ReminderStats';
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
