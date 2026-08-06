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
