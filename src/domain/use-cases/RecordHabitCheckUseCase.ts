import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

export class RecordHabitCheckUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number, habitId: string, completed: boolean, username?: string): Promise<Habit> {
    Logger.info('Recording habit check', {
      userId,
      username: username || 'unknown',
      habitId,
      completed,
    });

    const userHabits = await this.habitRepository.getUserHabits(userId);
    
    if (!userHabits) {
      Logger.error('User habits not found', { userId, habitId });
      throw new Error('User habits not found');
    }

    const habit = userHabits.habits.find(h => h.id === habitId);
    if (!habit) {
      Logger.error('Habit not found', { userId, habitId });
      throw new Error('Habit not found');
    }

    const today = new Date().toISOString().split('T')[0];
    const lastCheckedDate = habit.lastCheckedDate;

    // If already checked today, don't update
    if (lastCheckedDate === today) {
      Logger.info('Habit already checked today', {
        userId,
        username: username || 'unknown',
        habitId,
        habitName: habit.name,
        lastCheckedDate,
      });
      return habit;
    }

    let newStreak = habit.streak;
    
    if (completed) {
      // Check if yesterday was checked (for streak continuity)
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().split('T')[0];
      
      if (!lastCheckedDate || lastCheckedDate === '') {
        // First check ever
        newStreak = 1;
      } else if (lastCheckedDate === yesterdayStr) {
        // Continue streak (checked yesterday, checking today)
        newStreak = habit.streak + 1;
      } else if (lastCheckedDate === today) {
        // Already checked today, don't update streak
        return habit;
      } else {
        // Gap in checking - streak broken, start new streak
        newStreak = 1;
      }
    } else {
      // Reset streak to 0
      newStreak = 0;
    }

    await this.habitRepository.updateHabit(userId, habitId, {
      streak: newStreak,
      lastCheckedDate: today,
    });

    const updatedHabits = await this.habitRepository.getUserHabits(userId);
    const updatedHabit = updatedHabits!.habits.find(h => h.id === habitId)!;

    Logger.info('Habit check recorded', {
      userId,
      username: username || 'unknown',
      habitId,
      habitName: updatedHabit.name,
      completed,
      previousStreak: habit.streak,
      newStreak: updatedHabit.streak,
      streakChange: updatedHabit.streak - habit.streak,
    });

    return updatedHabit;
  }
}

