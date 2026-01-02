import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { CheckHabitReminderDueUseCase } from './CheckHabitReminderDueUseCase';
import { Logger } from '../../infrastructure/logger/Logger';

export class GetHabitsDueForReminderUseCase {
  private checkReminderDue: CheckHabitReminderDueUseCase;

  constructor(private habitRepository: IHabitRepository) {
    this.checkReminderDue = new CheckHabitReminderDueUseCase();
  }

  async execute(currentDate: Date, currentHour: number, currentMinute: number, serverTimezone: string = 'UTC'): Promise<Habit[]> {
    const allActiveUserIds = await this.habitRepository.getAllActiveUserIds();
    const habitsDueForReminder: Habit[] = [];

    for (const userId of allActiveUserIds) {
      const userHabits = await this.habitRepository.getUserHabits(userId);
      if (!userHabits) continue;

      // Get user's timezone preference (default to UTC if not set)
      const userPreferences = await this.habitRepository.getUserPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      // Convert current server time to user's timezone
      let userDate = currentDate;
      let userHour = currentHour;
      let userMinute = currentMinute;

      if (userTimezone !== serverTimezone) {
        const userTime = new Date(currentDate.toLocaleString('en-US', { timeZone: userTimezone }));
        userDate = userTime;
        userHour = userTime.getHours();
        userMinute = userTime.getMinutes();
      }

      const today = userDate.toISOString().split('T')[0];

      for (const habit of userHabits.habits) {
        // Skip if habit is disabled
        if (habit.disabled === true) {
          continue;
        }

        // Skip if already checked today
        if (habit.lastCheckedDate === today) {
          continue;
        }

        // Check if habit is due for reminder based on its schedule (using user's timezone)
        if (this.checkReminderDue.isDue(habit, userDate, userHour, userMinute, userTimezone)) {
          habitsDueForReminder.push(habit);
          Logger.debug('Habit due for reminder', {
            userId: habit.userId,
            habitId: habit.id,
            habitName: habit.name,
            schedule: habit.reminderSchedule,
            userTimezone,
            userHour,
            userMinute,
          });
        }
      }
    }

    Logger.info('Found habits due for reminder', {
      count: habitsDueForReminder.length,
      serverHour: currentHour,
      serverMinute: currentMinute,
    });

    return habitsDueForReminder;
  }
}

