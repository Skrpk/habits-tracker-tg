import { IHabitRepository } from '../repositories/IHabitRepository';
import { UserPreferences } from '../entities/UserPreferences';
import { Logger } from '../../infrastructure/logger/Logger';

export class SetUserPreferencesUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async setTimezone(userId: number, timezone: string): Promise<UserPreferences> {
    // Validate timezone (basic check - IANA timezone format)
    if (!timezone || timezone.trim().length === 0) {
      throw new Error('Timezone cannot be empty');
    }

    const preferences: UserPreferences = {
      userId,
      timezone: timezone.trim(),
    };

    await this.habitRepository.saveUserPreferences(preferences);

    Logger.info('User timezone set', {
      userId,
      timezone,
    });

    return preferences;
  }

  async getPreferences(userId: number): Promise<UserPreferences | null> {
    return await this.habitRepository.getUserPreferences(userId);
  }

  async setConsent(userId: number, accepted: boolean): Promise<UserPreferences> {
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);
    
    const preferences: UserPreferences = {
      userId,
      timezone: existingPreferences?.timezone,
      consentAccepted: accepted,
      consentDate: accepted ? new Date().toISOString().split('T')[0] : undefined,
    };

    await this.habitRepository.saveUserPreferences(preferences);

    Logger.info('User consent updated', {
      userId,
      accepted,
      consentDate: preferences.consentDate,
    });

    return preferences;
  }
}

