import { IHabitRepository } from '../repositories/IHabitRepository';
import { UserPreferences } from '../entities/UserPreferences';
import { Logger } from '../../infrastructure/logger/Logger';
import { Language, mapTelegramLangCode } from '../../i18n';
import TelegramBot from 'node-telegram-bot-api';

export class SetUserPreferencesUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  /**
   * Sets the user's UI language. Choosing a language IS the consent action, so
   * this also records consent (backward-compatible with the old consent step):
   * `consentAccepted = true` and, on first accept, stamps `consentDate`.
   */
  async setLanguage(userId: number, language: Language, user?: TelegramBot.User): Promise<UserPreferences> {
    const existing = await this.habitRepository.getUserPreferences(userId);

    const preferences: UserPreferences = {
      userId,
      user: user || existing?.user,
      language,
      consentAccepted: true,
      // Preserve the original consent date on repeat calls (e.g. changing language later).
      consentDate: existing?.consentDate ?? new Date().toISOString().split('T')[0],
    };

    await this.habitRepository.saveUserPreferences(preferences);

    Logger.info('User language set', { userId, language });

    return preferences;
  }

  /**
   * Resolves the language to render for a user: stored choice → Telegram
   * language_code → English. Legacy users (no stored language) fall through here.
   */
  async getLanguage(userId: number, user?: TelegramBot.User): Promise<Language> {
    const preferences = await this.habitRepository.getUserPreferences(userId);
    if (preferences?.language) {
      return preferences.language;
    }
    return mapTelegramLangCode(user?.language_code);
  }

  async setTimezone(userId: number, timezone: string, user?: TelegramBot.User): Promise<UserPreferences> {
    // Validate timezone (basic check - IANA timezone format)
    if (!timezone || timezone.trim().length === 0) {
      throw new Error('Timezone cannot be empty');
    }

    // Get existing preferences to preserve user object and other fields
    const existingPreferences = await this.habitRepository.getUserPreferences(userId);
    const newTimezone = timezone.trim();
    const previousTimezone = existingPreferences?.timezone;

    const preferences: UserPreferences = {
      userId,
      user: user || existingPreferences?.user, // Preserve existing user object if new one not provided
      timezone: newTimezone,
      consentAccepted: existingPreferences?.consentAccepted,
      consentDate: existingPreferences?.consentDate,
    };

    await this.habitRepository.saveUserPreferences(preferences);

    // Keep existing habits' reminder schedules on the user's new zone, preserving
    // the wall-clock time they picked ("my 21:00 habit stays 21:00 after I move").
    // Without this, a schedule keeps the zone it was created in forever and the
    // reminder silently arrives at the wrong local hour.
    //
    // Every schedule is migrated, not just those still matching the old
    // preference: there is no per-habit timezone picker (schedules are always
    // stamped with the preference at creation), so a divergent value is stale
    // data, not intent — and migrating all of them self-heals rows that already
    // drifted. Revisit if a per-habit timezone is ever exposed.
    const migrated = await this.migrateHabitScheduleTimezones(userId, newTimezone);

    Logger.info('User timezone set', {
      userId,
      timezone: newTimezone,
      previousTimezone,
      migratedSchedules: migrated,
    });

    return preferences;
  }

  /**
   * Rewrite every habit's `reminderSchedule.timezone` to `timezone`, leaving the
   * scheduled hour/minute untouched. Returns how many habits were changed.
   * Best-effort: a failure here must not fail the timezone change itself.
   */
  private async migrateHabitScheduleTimezones(userId: number, timezone: string): Promise<number> {
    try {
      const userHabits = await this.habitRepository.getUserHabits(userId);
      if (!userHabits) return 0;

      let migrated = 0;
      for (const habit of userHabits.habits) {
        const schedule = habit.reminderSchedule;
        if (!schedule || schedule.timezone === timezone) continue;

        await this.habitRepository.updateHabit(userId, habit.id, {
          reminderSchedule: { ...schedule, timezone },
        });
        migrated++;
      }
      return migrated;
    } catch (error) {
      Logger.error('Failed to migrate habit schedule timezones', {
        userId,
        timezone,
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
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

