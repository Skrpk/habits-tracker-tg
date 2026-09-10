import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { CheckHabitReminderDueUseCase } from './CheckHabitReminderDueUseCase';
import { isPostponeDue } from '../utils/postpone';
import { toZonedDate } from '../utils/timezone';
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
        const userTime = toZonedDate(currentDate, userTimezone);
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

        // Skip if auto-paused (2 ignored daily reminders). Pause wins over a
        // pending postpone; it clears itself via the resume branch once expired.
        if (habit.remindersPausedUntil && today < habit.remindersPausedUntil) {
          continue;
        }

        // A habit is due either on its normal schedule, or because a "Check
        // later" postpone has come due (window match on the true instant, so any
        // cron cadence catches it). reminderEnabled is honored for both paths.
        const remindersOn = habit.reminderEnabled !== false;
        const postponeDue = remindersOn && isPostponeDue(habit.postponedUntil, currentDate, userTimezone);
        // Pass the TRUE instant, not `userDate` (already shifted into the user's
        // wall clock for the `today` string above) — isDue converts internally,
        // and feeding it a converted date applied the offset twice.
        const scheduleDue = this.checkReminderDue.isDue(habit, currentDate, userTimezone);

        if (postponeDue || scheduleDue) {
          habitsDueForReminder.push(habit);
          Logger.debug('Habit due for reminder', {
            userId: habit.userId,
            habitId: habit.id,
            habitName: habit.name,
            schedule: habit.reminderSchedule,
            reason: postponeDue ? 'postpone' : 'schedule',
            userTimezone,
            userHour,
            userMinute,
          });
        }
      }
    }

    // Logger.info('Found habits due for reminder', {
    //   count: habitsDueForReminder.length,
    //   serverHour: currentHour,
    //   serverMinute: currentMinute,
    // });

    return habitsDueForReminder;
  }
}

