import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

export class CreateHabitUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number, habitName: string, username?: string, timezone?: string): Promise<Habit> {
    if (!habitName || habitName.trim().length === 0) {
      throw new Error('Habit name cannot be empty');
    }

    const trimmedName = habitName.trim();
    
    // Get user's timezone if not provided
    let userTimezone = timezone;
    if (!userTimezone) {
      const preferences = await this.habitRepository.getUserPreferences(userId);
      userTimezone = preferences?.timezone || 'UTC';
    }

    Logger.info('Creating habit', {
      userId,
      username: username || 'unknown',
      habitName: trimmedName,
      timezone: userTimezone,
    });

    const habit = await this.habitRepository.createHabit(userId, trimmedName, userTimezone);

    Logger.info('Habit created successfully', {
      userId,
      username: username || 'unknown',
      habitId: habit.id,
      habitName: habit.name,
      timezone: userTimezone,
    });

    return habit;
  }
}

