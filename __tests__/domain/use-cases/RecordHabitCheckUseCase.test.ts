import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RecordHabitCheckUseCase } from '../../../src/domain/use-cases/RecordHabitCheckUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit, ReminderSchedule } from '../../../src/domain/entities/Habit';

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
    ...overrides,
  };
}

describe('RecordHabitCheckUseCase', () => {
  let mockRepo: {
    getUserHabits: ReturnType<typeof vi.fn>;
    updateHabit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      getUserHabits: vi.fn(),
      updateHabit: vi.fn().mockResolvedValue(undefined),
    };
  });

  it('throws when user habits not found', async () => {
    mockRepo.getUserHabits.mockResolvedValue(null);
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await expect(
      useCase.execute(100, 'habit-1', true, 'user')
    ).rejects.toThrow('User habits not found');

    expect(mockRepo.updateHabit).not.toHaveBeenCalled();
  });

  it('throws when habit not found', async () => {
    mockRepo.getUserHabits.mockResolvedValue({ habits: [] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await expect(
      useCase.execute(100, 'habit-1', true, 'user')
    ).rejects.toThrow('Habit not found');

    expect(mockRepo.updateHabit).not.toHaveBeenCalled();
  });

  it('returns habit unchanged when already checked for checkDate', async () => {
    const habit = createHabit({ lastCheckedDate: '2025-02-15' });
    mockRepo.getUserHabits.mockResolvedValue({ habits: [habit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(result).toEqual(habit);
    expect(mockRepo.updateHabit).not.toHaveBeenCalled();
  });

  it('completes: first check ever sets streak to 1 and lastCheckedDate to checkDate', async () => {
    const habit = createHabit({ streak: 0, lastCheckedDate: '' });
    const updatedHabit = {
      ...habit,
      streak: 1,
      lastCheckedDate: '2025-02-15',
      badges: [],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-02-15',
    }));
    expect(result.streak).toBe(1);
    expect(result.lastCheckedDate).toBe('2025-02-15');
  });

  it('completes: consecutive day increments streak', async () => {
    const habit = createHabit({ streak: 3, lastCheckedDate: '2025-02-14' });
    const updatedHabit = { ...habit, streak: 4, lastCheckedDate: '2025-02-15' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 4,
      lastCheckedDate: '2025-02-15',
    }));
  });

  it('completes: gap in checking resets streak to 1', async () => {
    const habit = createHabit({ streak: 5, lastCheckedDate: '2025-02-10' });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-15' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-02-15',
    }));
  });

  it('drop: sets streak to 0 and appends dropped day with streakBeforeDrop and date', async () => {
    const habit = createHabit({ streak: 2, lastCheckedDate: '2025-02-14', dropped: [] });
    const updatedHabit = {
      ...habit,
      streak: 0,
      lastCheckedDate: '2025-02-15',
      dropped: [{ streakBeforeDrop: 2, date: '2025-02-15' }],
      skipped: [],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', false, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 0,
      lastCheckedDate: '2025-02-15',
      dropped: [{ streakBeforeDrop: 2, date: '2025-02-15' }],
      skipped: [],
    }));
  });

  it('skip: appends skipped day and preserves streak', async () => {
    const habit = createHabit({ streak: 4, lastCheckedDate: '2025-02-14', skipped: [] });
    const updatedHabit = {
      ...habit,
      lastCheckedDate: '2025-02-15',
      skipped: [{ skippedDay: 4, date: '2025-02-15' }],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.skipHabit(100, 'habit-1', 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', {
      skipped: [{ skippedDay: 4, date: '2025-02-15' }],
      lastCheckedDate: '2025-02-15',
    });
    expect(result.streak).toBe(4);
  });

  it('skip: returns habit unchanged when already checked for checkDate', async () => {
    const habit = createHabit({ lastCheckedDate: '2025-02-15' });
    mockRepo.getUserHabits.mockResolvedValue({ habits: [habit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.skipHabit(100, 'habit-1', 'user', '2025-02-15');

    expect(result).toEqual(habit);
    expect(mockRepo.updateHabit).not.toHaveBeenCalled();
  });

  // --- Weekly schedule: Tue (2) + Fri (5) ---

  it('weekly: increments streak on consecutive scheduled days (Tue → Fri)', async () => {
    const schedule: ReminderSchedule = { type: 'weekly', daysOfWeek: [2, 5], hour: 20, minute: 0 };
    // 2025-02-11 is Tuesday, 2025-02-14 is Friday
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-02-11', reminderSchedule: schedule, checked: [{ date: '2025-02-11' }] });
    const updatedHabit = { ...habit, streak: 2, lastCheckedDate: '2025-02-14' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-14');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 2,
      lastCheckedDate: '2025-02-14',
    }));
  });

  it('weekly: increments streak wrapping across weeks (Fri → next Tue)', async () => {
    const schedule: ReminderSchedule = { type: 'weekly', daysOfWeek: [2, 5], hour: 20, minute: 0 };
    // 2025-02-14 is Friday, 2025-02-18 is next Tuesday
    const habit = createHabit({ streak: 2, lastCheckedDate: '2025-02-14', reminderSchedule: schedule, checked: [{ date: '2025-02-11' }, { date: '2025-02-14' }] });
    const updatedHabit = { ...habit, streak: 3, lastCheckedDate: '2025-02-18' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-18');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 3,
      lastCheckedDate: '2025-02-18',
    }));
  });

  it('weekly: resets streak when a scheduled day is missed', async () => {
    const schedule: ReminderSchedule = { type: 'weekly', daysOfWeek: [2, 5], hour: 20, minute: 0 };
    // Checked Tue 2025-02-11, missed Fri 2025-02-14, checking next Tue 2025-02-18
    // Previous scheduled for 2025-02-18 is Fri 2025-02-14, but lastCheckedDate is 2025-02-11 → reset
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-02-11', reminderSchedule: schedule });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-18' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-18');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-02-18',
    }));
  });

  // --- Monthly schedule: 1st + 15th ---

  it('monthly: increments streak on consecutive scheduled days (1st → 15th)', async () => {
    const schedule: ReminderSchedule = { type: 'monthly', daysOfMonth: [1, 15], hour: 22, minute: 0 };
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-03-01', reminderSchedule: schedule, checked: [{ date: '2025-03-01' }] });
    const updatedHabit = { ...habit, streak: 2, lastCheckedDate: '2025-03-15' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-03-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 2,
      lastCheckedDate: '2025-03-15',
    }));
  });

  it('monthly: increments streak wrapping across months (15th → next 1st)', async () => {
    const schedule: ReminderSchedule = { type: 'monthly', daysOfMonth: [1, 15], hour: 22, minute: 0 };
    // Previous scheduled for April 1 is March 15
    const habit = createHabit({ streak: 2, lastCheckedDate: '2025-03-15', reminderSchedule: schedule });
    const updatedHabit = { ...habit, streak: 3, lastCheckedDate: '2025-04-01' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-04-01');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 3,
      lastCheckedDate: '2025-04-01',
    }));
  });

  it('monthly: resets streak when a scheduled day is missed', async () => {
    const schedule: ReminderSchedule = { type: 'monthly', daysOfMonth: [1, 15], hour: 22, minute: 0 };
    // Checked Feb 1, missed Feb 15, checking March 1
    // Previous scheduled for March 1 is Feb 15, but lastCheckedDate is Feb 1 → reset
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-02-01', reminderSchedule: schedule });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-03-01' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-03-01');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-03-01',
    }));
  });

  // --- Interval schedule: every 3 days ---

  it('interval: increments streak on consecutive scheduled days (every 3 days)', async () => {
    const schedule: ReminderSchedule = { type: 'interval', intervalDays: 3, hour: 15, minute: 30 };
    // Checked Feb 10, next due Feb 13 (3 days later)
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-02-10', reminderSchedule: schedule, checked: [{ date: '2025-02-10' }] });
    const updatedHabit = { ...habit, streak: 2, lastCheckedDate: '2025-02-13' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-13');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 2,
      lastCheckedDate: '2025-02-13',
    }));
  });

  it('interval: resets streak when a scheduled day is missed', async () => {
    const schedule: ReminderSchedule = { type: 'interval', intervalDays: 3, hour: 15, minute: 30 };
    // Checked Feb 10, missed Feb 13, checking Feb 16
    // Previous scheduled for Feb 16 is Feb 13, but lastCheckedDate is Feb 10 → reset
    const habit = createHabit({ streak: 1, lastCheckedDate: '2025-02-10', reminderSchedule: schedule });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-16' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-16');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-02-16',
    }));
  });

  // --- Daily regression (no schedule) ---

  it('daily: consecutive day still increments streak (no reminderSchedule)', async () => {
    const habit = createHabit({ streak: 3, lastCheckedDate: '2025-02-14' });
    const updatedHabit = { ...habit, streak: 4, lastCheckedDate: '2025-02-15' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 4,
      lastCheckedDate: '2025-02-15',
    }));
  });

  it('daily: gap still resets streak (explicit daily schedule)', async () => {
    const schedule: ReminderSchedule = { type: 'daily', hour: 20, minute: 0 };
    const habit = createHabit({ streak: 5, lastCheckedDate: '2025-02-10', reminderSchedule: schedule });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-15' };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      streak: 1,
      lastCheckedDate: '2025-02-15',
    }));
  });

  it('complete: awards badge when streak reaches milestone', async () => {
    const habit = createHabit({ streak: 4, lastCheckedDate: '2025-02-14', badges: [] });
    const updatedHabit = {
      ...habit,
      streak: 5,
      lastCheckedDate: '2025-02-15',
      badges: [{ type: 5, earnedAt: expect.any(String) }],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    const call = mockRepo.updateHabit.mock.calls[0][2];
    expect(call.streak).toBe(5);
    expect(call.badges).toHaveLength(1);
    expect(call.badges![0].type).toBe(5);
    expect(call.badges![0].earnedAt).toBeDefined();
  });
});
