import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CreateHabitUseCase } from '../../../src/domain/use-cases/CreateHabitUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function makeHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h-1',
    userId: 1,
    name: 'Run',
    streak: 0,
    createdAt: new Date(),
    lastCheckedDate: '',
    checked: [],
    skipped: [],
    dropped: [],
    ...overrides,
  };
}

describe('CreateHabitUseCase', () => {
  let mockRepo: {
    getUserPreferences: ReturnType<typeof vi.fn>;
    getUserHabits: ReturnType<typeof vi.fn>;
    createHabit: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      getUserPreferences: vi.fn().mockResolvedValue({ timezone: 'UTC' }),
      getUserHabits: vi.fn().mockResolvedValue(null),
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
    vi.stubEnv('MAX_FREE_HABITS', '3');
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

  it('uses provided timezone over preferences', async () => {
    mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'Europe/London' });
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(1, 'Read', 'user', 'America/New_York');

    expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'Read', 'America/New_York');
  });

  it('uses UTC when preferences have no timezone', async () => {
    mockRepo.getUserPreferences.mockResolvedValue({});
    const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

    await useCase.execute(1, 'Read', 'user');

    expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'Read', 'UTC');
  });

  describe('habit limit enforcement', () => {
    // DISABLED: premium gating is off — the app is free for everyone, so there is no
    // habit cap to enforce right now. Re-enable when premium/free-tier limits return.
    it.skip('throws when free user already has MAX_FREE_HABITS habits', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'UTC' });
      mockRepo.getUserHabits.mockResolvedValue({
        userId: 1,
        habits: [makeHabit({ id: 'h1' }), makeHabit({ id: 'h2' }), makeHabit({ id: 'h3' })],
      });
      const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

      await expect(useCase.execute(1, 'New habit', 'user')).rejects.toThrow(
        'Free users can create up to 3 habits'
      );
      expect(mockRepo.createHabit).not.toHaveBeenCalled();
    });

    it('allows premium user to exceed the limit', async () => {
      const recent = new Date();
      recent.setDate(recent.getDate() - 5);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 1,
        timezone: 'UTC',
        premium: true,
        premiumDate: recent.toISOString(),
      });
      mockRepo.getUserHabits.mockResolvedValue({
        userId: 1,
        habits: [makeHabit({ id: 'h1' }), makeHabit({ id: 'h2' }), makeHabit({ id: 'h3' })],
      });
      const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

      await useCase.execute(1, 'New habit', 'user');

      expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'New habit', 'UTC');
    });

    it('allows lifetime premium user to exceed the limit without premium flag', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ userId: 1, timezone: 'UTC', isLifetimePremium: true });
      mockRepo.getUserHabits.mockResolvedValue({
        userId: 1,
        habits: [makeHabit({ id: 'h1' }), makeHabit({ id: 'h2' }), makeHabit({ id: 'h3' })],
      });
      const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

      await useCase.execute(1, 'New habit', 'user');

      expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'New habit', 'UTC');
    });

    it('allows free user under the limit', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'UTC' });
      mockRepo.getUserHabits.mockResolvedValue({
        userId: 1,
        habits: [makeHabit({ id: 'h1' }), makeHabit({ id: 'h2' })],
      });
      const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

      await useCase.execute(1, 'New habit', 'user');

      expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'New habit', 'UTC');
    });

    it('allows free user when they have no habits yet', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'UTC' });
      mockRepo.getUserHabits.mockResolvedValue(null);
      const useCase = new CreateHabitUseCase(mockRepo as unknown as IHabitRepository);

      await useCase.execute(1, 'First habit', 'user');

      expect(mockRepo.createHabit).toHaveBeenCalledWith(1, 'First habit', 'UTC');
    });
  });
});
