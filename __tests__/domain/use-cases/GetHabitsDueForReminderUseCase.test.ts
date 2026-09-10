import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetHabitsDueForReminderUseCase } from '../../../src/domain/use-cases/GetHabitsDueForReminderUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

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
    // Daily at 09:00 UTC — deliberately NOT the time we run "now", so any
    // inclusion below is due to the postpone path, not the schedule.
    reminderSchedule: { type: 'daily', hour: 9, minute: 0, timezone: 'UTC' },
    reminderEnabled: true,
    ...overrides,
  };
}

describe('GetHabitsDueForReminderUseCase — postpone path', () => {
  // 2026-07-15 13:00 UTC. Schedule (09:00) is not due now, isolating postpone.
  const now = new Date('2026-07-15T13:00:00Z');
  let mockRepo: {
    getAllActiveUserIds: ReturnType<typeof vi.fn>;
    getUserHabits: ReturnType<typeof vi.fn>;
    getUserPreferences: ReturnType<typeof vi.fn>;
  };

  function run(habit: Habit) {
    mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits: [habit] });
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    return useCase.execute(now, 13, 0, 'UTC');
  }

  beforeEach(() => {
    mockRepo = {
      getAllActiveUserIds: vi.fn().mockResolvedValue([100]),
      getUserHabits: vi.fn(),
      getUserPreferences: vi.fn().mockResolvedValue({ userId: 100, timezone: 'UTC' }),
    };
  });

  it('includes a habit whose postpone is due (past instant, same day)', async () => {
    const due = await run(createHabit({ postponedUntil: '2026-07-15T12:30:00Z' }));
    expect(due.map(h => h.id)).toEqual(['habit-1']);
  });

  it('excludes a habit whose postpone is still in the future', async () => {
    const due = await run(createHabit({ postponedUntil: '2026-07-15T14:00:00Z' }));
    expect(due).toHaveLength(0);
  });

  it('excludes a habit already checked today even with a due postpone', async () => {
    const due = await run(createHabit({
      postponedUntil: '2026-07-15T12:30:00Z',
      lastCheckedDate: '2026-07-15',
    }));
    expect(due).toHaveLength(0);
  });

  it('excludes a disabled habit with a due postpone', async () => {
    const due = await run(createHabit({ postponedUntil: '2026-07-15T12:30:00Z', disabled: true }));
    expect(due).toHaveLength(0);
  });

  it('excludes when reminders are disabled even with a due postpone', async () => {
    const due = await run(createHabit({ postponedUntil: '2026-07-15T12:30:00Z', reminderEnabled: false }));
    expect(due).toHaveLength(0);
  });

  it('excludes a stale postpone that slipped past midnight', async () => {
    // Now is next day relative to the postpone target's local day
    mockRepo.getUserHabits.mockResolvedValue({
      userId: 100,
      habits: [createHabit({ postponedUntil: '2026-07-14T23:30:00Z' })],
    });
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    const due = await useCase.execute(new Date('2026-07-15T00:30:00Z'), 0, 30, 'UTC');
    expect(due).toHaveLength(0);
  });

  it('still includes a habit due on its normal schedule (no regression)', async () => {
    // Run at 09:00 to match the schedule; no postpone set.
    mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits: [createHabit()] });
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    const due = await useCase.execute(new Date('2026-07-15T09:00:00Z'), 9, 0, 'UTC');
    expect(due.map(h => h.id)).toEqual(['habit-1']);
  });

  it('skips an auto-paused habit and includes it once the pause expires', async () => {
    // Active pause (future) → skipped even though the schedule is due at 09:00
    mockRepo.getUserHabits.mockResolvedValue({
      userId: 100,
      habits: [createHabit({ remindersPausedUntil: '2026-07-20' })],
    });
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    const paused = await useCase.execute(new Date('2026-07-15T09:00:00Z'), 9, 0, 'UTC');
    expect(paused).toHaveLength(0);

    // Expired pause (past) → reappears
    mockRepo.getUserHabits.mockResolvedValue({
      userId: 100,
      habits: [createHabit({ remindersPausedUntil: '2026-07-10' })],
    });
    const resumed = await useCase.execute(new Date('2026-07-15T09:00:00Z'), 9, 0, 'UTC');
    expect(resumed.map(h => h.id)).toEqual(['habit-1']);
  });

  it('pause wins over a due postpone (stays skipped)', async () => {
    mockRepo.getUserHabits.mockResolvedValue({
      userId: 100,
      habits: [createHabit({ remindersPausedUntil: '2026-07-20', postponedUntil: '2026-07-15T12:30:00Z' })],
    });
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    const due = await useCase.execute(now, 13, 0, 'UTC');
    expect(due).toHaveLength(0);
  });
});

/**
 * Regression: the reminder fired `userOffset` hours early whenever a habit's
 * `reminderSchedule.timezone` differed from the user's preference timezone —
 * the state every user lands in after changing their timezone in Settings,
 * since that never rewrote existing schedules.
 *
 * This only reproduces end-to-end: this use case converted `now` into the
 * user's zone, then handed that already-shifted date to `isDue`, which
 * converted it a second time. Unit-testing `isDue` with a true instant misses
 * it entirely, which is why it survived.
 *
 * Real report: 21:00 Europe/Kyiv schedule, Europe/Rome preference, September
 * (Kyiv UTC+3, Rome UTC+2). Correct fire is 18:00 UTC; the bug fired at
 * 16:00 UTC (18:00 Rome) because 16 + 2 + 3 = 21.
 */
describe('GetHabitsDueForReminderUseCase — schedule timezone vs user timezone', () => {
  function runAt(nowIso: string) {
    const habit = createHabit({
      reminderSchedule: { type: 'daily', hour: 21, minute: 0, timezone: 'Europe/Kyiv' },
      postponedUntil: undefined,
    });
    const mockRepo = {
      getAllActiveUserIds: vi.fn().mockResolvedValue([100]),
      getUserHabits: vi.fn().mockResolvedValue({ userId: 100, habits: [habit] }),
      getUserPreferences: vi.fn().mockResolvedValue({ userId: 100, timezone: 'Europe/Rome' }),
    };
    const now = new Date(nowIso);
    const useCase = new GetHabitsDueForReminderUseCase(mockRepo as unknown as IHabitRepository);
    return useCase.execute(now, now.getUTCHours(), now.getUTCMinutes(), 'UTC');
  }

  it('fires at 21:00 in the schedule timezone', async () => {
    expect(await runAt('2026-09-10T18:00:00Z')).toHaveLength(1);
  });

  it('does not fire at the double-converted hour', async () => {
    expect(await runAt('2026-09-10T16:00:00Z')).toHaveLength(0);
  });

  it('does not fire at any other hour of the day', async () => {
    for (let h = 0; h < 24; h++) {
      if (h === 18) continue;
      const iso = `2026-09-10T${String(h).padStart(2, '0')}:00:00Z`;
      expect(await runAt(iso), `unexpected reminder at ${iso}`).toHaveLength(0);
    }
  });
});
