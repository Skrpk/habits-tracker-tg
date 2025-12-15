import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit, ReminderSchedule } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

export class SetHabitReminderScheduleUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(
    userId: number,
    habitId: string,
    schedule: ReminderSchedule
  ): Promise<Habit> {
    // Validate schedule
    this.validateSchedule(schedule);

    await this.habitRepository.updateHabit(userId, habitId, {
      reminderSchedule: schedule,
      reminderEnabled: true,
    });

    const userHabits = await this.habitRepository.getUserHabits(userId);
    const updatedHabit = userHabits!.habits.find(h => h.id === habitId)!;

    Logger.info('Habit reminder schedule set', {
      userId,
      habitId,
      habitName: updatedHabit.name,
      schedule,
    });

    return updatedHabit;
  }

  async toggleReminder(userId: number, habitId: string, enabled: boolean): Promise<Habit> {
    await this.habitRepository.updateHabit(userId, habitId, {
      reminderEnabled: enabled,
    });

    const userHabits = await this.habitRepository.getUserHabits(userId);
    const updatedHabit = userHabits!.habits.find(h => h.id === habitId)!;

    Logger.info('Habit reminder toggled', {
      userId,
      habitId,
      habitName: updatedHabit.name,
      enabled,
    });

    return updatedHabit;
  }

  private validateSchedule(schedule: ReminderSchedule): void {
    if (schedule.hour < 0 || schedule.hour > 23) {
      throw new Error('Hour must be between 0 and 23');
    }
    if (schedule.minute < 0 || schedule.minute > 59) {
      throw new Error('Minute must be between 0 and 59');
    }

    switch (schedule.type) {
      case 'daily':
        // No additional validation needed
        break;

      case 'weekly':
        if (!schedule.daysOfWeek || schedule.daysOfWeek.length === 0) {
          throw new Error('Weekly schedule must have at least one day of week');
        }
        if (schedule.daysOfWeek.some(d => d < 0 || d > 6)) {
          throw new Error('Days of week must be between 0 (Sunday) and 6 (Saturday)');
        }
        break;

      case 'monthly':
        if (!schedule.daysOfMonth || schedule.daysOfMonth.length === 0) {
          throw new Error('Monthly schedule must have at least one day of month');
        }
        if (schedule.daysOfMonth.some(d => d < 1 || d > 31)) {
          throw new Error('Days of month must be between 1 and 31');
        }
        break;

      case 'interval':
        if (!schedule.intervalDays || schedule.intervalDays < 1) {
          throw new Error('Interval days must be at least 1');
        }
        break;
    }
  }

  /**
   * Parse schedule from user input
   * Examples:
   * - "daily 20:30" -> daily schedule
   * - "weekly tuesday,saturday 18:00" -> weekly schedule
   * - "monthly 20,26 22:00" -> monthly schedule
   * - "interval 2 20:00" -> every 2 days
   */
  parseSchedule(input: string, timezone?: string): ReminderSchedule {
    const parts = input.trim().toLowerCase().split(/\s+/);
    
    if (parts.length < 2) {
      throw new Error('Invalid schedule format. Use: daily|weekly|monthly|interval [options] HH:MM');
    }

    const type = parts[0];
    const timeMatch = parts[parts.length - 1].match(/(\d{1,2}):(\d{2})/);
    
    if (!timeMatch) {
      throw new Error('Time must be in HH:MM format');
    }

    const hour = parseInt(timeMatch[1], 10);
    const minute = parseInt(timeMatch[2], 10);

    switch (type) {
      case 'daily': {
        return {
          type: 'daily',
          hour,
          minute,
          timezone,
        };
      }

      case 'weekly': {
        if (parts.length < 3) {
          throw new Error('Weekly schedule requires days: weekly monday,tuesday 20:00');
        }
        
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const daysInput = parts.slice(1, -1).join(',').split(',');
        const daysOfWeek = daysInput.map(day => {
          const dayIndex = dayNames.indexOf(day.trim().toLowerCase());
          if (dayIndex === -1) {
            throw new Error(`Invalid day name: ${day}. Use: ${dayNames.join(', ')}`);
          }
          return dayIndex;
        });

        return {
          type: 'weekly',
          daysOfWeek,
          hour,
          minute,
          timezone,
        };
      }

      case 'monthly': {
        if (parts.length < 3) {
          throw new Error('Monthly schedule requires days: monthly 20,26 22:00');
        }
        
        const daysInput = parts.slice(1, -1).join(',').split(',');
        const daysOfMonth = daysInput.map(day => {
          const dayNum = parseInt(day.trim(), 10);
          if (isNaN(dayNum) || dayNum < 1 || dayNum > 31) {
            throw new Error(`Invalid day of month: ${day}. Must be 1-31`);
          }
          return dayNum;
        });

        return {
          type: 'monthly',
          daysOfMonth,
          hour,
          minute,
          timezone,
        };
      }

      case 'interval': {
        if (parts.length < 3) {
          throw new Error('Interval schedule requires number of days: interval 2 20:00');
        }
        
        const intervalDays = parseInt(parts[1], 10);
        if (isNaN(intervalDays) || intervalDays < 1) {
          throw new Error(`Invalid interval: ${parts[1]}. Must be a positive number`);
        }

        return {
          type: 'interval',
          intervalDays,
          hour,
          minute,
          timezone,
          startDate: new Date().toISOString().split('T')[0], // Start from today
        };
      }

      default:
        throw new Error(`Unknown schedule type: ${type}. Use: daily, weekly, monthly, or interval`);
    }
  }
}

