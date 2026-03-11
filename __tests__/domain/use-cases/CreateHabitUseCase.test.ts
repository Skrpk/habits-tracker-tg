import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateHabitUseCase } from '../../../src/domain/use-cases/CreateHabitUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('CreateHabitUseCase', () => {
  let mockRepo: {
    getUserPreferences: ReturnType<typeof vi.fn>;
    createHabit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      getUserPreferences: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
      createHabit: vi.fn().mockResolvedValue({
        id: 'new-habit-id',
        userId: 1,
        name: 'Meditate',
        streak: 0,
        createdAt: new Date(),
        lastCheckedDate: '',
        skipped: [],
        dropped: [],
      } as Habit),
    };
  });

  it('throws when habit name is empty', async () => {
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    await expect(useCase.execute(1, '', 'user')).rejects.toThrow('Habit name cannot be empty');
    await expect(useCase.execute(1, '   ', 'user')).rejects.toThrow('Habit name cannot be empty');

    expect(mockRepo.createHabit).not.toHaveBeenCalled();
  });

  it('trims habit name and calls createHabit with timezone from preferences', async () => {
    mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'Europe/Berlin' });
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    const result = await useCase.execute(1, '  Run  ', 'user');

    expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'Run', 'Europe/Berlin');
    expect(result.name).toBe('Meditate');
    expect(result.id).toBe('new-habit-id');
  });

  it('uses provided timezone when passed', async () => {
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(1, 'Read', 'user', 'America/New_York');

    expect(mockRepo.getUserPreferences).not.toHaveBeenCalled();
    expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'Read', 'America/New_York');
  });

  it('uses UTC when preferences have no timezone', async () => {
    mockRepo.getUserPreferences.mockResolvedValue({});
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(1, 'Read', 'user');

    expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'Read', 'UTC');
  });
});
