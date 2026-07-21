import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

/**
 * Clears an auto-pause ("Resume now" button, or any manual resume): removes
 * `remindersPausedUntil` and resets `missedReminderCount` so reminders flow again.
 */
export class ResumeRemindersUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async getHabit(userId: number, habitId: string): Promise<Habit | null> {
    const userHabits = await this.habitRepository.getUserHabits(userId);
    return userHabits?.habits.find(h => h.id === habitId) ?? null;
  }

  async resume(userId: number, habitId: string): Promise<void> {
    await this.habitRepository.updateHabit(userId, habitId, {
      remindersPausedUntil: undefined,
      missedReminderCount: 0,
    });
    Logger.info('Habit reminders resumed', { userId, habitId });
  }
}
