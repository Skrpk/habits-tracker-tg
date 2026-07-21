import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PostponeHabitReminderUseCase } from '../../../src/domain/use-cases/PostponeHabitReminderUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'habit-1', userId: 100, name: 'Run', streak: 0,
    createdAt: new Date('2025-01-01'), lastCheckedDate: '',
    skipped: [], dropped: [], checked: [], ...overrides,
  };
}

describe('PostponeHabitReminderUseCase', () => {
  let mockRepo: {
    getUserHabits: ReturnType<typeof vi.fn>;
    updateHabit: ReturnType<typeof vi.fn>;
  };
  let useCase: PostponeHabitReminderUseCase;

  beforeEach(() => {
    mockRepo = {
      getUserHabits: vi.fn(),
      updateHabit: vi.fn().mockResolvedValue(undefined),
    };
    useCase = new PostponeHabitReminderUseCase(mockRepo as unknown as IHabitRepository);
  });

  it('getHabit returns the matching habit or null', async () => {
    mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits: [createHabit()] });
    expect(await useCase.getHabit(100, 'habit-1')).toMatchObject({ id: 'habit-1' });
    expect(await useCase.getHabit(100, 'missing')).toBeNull();

    mockRepo.getUserHabits.mockResolvedValue(null);
    expect(await useCase.getHabit(100, 'habit-1')).toBeNull();
  });

  it('setPostpone stores the ISO instant on the habit', async () => {
    const target = new Date('2026-07-15T16:00:00Z');
    await useCase.setPostpone(100, 'habit-1', target);
    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', {
      postponedUntil: '2026-07-15T16:00:00.000Z',
    });
  });

  it('clearPostpone unsets the flag', async () => {
    await useCase.clearPostpone(100, 'habit-1');
    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'habit-1', {
      postponedUntil: undefined,
    });
  });
});
