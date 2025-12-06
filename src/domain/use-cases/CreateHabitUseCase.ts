import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

export class CreateHabitUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number, habitName: string, username?: string): Promise<Habit> {
    if (!habitName || habitName.trim().length === 0) {
      throw new Error('Habit name cannot be empty');
    }

    const trimmedName = habitName.trim();
    Logger.info('Creating habit', {
      userId,
      username: username || 'unknown',
      habitName: trimmedName,
    });

    const habit = await this.habitRepository.createHabit(userId, trimmedName);

    Logger.info('Habit created successfully', {
      userId,
      username: username || 'unknown',
      habitId: habit.id,
      habitName: habit.name,
    });

    return habit;
  }
}

