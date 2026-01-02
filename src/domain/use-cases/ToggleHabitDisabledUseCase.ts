import { IHabitRepository } from '../repositories/IHabitRepository';
import { Logger } from '../../infrastructure/logger/Logger';

export class ToggleHabitDisabledUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number, habitId: string): Promise<boolean> {
    try {
      const userHabits = await this.habitRepository.getUserHabits(userId);
      if (!userHabits) {
        throw new Error('User habits not found');
      }

      const habit = userHabits.habits.find(h => h.id === habitId);
      if (!habit) {
        throw new Error('Habit not found');
      }

      // Toggle disabled state
      habit.disabled = !habit.disabled;

      // Save updated habits
      await this.habitRepository.saveUserHabits(userHabits);

      Logger.info('Habit disabled state toggled', {
        userId,
        habitId,
        habitName: habit.name,
        disabled: habit.disabled,
      });

      return habit.disabled;
    } catch (error) {
      Logger.error('Error toggling habit disabled state', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}

