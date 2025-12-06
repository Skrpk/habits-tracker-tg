import { IHabitRepository } from '../repositories/IHabitRepository';
import { Logger } from '../../infrastructure/logger/Logger';

export class DeleteHabitUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number, habitId: string, username?: string, habitName?: string): Promise<void> {
    Logger.info('Deleting habit', {
      userId,
      username: username || 'unknown',
      habitId,
      habitName: habitName || 'unknown',
    });

    await this.habitRepository.deleteHabit(userId, habitId);

    Logger.info('Habit deleted successfully', {
      userId,
      username: username || 'unknown',
      habitId,
      habitName: habitName || 'unknown',
    });
  }
}

