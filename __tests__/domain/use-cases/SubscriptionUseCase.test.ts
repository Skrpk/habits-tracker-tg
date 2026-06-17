import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionUseCase, userHasPremiumAccess } from '../../../src/domain/use-cases/SubscriptionUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { Habit } from '../../../src/domain/entities/Habit';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

function createHabit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'h-1',
    userId: 100,
    name: 'Run',
    streak: 0,
    createdAt: new Date('2025-01-01'),
    lastCheckedDate: '',
    skipped: [],
    dropped: [],
    checked: [],
    ...overrides,
  };
}

describe('SubscriptionUseCase', () => {
  let mockRepo: {
    getUserPreferences: ReturnType<typeof vi.fn>;
    saveUserPreferences: ReturnType<typeof vi.fn>;
    getUserHabits: ReturnType<typeof vi.fn>;
    saveUserHabits: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepo = {
      getUserPreferences: vi.fn().mockResolvedValue(null),
      saveUserPreferences: vi.fn().mockResolvedValue(undefined),
      getUserHabits: vi.fn().mockResolvedValue(null),
      saveUserHabits: vi.fn().mockResolvedValue(undefined),
    };
    vi.stubEnv('MAX_FREE_HABITS', '3');
  });

  describe('isSubscribed', () => {
    it('returns false when no preferences', async () => {
      mockRepo.getUserPreferences.mockResolvedValue(null);
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(false);
    });

    it('returns false when premium is false', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ userId: 100, premium: false });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(false);
    });

    it('returns true when premium and within 30 days', async () => {
      const recentDate = new Date();
      recentDate.setDate(recentDate.getDate() - 10);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        premium: true,
        premiumDate: recentDate.toISOString(),
      });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(true);
    });

    it('returns false when premium but past monthly period (31 days)', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 32);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        premium: true,
        premiumDate: oldDate.toISOString(),
      });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(false);
    });

    it('returns true when premiumType annual and past 30 days but within 365 days', async () => {
      const date60DaysAgo = new Date();
      date60DaysAgo.setDate(date60DaysAgo.getDate() - 60);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        premium: true,
        premiumDate: date60DaysAgo.toISOString(),
        premiumType: 'annual',
      });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(true);
    });

    it('returns true when isLifetimePremium even without premiumDate', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        isLifetimePremium: true,
        premium: true,
      });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(true);
    });

    it('returns true when isLifetimePremium even when paid subscription date is expired', async () => {
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 100);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        isLifetimePremium: true,
        premium: true,
        premiumDate: oldDate.toISOString(),
      });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      expect(await uc.isSubscribed(100)).toBe(true);
    });
  });

  describe('userHasPremiumAccess', () => {
    it('returns false for null', () => {
      expect(userHasPremiumAccess(null)).toBe(false);
    });

    it('returns true for lifetime', () => {
      expect(userHasPremiumAccess({ userId: 1, isLifetimePremium: true })).toBe(true);
    });
  });

  describe('activateSubscription', () => {
    it('sets premium true and premiumDate to now (default monthly)', async () => {
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);
      const before = Date.now();

      await uc.activateSubscription(100);

      expect(mockRepo.saveUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 100,
          premium: true,
          premiumType: 'monthly',
        })
      );
      const saved = mockRepo.saveUserPreferences.mock.calls[0][0];
      const savedDate = new Date(saved.premiumDate).getTime();
      expect(savedDate).toBeGreaterThanOrEqual(before);
      expect(savedDate).toBeLessThanOrEqual(Date.now());
    });

    it('persists premiumType annual when passed', async () => {
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      await uc.activateSubscription(100, 'annual');

      expect(mockRepo.saveUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 100,
          premium: true,
          premiumType: 'annual',
        })
      );
    });
  });

  describe('revokeSubscription', () => {
    it('sets premium false and disables habits beyond limit', async () => {
      const habits = [
        createHabit({ id: 'h1', name: 'A', createdAt: new Date('2025-01-01') }),
        createHabit({ id: 'h2', name: 'B', createdAt: new Date('2025-01-02') }),
        createHabit({ id: 'h3', name: 'C', createdAt: new Date('2025-01-03') }),
        createHabit({ id: 'h4', name: 'D', createdAt: new Date('2025-01-04') }),
        createHabit({ id: 'h5', name: 'E', createdAt: new Date('2025-01-05') }),
      ];
      mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      const disabled = await uc.revokeSubscription(100);

      expect(mockRepo.saveUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 100, premium: false })
      );
      expect(disabled).toEqual(['D', 'E']);
      const saved = mockRepo.saveUserHabits.mock.calls[0][0];
      expect(saved.habits[0].disabled).toBeFalsy();
      expect(saved.habits[1].disabled).toBeFalsy();
      expect(saved.habits[2].disabled).toBeFalsy();
      expect(saved.habits[3].disabled).toBe(true);
      expect(saved.habits[4].disabled).toBe(true);
    });

    it('keeps first N habits by createdAt order', async () => {
      const habits = [
        createHabit({ id: 'h3', name: 'Newest', createdAt: new Date('2025-03-01') }),
        createHabit({ id: 'h1', name: 'Oldest', createdAt: new Date('2025-01-01') }),
        createHabit({ id: 'h2', name: 'Middle', createdAt: new Date('2025-02-01') }),
        createHabit({ id: 'h4', name: 'Latest', createdAt: new Date('2025-04-01') }),
      ];
      mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      const disabled = await uc.revokeSubscription(100);

      expect(disabled).toEqual(['Latest']);
      const saved = mockRepo.saveUserHabits.mock.calls[0][0];
      const sortedNames = saved.habits.map((h: Habit) => h.name);
      expect(sortedNames).toEqual(['Oldest', 'Middle', 'Newest', 'Latest']);
      expect(saved.habits[3].disabled).toBe(true);
    });

    it('returns empty array when user has no habits', async () => {
      mockRepo.getUserHabits.mockResolvedValue(null);
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      const disabled = await uc.revokeSubscription(100);

      expect(disabled).toEqual([]);
      expect(mockRepo.saveUserHabits).not.toHaveBeenCalled();
    });

    it('does not save when all habits are within free limit', async () => {
      const habits = [
        createHabit({ id: 'h1', name: 'A', createdAt: new Date('2025-01-01') }),
        createHabit({ id: 'h2', name: 'B', createdAt: new Date('2025-01-02') }),
      ];
      mockRepo.getUserHabits.mockResolvedValue({ userId: 100, habits });
      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);

      const disabled = await uc.revokeSubscription(100);

      expect(disabled).toEqual([]);
      expect(mockRepo.saveUserHabits).not.toHaveBeenCalled();
    });
  });

  describe('checkAndRevokeExpired', () => {
    it('revokes only expired premium users', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 32);
      const activeDate = new Date();
      activeDate.setDate(activeDate.getDate() - 5);

      mockRepo.getUserPreferences
        .mockResolvedValueOnce({ userId: 1, premium: true, premiumDate: expiredDate.toISOString() })
        .mockResolvedValueOnce({ userId: 2, premium: true, premiumDate: activeDate.toISOString() })
        .mockResolvedValueOnce({ userId: 3, premium: false });

      mockRepo.getUserHabits.mockResolvedValue({
        userId: 1,
        habits: [
          createHabit({ id: 'h1', name: 'A', createdAt: new Date('2025-01-01') }),
          createHabit({ id: 'h2', name: 'B', createdAt: new Date('2025-01-02') }),
          createHabit({ id: 'h3', name: 'C', createdAt: new Date('2025-01-03') }),
          createHabit({ id: 'h4', name: 'D', createdAt: new Date('2025-01-04') }),
        ],
      });

      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);
      const results = await uc.checkAndRevokeExpired([1, 2, 3]);

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(1);
      expect(results[0].disabledHabits).toEqual(['D']);
    });

    it('returns premiumType in results for expired annual user', async () => {
      const expiredAnnualDate = new Date();
      expiredAnnualDate.setDate(expiredAnnualDate.getDate() - 366);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 1,
        premium: true,
        premiumDate: expiredAnnualDate.toISOString(),
        premiumType: 'annual',
      });
      mockRepo.getUserHabits.mockResolvedValue({ userId: 1, habits: [] });

      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);
      const results = await uc.checkAndRevokeExpired([1]);

      expect(results).toHaveLength(1);
      expect(results[0].userId).toBe(1);
      expect(results[0].premiumType).toBe('annual');
    });

    it('returns empty array when no expired users', async () => {
      const activeDate = new Date();
      activeDate.setDate(activeDate.getDate() - 5);

      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 1,
        premium: true,
        premiumDate: activeDate.toISOString(),
      });

      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);
      const results = await uc.checkAndRevokeExpired([1]);

      expect(results).toHaveLength(0);
    });

    it('does not revoke lifetime users even when premiumDate is expired', async () => {
      const expiredDate = new Date();
      expiredDate.setDate(expiredDate.getDate() - 100);
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 1,
        premium: true,
        premiumDate: expiredDate.toISOString(),
        isLifetimePremium: true,
      });

      const uc = new SubscriptionUseCase(mockRepo as unknown as IHabitRepository);
      const results = await uc.checkAndRevokeExpired([1]);

      expect(results).toHaveLength(0);
      expect(mockRepo.saveUserPreferences).not.toHaveBeenCalled();
    });
  });
});
