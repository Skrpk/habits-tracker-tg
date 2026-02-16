import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit, SkippedDay, DroppedDay, CheckedDay } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';
import { checkForNewBadges, awardBadges } from '../utils/HabitBadges';

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
    let updatedDropped = habit.dropped || [];
    
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
      
      // For non-daily habits, add today's date to checked array
      let updatedChecked = habit.checked || [];
      const schedule = habit.reminderSchedule;
      const isDaily = !schedule || schedule.type === 'daily';
      
      if (!isDaily) {
        // Only add if not already in checked array
        const alreadyChecked = updatedChecked.some(c => c.date === today);
        if (!alreadyChecked) {
          const checkedDay: CheckedDay = { date: today };
          updatedChecked = [...updatedChecked, checkedDay];
        }
      }
      
      // Check for new badges when streak increases
      // This can award multiple badges if streak jumped past milestones (e.g., from 4 to 10 days)
      let updatedBadges = habit.badges || [];
      const newBadgeTypes = checkForNewBadges(newStreak, updatedBadges);
      if (newBadgeTypes.length > 0) {
        updatedBadges = awardBadges(newBadgeTypes, updatedBadges);
        Logger.info('Badges awarded', {
          userId,
          username: username || 'unknown',
          habitId,
          habitName: habit.name,
          badgeTypes: newBadgeTypes,
          streak: newStreak,
        });
      }
      
      // Update habit with completed check (no checkHistory stored)
      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: today,
        skipped: habit.skipped || [], // Keep skipped days when completing
        checked: updatedChecked,
        badges: updatedBadges,
      });
    } else {
      // Reset streak to 0 and clear skipped days
      newStreak = 0;
      
      const droppedDay: DroppedDay = {
        streakBeforeDrop: habit.streak,
        date: today,
      };
      updatedDropped = [...(habit.dropped || []), droppedDay];
      
      // Update habit with dropped check (no checkHistory stored)
      // Note: Badges persist even when streak is dropped - they represent achievements earned
      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: today,
        skipped: [], // Clear skipped when dropping streak
        dropped: updatedDropped,
        badges: habit.badges || [], // Preserve badges when dropping streak
      });
    }

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

  async skipHabit(userId: number, habitId: string, username?: string): Promise<Habit> {
    Logger.info('Skipping habit', {
      userId,
      username: username || 'unknown',
      habitId,
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

    // Get current streak (before skipping)
    const currentStreak = habit.streak;
    
    // Add skipped day
    const skippedDay: SkippedDay = {
      skippedDay: currentStreak,
      date: today,
    };

    const updatedSkipped = [...(habit.skipped || []), skippedDay];

    await this.habitRepository.updateHabit(userId, habitId, {
      skipped: updatedSkipped,
      lastCheckedDate: today,
      // Keep streak unchanged when skipping
      // No checkHistory stored - it's computed on demand
    });

    const updatedHabits = await this.habitRepository.getUserHabits(userId);
    const updatedHabit = updatedHabits!.habits.find(h => h.id === habitId)!;

    Logger.info('Habit skipped', {
      userId,
      username: username || 'unknown',
      habitId,
      habitName: updatedHabit.name,
      streak: updatedHabit.streak,
      skippedDays: updatedHabit.skipped.length,
    });

    return updatedHabit;
  }
}

