import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetUserPreferencesUseCase } from '../../../src/domain/use-cases/SetUserPreferencesUseCase';
import type { IHabitRepository } from '../../../src/domain/repositories/IHabitRepository';
import type { UserPreferences } from '../../../src/domain/entities/UserPreferences';

vi.mock('../../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('SetUserPreferencesUseCase — language', () => {
  let mockRepo: {
    getUserPreferences: ReturnType<typeof vi.fn>;
    saveUserPreferences: ReturnType<typeof vi.fn>;
  };
  let useCase: SetUserPreferencesUseCase;

  beforeEach(() => {
    mockRepo = {
      getUserPreferences: vi.fn().mockResolvedValue(null),
      saveUserPreferences: vi.fn().mockResolvedValue(undefined),
    };
    useCase = new SetUserPreferencesUseCase(mockRepo as unknown as IHabitRepository);
  });

  describe('setLanguage', () => {
    it('sets language AND records consent (backward compatible) for a new user', async () => {
      const result = await useCase.setLanguage(100, 'uk');

      expect(result.language).toBe('uk');
      expect(result.consentAccepted).toBe(true);
      expect(result.consentDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(mockRepo.saveUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 100, language: 'uk', consentAccepted: true })
      );
    });

    it('preserves the original consentDate on a later language change', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({
        userId: 100,
        language: 'en',
        consentAccepted: true,
        consentDate: '2025-01-15',
      } as UserPreferences);

      const result = await useCase.setLanguage(100, 'ru');

      expect(result.language).toBe('ru');
      expect(result.consentDate).toBe('2025-01-15'); // not re-stamped
    });

    it('carries the Telegram user object through', async () => {
      const user = { id: 100, is_bot: false, first_name: 'Test' };
      await useCase.setLanguage(100, 'en', user);
      expect(mockRepo.saveUserPreferences).toHaveBeenCalledWith(
        expect.objectContaining({ user })
      );
    });
  });

  describe('getLanguage', () => {
    it('returns the stored language when present', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ userId: 100, language: 'ru' } as UserPreferences);
      expect(await useCase.getLanguage(100)).toBe('ru');
    });

    it('falls back to the Telegram language_code for legacy users (no stored language)', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ userId: 100, consentAccepted: true } as UserPreferences);
      expect(await useCase.getLanguage(100, { id: 100, is_bot: false, first_name: 'T', language_code: 'uk' })).toBe('uk');
    });

    it('defaults to English when neither stored language nor a known Telegram code exists', async () => {
      mockRepo.getUserPreferences.mockResolvedValue(null);
      expect(await useCase.getLanguage(100)).toBe('en');
      expect(await useCase.getLanguage(100, { id: 100, is_bot: false, first_name: 'T', language_code: 'de' })).toBe('en');
    });

    it('prefers the stored language over the Telegram code', async () => {
      mockRepo.getUserPreferences.mockResolvedValue({ userId: 100, language: 'en' } as UserPreferences);
      expect(await useCase.getLanguage(100, { id: 100, is_bot: false, first_name: 'T', language_code: 'ru' })).toBe('en');
    });
  });
});

/**
 * Changing the timezone in Settings used to update preferences only, leaving
 * every existing habit's `reminderSchedule.timezone` pinned to the zone it was
 * created in. That mismatch is what surfaced the double-conversion bug in the
 * reminder scheduler, and even with that fixed it would deliver reminders at
 * the old zone's local hour.
 */
describe('SetUserPreferencesUseCase — setTimezone migrates habit schedules', () => {
  function makeHabit(id: string, timezone?: string) {
    return {
      id,
      userId: 100,
      name: id,
      streak: 0,
      createdAt: new Date('2026-01-01'),
      lastCheckedDate: '',
      skipped: [],
      dropped: [],
      reminderSchedule: timezone
        ? { type: 'daily' as const, hour: 21, minute: 0, timezone }
        : { type: 'daily' as const, hour: 21, minute: 0 },
    };
  }

  function setup(habits: ReturnType<typeof makeHabit>[], existingTimezone = 'Europe/Kyiv') {
    const mockRepo = {
      getUserPreferences: vi.fn().mockResolvedValue({ userId: 100, timezone: existingTimezone }),
      saveUserPreferences: vi.fn().mockResolvedValue(undefined),
      getUserHabits: vi.fn().mockResolvedValue({ userId: 100, habits }),
      updateHabit: vi.fn().mockResolvedValue(undefined),
    };
    return {
      mockRepo,
      useCase: new SetUserPreferencesUseCase(mockRepo as unknown as IHabitRepository),
    };
  }

  it('rewrites the schedule timezone while preserving the wall-clock time', async () => {
    const { mockRepo, useCase } = setup([makeHabit('h1', 'Europe/Kyiv')]);

    await useCase.setTimezone(100, 'Europe/Rome');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'h1', {
      reminderSchedule: { type: 'daily', hour: 21, minute: 0, timezone: 'Europe/Rome' },
    });
  });

  it('migrates habits that already drifted from the previous preference', async () => {
    const { mockRepo, useCase } = setup([makeHabit('h1', 'America/New_York')], 'Europe/Rome');

    await useCase.setTimezone(100, 'Europe/Berlin');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'h1', {
      reminderSchedule: expect.objectContaining({ timezone: 'Europe/Berlin' }),
    });
  });

  it('stamps a timezone onto schedules that carry none', async () => {
    const { mockRepo, useCase } = setup([makeHabit('h1')]);

    await useCase.setTimezone(100, 'Europe/Rome');

    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'h1', {
      reminderSchedule: { type: 'daily', hour: 21, minute: 0, timezone: 'Europe/Rome' },
    });
  });

  it('skips habits already on the target timezone', async () => {
    const { mockRepo, useCase } = setup([makeHabit('h1', 'Europe/Rome'), makeHabit('h2', 'Europe/Kyiv')]);

    await useCase.setTimezone(100, 'Europe/Rome');

    expect(mockRepo.updateHabit).toHaveBeenCalledTimes(1);
    expect(mockRepo.updateHabit).toHaveBeenCalledWith(100, 'h2', expect.anything());
  });

  it('still sets the preference when habit migration fails', async () => {
    const { mockRepo, useCase } = setup([makeHabit('h1', 'Europe/Kyiv')]);
    mockRepo.updateHabit.mockRejectedValue(new Error('redis down'));

    const result = await useCase.setTimezone(100, 'Europe/Rome');

    expect(result.timezone).toBe('Europe/Rome');
    expect(mockRepo.saveUserPreferences).toHaveBeenCalled();
  });

  it('does not throw for a user with no habits', async () => {
    const { mockRepo, useCase } = setup([]);
    mockRepo.getUserHabits.mockResolvedValue(null);

    await expect(useCase.setTimezone(100, 'Europe/Rome')).resolves.toBeTruthy();
    expect(mockRepo.updateHabit).not.toHaveBeenCalled();
  });
});
