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

    const preferences = await this.habitRepository.getUserPreferences(userId);
    const isPremium = preferences?.premium === true;
    const maxFreeHabits = parseInt(process.env.MAX_FREE_HABITS || '3', 10);

    if (!isPremium) {
      const userHabits = await this.habitRepository.getUserHabits(userId);
      if (userHabits && userHabits.habits.length >= maxFreeHabits) {
        throw new Error(`Free users can create up to ${maxFreeHabits} habits. Use /subscribe to upgrade to Premium for unlimited habits!`);
      }
    }

    let userTimezone = timezone || preferences?.timezone || 'UTC';

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

