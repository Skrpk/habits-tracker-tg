import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit, SkippedDay, DroppedDay, CheckedDay, ReminderSchedule } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';
import { checkForNewBadges, awardBadges } from '../utils/HabitBadges';

/** Returns YYYY-MM-DD for the day before the given date string. */
function dayBefore(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

/**
 * Returns the YYYY-MM-DD of the previous scheduled date relative to checkDate.
 * For daily (or no schedule), this is simply yesterday.
 * For other schedule types, it's the most recent scheduled day before checkDate.
 */
function getPreviousScheduledDate(checkDate: string, schedule?: ReminderSchedule): string {
  if (!schedule || schedule.type === 'daily') {
    return dayBefore(checkDate);
  }

  const d = new Date(checkDate + 'T12:00:00Z');

  switch (schedule.type) {
    case 'weekly': {
      const currentDay = d.getUTCDay();
      const sorted = [...schedule.daysOfWeek].sort((a, b) => a - b);
      let prevDay: number | undefined;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] < currentDay) {
          prevDay = sorted[i];
          break;
        }
      }
      const daysBack = prevDay !== undefined
        ? currentDay - prevDay
        : 7 - sorted[sorted.length - 1] + currentDay;
      d.setUTCDate(d.getUTCDate() - daysBack);
      return d.toISOString().split('T')[0];
    }

    case 'monthly': {
      const currentDayOfMonth = d.getUTCDate();
      const sorted = [...schedule.daysOfMonth].sort((a, b) => a - b);
      let prevDayOfMonth: number | undefined;
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i] < currentDayOfMonth) {
          prevDayOfMonth = sorted[i];
          break;
        }
      }
      if (prevDayOfMonth !== undefined) {
        d.setUTCDate(prevDayOfMonth);
      } else {
        const largest = sorted[sorted.length - 1];
        d.setUTCDate(1);
        d.setUTCMonth(d.getUTCMonth() - 1);
        const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
        d.setUTCDate(Math.min(largest, daysInMonth));
      }
      return d.toISOString().split('T')[0];
    }

    case 'interval': {
      d.setUTCDate(d.getUTCDate() - schedule.intervalDays);
      return d.toISOString().split('T')[0];
    }

    default:
      return dayBefore(checkDate);
  }
}

export class RecordHabitCheckUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  /**
   * Records a habit check (complete or drop).
   * @param targetDate - Optional. The day this check applies to (e.g. reminder's target date). If omitted, uses server today.
   */
  async execute(userId: number, habitId: string, completed: boolean, username?: string, targetDate?: string): Promise<Habit> {
    const checkDate = targetDate || new Date().toISOString().split('T')[0];

    Logger.info('Recording habit check', {
      userId,
      username: username || 'unknown',
      habitId,
      completed,
      checkDate,
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

    const lastCheckedDate = habit.lastCheckedDate;

    if (lastCheckedDate === checkDate) {
      Logger.info('Habit already checked for this day', {
        userId,
        username: username || 'unknown',
        habitId,
        habitName: habit.name,
        lastCheckedDate,
        checkDate,
      });
      return habit;
    }

    let newStreak = habit.streak;
    let updatedDropped = habit.dropped || [];
    const previousScheduledDate = getPreviousScheduledDate(checkDate, habit.reminderSchedule);

    if (completed) {
      if (!lastCheckedDate || lastCheckedDate === '') {
        newStreak = 1;
      } else if (lastCheckedDate === previousScheduledDate) {
        newStreak = habit.streak + 1;
      } else if (lastCheckedDate === checkDate) {
        return habit;
      } else {
        newStreak = 1;
      }

      let updatedChecked = habit.checked || [];
      const schedule = habit.reminderSchedule;
      const isDaily = !schedule || schedule.type === 'daily';

      if (!isDaily) {
        const alreadyChecked = updatedChecked.some(c => c.date === checkDate);
        if (!alreadyChecked) {
          updatedChecked = [...updatedChecked, { date: checkDate }];
        }
      }

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

      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: checkDate,
        skipped: habit.skipped || [],
        checked: updatedChecked,
        badges: updatedBadges,
      });
    } else {
      newStreak = 0;

      updatedDropped = [...(habit.dropped || []), {
        streakBeforeDrop: habit.streak,
        date: checkDate,
      }];

      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: checkDate,
        skipped: [],
        dropped: updatedDropped,
        badges: habit.badges || [],
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

  /**
   * Records a skip for a habit. Preserves streak.
   * @param targetDate - Optional. The day this skip applies to. If omitted, uses server today.
   */
  async skipHabit(userId: number, habitId: string, username?: string, targetDate?: string): Promise<Habit> {
    const checkDate = targetDate || new Date().toISOString().split('T')[0];

    Logger.info('Skipping habit', {
      userId,
      username: username || 'unknown',
      habitId,
      checkDate,
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

    const lastCheckedDate = habit.lastCheckedDate;

    if (lastCheckedDate === checkDate) {
      Logger.info('Habit already checked for this day', {
        userId,
        username: username || 'unknown',
        habitId,
        habitName: habit.name,
        lastCheckedDate,
        checkDate,
      });
      return habit;
    }

    const currentStreak = habit.streak;
    const skippedDay: SkippedDay = {
      skippedDay: currentStreak,
      date: checkDate,
    };

    const updatedSkipped = [...(habit.skipped || []), skippedDay];

    await this.habitRepository.updateHabit(userId, habitId, {
      skipped: updatedSkipped,
      lastCheckedDate: checkDate,
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

