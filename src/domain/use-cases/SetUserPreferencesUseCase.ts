import { IHabitRepository } from '../repositories/IHabitRepository';
import { UserPreferences } from '../entities/UserPreferences';
import { Logger } from '../../infrastructure/logger/Logger';
import TelegramBot from 'node-telegram-bot-api';

export class SetUserPreferencesUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async setTimezone(userId: number, timezone: string, user?: TelegramBot.User): Promise<UserPreferences> {
    // Validate timezone (basic check - IANA timezone format)
    if (!timezone || timezone.trim().length === 0) {
      throw new Error('Timezone cannot be empty');
    }

    // Get existing preferences to preserve user object and other fields
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);

    const preferences: UserPreferences = {
      userId,
      user: user || existingPreferences?.user, // Preserve existing user object if new one not provided
      timezone: timezone.trim(),
      consentAccepted: existingPreferences?.consentAccepted,
      consentDate: existingPreferences?.consentDate,
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

  async setBlocked(userId: number, blocked: boolean): Promise<UserPreferences> {
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);

    const preferences: UserPreferences = {
      userId,
      user: existingPreferences?.user,
      timezone: existingPreferences?.timezone,
      consentAccepted: existingPreferences?.consentAccepted,
      consentDate: existingPreferences?.consentDate,
      blocked,
    };

    await this.habitRepository.saveUserPreferences(preferences);

    Logger.info('User blocked status updated', {
      userId,
      blocked,
    });

    return preferences;
  }

  async setConsent(userId: number, accepted: boolean, user?: TelegramBot.User): Promise<UserPreferences> {
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);
    
    const preferences: UserPreferences = {
      userId,
      user: user || existingPreferences?.user, // Preserve existing user object if new one not provided
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

  async updateUser(userId: number, user: TelegramBot.User): Promise<UserPreferences> {
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);
    
    const preferences: UserPreferences = {
      userId,
      user,
      timezone: existingPreferences?.timezone,
      consentAccepted: existingPreferences?.consentAccepted,
      consentDate: existingPreferences?.consentDate,
      blocked: existingPreferences?.blocked,
    };

    await this.habitRepository.saveUserPreferences(preferences);

    Logger.info('User information updated', {
      userId,
      username: user.username,
    });

    return preferences;
  }
}

