import { kv } from '../config/kv';
import { IHabitRepository } from '../../domain/repositories/IHabitRepository';
import { Habit, UserHabits } from '../../domain/entities/Habit';
import { UserPreferences } from '../../domain/entities/UserPreferences';
import { Logger } from '../logger/Logger';

export class VercelKVHabitRepository implements IHabitRepository {
  private getUserKey(userId: number): string {
    return `user:${userId}:habits`;
  }

  private getActiveUsersKey(): string {
    return 'active_users';
  }

  private getUserPreferencesKey(userId: number): string {
    return `user:${userId}:preferences`;
  }

  async getUserHabits(userId: number): Promise<UserHabits | null> {
    try {
      const data = await kv.get(this.getUserKey(userId)) as UserHabits | null;
      if (data) {
        // Migration: Ensure all habits have required fields
        data.habits = data.habits.map(habit => ({
          ...habit,
          skipped: habit.skipped || [],
          dropped: habit.dropped || [],
          checked: habit.checked || [], // Initialize checked array if missing
          badges: habit.badges || [], // Initialize badges array if missing (backward compatibility)
          // checkHistory is no longer stored - it's computed on demand
          // Set default reminder schedule if missing (daily at 22:00 UTC)
          reminderSchedule: habit.reminderSchedule || {
            type: 'daily',
            hour: 22,
            minute: 0,
            timezone: 'UTC',
          },
          reminderEnabled: habit.reminderEnabled !== false, // default true
          disabled: habit.disabled === true, // default false
        }));
      }
      Logger.debug('Retrieved user habits', {
        userId,
        habitCount: data?.habits.length || 0,
      });
      return data;
    } catch (error) {
      Logger.error('Error getting user habits', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async saveUserHabits(userHabits: UserHabits): Promise<void> {
    try {
      Logger.debug('Saving user habits', {
        userId: userHabits.userId,
        habitCount: userHabits.habits.length,
      });
      await kv.set(this.getUserKey(userHabits.userId), userHabits);
      Logger.debug('User habits saved successfully', {
        userId: userHabits.userId,
      });
    } catch (error) {
      Logger.error('Error saving user habits', {
        userId: userHabits.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  async createHabit(userId: number, habitName: string, timezone: string = 'UTC'): Promise<Habit> {
    const userHabits = await this.getUserHabits(userId);
    const today = new Date().toISOString().split('T')[0];
    
    const newHabit: Habit = {
      id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      userId,
      name: habitName,
      streak: 0,
      createdAt: new Date(),
      lastCheckedDate: '',
      skipped: [],
      dropped: [],
      checked: [], // Empty array for all habits (will be populated for non-daily habits)
      // checkHistory is computed on demand, not stored
      // Default reminder schedule: daily at 22:00 in user's timezone
      reminderSchedule: {
        type: 'daily',
        hour: 22,
        minute: 0,
        timezone: timezone,
      },
      reminderEnabled: true,
    };

    const updatedUserHabits: UserHabits = userHabits || {
      userId,
      habits: [],
    };

    updatedUserHabits.habits.push(newHabit);
    await this.saveUserHabits(updatedUserHabits);
    
    // Track user as active
    await this.addActiveUser(userId);

    return newHabit;
  }

  async updateHabit(userId: number, habitId: string, updates: Partial<Habit>): Promise<void> {
    const userHabits = await this.getUserHabits(userId);
    if (!userHabits) {
      throw new Error('User habits not found');
    }

    const habitIndex = userHabits.habits.findIndex(h => h.id === habitId);
    if (habitIndex === -1) {
      throw new Error('Habit not found');
    }

    userHabits.habits[habitIndex] = {
      ...userHabits.habits[habitIndex],
      ...updates,
    };

    await this.saveUserHabits(userHabits);
  }

  async deleteHabit(userId: number, habitId: string): Promise<void> {
    const userHabits = await this.getUserHabits(userId);
    if (!userHabits) {
      throw new Error('User habits not found');
    }

    userHabits.habits = userHabits.habits.filter(h => h.id !== habitId);
    await this.saveUserHabits(userHabits);
    
    // If no habits left, remove from active users
    if (userHabits.habits.length === 0) {
      await this.removeActiveUser(userId);
    }
  }

  async getAllActiveUserIds(): Promise<number[]> {
    try {
      const userIds = await kv.get(this.getActiveUsersKey()) as number[] | null;
      return userIds || [];
    } catch (error) {
      console.error('Error getting active user IDs:', error);
      return [];
    }
  }

  async addActiveUser(userId: number): Promise<void> {
    try {
      const userIds = await this.getAllActiveUserIds();
      if (!userIds.includes(userId)) {
        userIds.push(userId);
        await kv.set(this.getActiveUsersKey(), userIds);
        Logger.info('Added user to active users list', {
          userId,
          totalActiveUsers: userIds.length,
        });
      } else {
        Logger.debug('User already in active users list', { userId });
      }
    } catch (error) {
      Logger.error('Error adding active user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async removeActiveUser(userId: number): Promise<void> {
    try {
      const userIds = await this.getAllActiveUserIds();
      const filtered = userIds.filter(id => id !== userId);
      await kv.set(this.getActiveUsersKey(), filtered);
      Logger.info('Removed user from active users list', {
        userId,
        totalActiveUsers: filtered.length,
      });
    } catch (error) {
      Logger.error('Error removing active user', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  async getUserPreferences(userId: number): Promise<UserPreferences | null> {
    try {
      const data = await kv.get(this.getUserPreferencesKey(userId)) as UserPreferences | null;
      Logger.debug('Retrieved user preferences', { userId, hasTimezone: !!data?.timezone });
      return data;
    } catch (error) {
      Logger.error('Error getting user preferences', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  async saveUserPreferences(preferences: UserPreferences): Promise<void> {
    try {
      // Merge with existing preferences to preserve all fields
      const existingPreferences = await this.getUserPreferences(preferences.userId);
      const mergedPreferences: UserPreferences = {
        ...existingPreferences,
        ...preferences,
        userId: preferences.userId, // Ensure userId is set
      };

      Logger.debug('Saving user preferences', {
        userId: preferences.userId,
        timezone: mergedPreferences.timezone,
        consentAccepted: mergedPreferences.consentAccepted,
        consentDate: mergedPreferences.consentDate,
      });
      await kv.set(this.getUserPreferencesKey(preferences.userId), mergedPreferences);
      Logger.info('User preferences saved successfully', {
        userId: preferences.userId,
      });
    } catch (error) {
      Logger.error('Error saving user preferences', {
        userId: preferences.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

