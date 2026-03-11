import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GetUserHabitsUseCase } from '../../../src/domain/use-cases/GetUserHabitsUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

describe('GetUserHabitsUseCase', () => {
  let mockRepo: { getUserHabits: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = {
      getUserHabits: vi.fn(),
    };
  });

  it('returns empty array when user has no habits', async () => {
    mockRepo.getUserHabits.mockResolvedValue(null);
    const useCase = new GetUserHabitsUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(100);

    expect(result).toEqual([]);
    expect(mockRepo.getUserHabits).toHaveBeenCalledWith(100);
  });

  it('returns empty array when userHabits has no habits array', async () => {
    mockRepo.getUserHabits.mockResolvedValue({ userId: 100 });
    const useCase = new GetUserHabitsUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(100);

    expect(result).toEqual([]);
  });

  it('returns habits array from repository', async () => {
    const habits: Habit[] = [
      {
        id: 'h1',
        userId: 100,
        name: 'Run',
        streak: 3,
        createdAt: new Date(),
        lastCheckedDate: '2025-02-15',
        skipped: [],
        dropped: [],
      },
    ];
    mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits });
    const useCase = new GetUserHabitsUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(100);

    expect(result).toEqual(habits);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Run');
  });
});
