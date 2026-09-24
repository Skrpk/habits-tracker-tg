import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
      missedReminderCount: 0,
      remindersPausedUntil: undefined,
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

  it('drop: when note is provided, the new dropped entry includes the note', async () => {
    const habit = createHabit({ streak: 2, lastCheckedDate: '2025-02-14', dropped: [] });
    const updatedHabit = {
      ...habit,
      streak: 0,
      lastCheckedDate: '2025-02-15',
      dropped: [{ streakBeforeDrop: 2, date: '2025-02-15', note: 'Was too tired' }],
      skipped: [],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', false, 'user', '2025-02-15', 'Was too tired');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      dropped: [{ streakBeforeDrop: 2, date: '2025-02-15', note: 'Was too tired' }],
    }));
  });

  it('drop: when note is omitted or empty, the new dropped entry has no note', async () => {
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

    const call = mockRepo.updateHabit.mock.calls[0][2];
    expect(call.dropped).toEqual([{ streakBeforeDrop: 2, date: '2025-02-15' }]);
    expect(call.dropped[0]).not.toHaveProperty('note');
  });

  it('skip: when note is provided, the new skipped entry includes the note', async () => {
    const habit = createHabit({ streak: 4, lastCheckedDate: '2025-02-14', skipped: [] });
    const updatedHabit = {
      ...habit,
      lastCheckedDate: '2025-02-15',
      skipped: [{ skippedDay: 4, date: '2025-02-15', note: 'On vacation' }],
    };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.skipHabit(100, 'habit-1', 'user', '2025-02-15', 'On vacation');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', {
      skipped: [{ skippedDay: 4, date: '2025-02-15', note: 'On vacation' }],
      lastCheckedDate: '2025-02-15',
      missedReminderCount: 0,
      remindersPausedUntil: undefined,
    });
  });

  it('skip: when note is omitted or empty, the new skipped entry has no note', async () => {
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

    await useCase.skipHabit(100, 'habit-1', 'user', '2025-02-15');

    const call = mockRepo.updateHabit.mock.calls[0][2];
    expect(call.skipped).toEqual([{ skippedDay: 4, date: '2025-02-15' }]);
    expect(call.skipped[0]).not.toHaveProperty('note');
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

  it('complete: sets imgIndex to 1 when habit has no imgIndex', async () => {
    const habit = createHabit({ streak: 0, lastCheckedDate: '' });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-15', badges: [], imgIndex: 1 };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      imgIndex: 1,
    }));
  });

  it('complete: preserves existing imgIndex', async () => {
    const habit = createHabit({ streak: 0, lastCheckedDate: '', imgIndex: 3 });
    const updatedHabit = { ...habit, streak: 1, lastCheckedDate: '2025-02-15', badges: [], imgIndex: 3 };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', true, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      imgIndex: 3,
    }));
  });

  it('drop: sets imgIndex to 1 when habit has no imgIndex', async () => {
    const habit = createHabit({ streak: 2, lastCheckedDate: '2025-02-14', dropped: [] });
    const updatedHabit = { ...habit, streak: 0, lastCheckedDate: '2025-02-15', dropped: [{ streakBeforeDrop: 2, date: '2025-02-15' }], skipped: [], imgIndex: 1 };
    mockRepo.getUserHabits
      .mockResolvedValueOnce({ habits: [habit] })
      .mockResolvedValueOnce({ habits: [updatedHabit] });
    const useCase = new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(100, 'habit-1', false, 'user', '2025-02-15');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({
      imgIndex: 1,
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

  describe('resets auto-pause state on any response', () => {
    it.each([
      ['complete', () => useCaseFor().execute(100, 'habit-1', true, 'user', '2025-02-15')],
      ['drop', () => useCaseFor().execute(100, 'habit-1', false, 'user', '2025-02-15')],
      ['skip', () => useCaseFor().skipHabit(100, 'habit-1', 'user', '2025-02-15')],
    ])('%s clears missedReminderCount and remindersPausedUntil', async (_label, run) => {
      const habit = createHabit({
        streak: 1,
        lastCheckedDate: '2025-02-13',
        missedReminderCount: 1,
        remindersPausedUntil: '2025-02-20',
      });
      mockRepo.getUserHabits
        .mockResolvedValueOnce({ habits: [habit] })
        .mockResolvedValueOnce({ habits: [{ ...habit, lastCheckedDate: '2025-02-15' }] });

      await run();

      const call = mockRepo.updateHabit.mock.calls[0][2];
      expect(call.missedReminderCount).toBe(0);
      expect(call.remindersPausedUntil).toBeUndefined();
    });

    // helper: build a use case bound to the shared mockRepo for this describe block
    function useCaseFor() {
      return new RecordHabitCheckUseCase(mockRepo as unknown as IHabitRepository);
    }
  });

  describe('checkDate resolution — no targetDate uses the user LOCAL day, not server UTC', () => {
    // 21:00Z on Feb 14 is already 02:00 on Feb 15 in Karachi (UTC+5): the UTC day
    // and the user's local day disagree, which is exactly when the old UTC fallback
    // misattributed the check and broke the consecutive-day streak comparison.
    const INSTANT = new Date('2025-02-14T21:00:00Z');

    function repoWith(prefs: unknown, habit: Habit) {
      return {
        getUserHabits: vi.fn().mockResolvedValue({ habits: [habit] }),
        updateHabit: vi.fn().mockResolvedValue(undefined),
        getUserPreferences: vi.fn().mockResolvedValue(prefs),
      };
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(INSTANT);
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('execute: records the user local day (Asia/Karachi → Feb 15, not UTC Feb 14)', async () => {
      const repo = repoWith({ userId: 100, timezone: 'Asia/Karachi' }, createHabit({ streak: 0, lastCheckedDate: '' }));
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user');
      expect(repo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({ lastCheckedDate: '2025-02-15' }));
    });

    it('execute: falls back to server UTC day when the user has no timezone', async () => {
      const repo = repoWith(null, createHabit({ streak: 0, lastCheckedDate: '' }));
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user');
      expect(repo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({ lastCheckedDate: '2025-02-14' }));
    });

    it('skipHabit: records the user local day too', async () => {
      const repo = repoWith({ timezone: 'Asia/Karachi' }, createHabit({ streak: 3, lastCheckedDate: '2025-02-14' }));
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).skipHabit(100, 'habit-1', 'user');
      expect(repo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({ lastCheckedDate: '2025-02-15' }));
    });

    it('an explicit targetDate is honored verbatim (reminder path, no preferences read)', async () => {
      const repo = repoWith({ timezone: 'Asia/Karachi' }, createHabit({ streak: 0, lastCheckedDate: '' }));
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-10');
      expect(repo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', expect.objectContaining({ lastCheckedDate: '2025-02-10' }));
      expect(repo.getUserPreferences).not.toHaveBeenCalled();
    });
  });

  describe('Variant A — daily silent-miss recording, back-fill & recompute', () => {
    // A daily habit whose run is days 11–13 (created 02-11) so recompute never
    // reaches back past a genuine first check.
    function dailyRepo(habit: Habit) {
      return {
        getUserHabits: vi.fn().mockResolvedValue({ habits: [habit] }),
        updateHabit: vi.fn().mockResolvedValue(undefined),
        getUserPreferences: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
      };
    }
    const call = (repo: { updateHabit: ReturnType<typeof vi.fn> }) => repo.updateHabit.mock.calls[0][2];

    it('forward jump over a missed day records it as a drop and resets streak to 1', async () => {
      const habit = createHabit({ streak: 3, lastCheckedDate: '2025-02-13', createdAt: new Date('2025-02-11') });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-15');
      const c = call(repo);
      expect(c.streak).toBe(1);
      expect(c.lastCheckedDate).toBe('2025-02-15');
      expect(c.dropped).toEqual([{ date: '2025-02-14', streakBeforeDrop: 3 }]);
    });

    it('multi-day gap records every missed day; only the first carries streakBeforeDrop', async () => {
      const habit = createHabit({ streak: 2, lastCheckedDate: '2025-02-12', createdAt: new Date('2025-02-11') });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-15');
      const c = call(repo);
      expect(c.streak).toBe(1);
      // newest-first: 02-14, 02-13 (the break) with streakBeforeDrop 2
      expect(c.dropped).toEqual([
        { date: '2025-02-14', streakBeforeDrop: 0 },
        { date: '2025-02-13', streakBeforeDrop: 2 },
      ]);
    });

    it('back-fill of the missed day un-marks the drop, keeps lastCheckedDate, and recomputes the bridged streak', async () => {
      // Post-forward state: 11-13 done, 14 recorded as a miss, 15 done (streak 1).
      const habit = createHabit({
        streak: 1,
        lastCheckedDate: '2025-02-15',
        createdAt: new Date('2025-02-11'),
        dropped: [{ date: '2025-02-14', streakBeforeDrop: 3 }],
      });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-14');
      const c = call(repo);
      expect(c.dropped).toEqual([]);              // day 14 un-marked → turns green
      expect(c.lastCheckedDate).toBe('2025-02-15'); // monotonic: never moves backward
      expect(c.streak).toBe(5);                    // 11,12,13,14,15 bridged
    });

    it('back-fill never awards a badge even when the recomputed streak reaches a threshold', async () => {
      const habit = createHabit({
        streak: 1,
        lastCheckedDate: '2025-02-15',
        createdAt: new Date('2025-02-11'),
        dropped: [{ date: '2025-02-14', streakBeforeDrop: 3 }],
        badges: [],
      });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-14');
      const c = call(repo);
      expect(c.streak).toBe(5);
      expect(c.badges).toEqual([]); // a forward check to 5 would award the 5-day badge; a back-fill must not
    });

    it('completing a previously-skipped day un-marks the skip', async () => {
      const habit = createHabit({
        streak: 1,
        lastCheckedDate: '2025-02-15',
        createdAt: new Date('2025-02-11'),
        skipped: [{ skippedDay: 3, date: '2025-02-14' }],
      });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-14');
      const c = call(repo);
      expect(c.skipped).toEqual([]);   // 02-14 no longer a skip
      expect(c.streak).toBe(5);        // now a completion, run bridges 11–15
    });

    it('a consecutive forward check still increments and records no drops', async () => {
      const habit = createHabit({ streak: 3, lastCheckedDate: '2025-02-14', createdAt: new Date('2025-02-11') });
      const repo = dailyRepo(habit);
      await new RecordHabitCheckUseCase(repo as unknown as IHabitRepository).execute(100, 'habit-1', true, 'user', '2025-02-15');
      const c = call(repo);
      expect(c.streak).toBe(4);
      expect(c.dropped).toEqual([]);
    });
  });
});
