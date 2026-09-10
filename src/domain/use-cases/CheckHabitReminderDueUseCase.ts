import { Habit, ReminderSchedule } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';
import { toZonedDate } from '../utils/timezone';

export class CheckHabitReminderDueUseCase {
  /**
   * Check if a habit is due for a reminder at the instant `now`.
   *
   * `now` MUST be the true instant (the cron's `new Date()`), never a date that
   * has already been converted into some zone's wall clock — this method does
   * the conversion itself, and converting twice applies the offset twice (it
   * fired reminders `userOffset` hours early whenever a habit's schedule
   * timezone differed from the user's preference timezone).
   *
   * `timezone` is only the fallback for schedules that carry no timezone.
   */
  isDue(habit: Habit, now: Date, timezone: string = 'UTC'): boolean {
    // If reminders disabled, not due
    if (habit.reminderEnabled === false) {
      return false;
    }

    // Get schedule (default to daily at 22:00 UTC)
    const schedule: ReminderSchedule = habit.reminderSchedule || {
      type: 'daily',
      hour: 22,
      minute: 0,
      timezone: 'UTC',
    };

    // Resolve the schedule's local time from the true instant. Done
    // unconditionally: a `schedule.timezone !== timezone` guard also skipped
    // conversion for equivalent-but-differently-spelled ids (Europe/Kiev vs
    // Europe/Kyiv), and made correctness depend on the caller pre-converting.
    const scheduleTimezone = schedule.timezone || timezone;
    const effectiveDate = toZonedDate(now, scheduleTimezone);
    const effectiveHour = effectiveDate.getHours();
    const effectiveMinute = effectiveDate.getMinutes();

    // Check time matches
    if (effectiveHour !== schedule.hour || effectiveMinute !== schedule.minute) {
      return false;
    }

    // Check date matches schedule type
    switch (schedule.type) {
      case 'daily':
        return true; // Time already matched

      case 'weekly':
        const dayOfWeek = effectiveDate.getDay(); // 0 = Sunday, 6 = Saturday
        return schedule.daysOfWeek.includes(dayOfWeek);

      case 'monthly':
        const dayOfMonth = effectiveDate.getDate(); // 1-31
        return schedule.daysOfMonth.includes(dayOfMonth);

      case 'interval':
        if (!schedule.startDate) {
          // If no start date, use habit creation date
          const habitCreated = new Date(habit.createdAt);
          schedule.startDate = habitCreated.toISOString().split('T')[0];
        }
        
        // Compare dates (YYYY-MM-DD strings) to avoid timezone issues
        const effectiveDateStr = effectiveDate.toISOString().split('T')[0];
        const startDateStr = schedule.startDate;
        
        // Parse dates and calculate difference in days
        const startDate = new Date(startDateStr + 'T00:00:00Z');
        const compareDate = new Date(effectiveDateStr + 'T00:00:00Z');
        const daysDiff = Math.floor((compareDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // Check if days difference is a multiple of interval
        return daysDiff >= 0 && daysDiff % schedule.intervalDays === 0;

      default:
        Logger.warn('Unknown schedule type', { habitId: habit.id, scheduleType: (schedule as any).type });
        return false;
    }
  }

  /**
   * Get a human-readable description of the schedule
   */
  getScheduleDescription(schedule: ReminderSchedule): string {
    const timeStr = `${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`;
    const tzStr = schedule.timezone ? ` ${schedule.timezone}` : ' UTC';

    switch (schedule.type) {
      case 'daily':
        return `Every day at ${timeStr}${tzStr}`;

      case 'weekly': {
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const days = schedule.daysOfWeek
          .sort((a, b) => a - b)
          .map(d => dayNames[d])
          .join(', ');
        return `Every ${days} at ${timeStr}${tzStr}`;
      }

      case 'monthly': {
        const days = schedule.daysOfMonth
          .sort((a, b) => a - b)
          .map(d => {
            const suffix = d === 1 || d === 21 || d === 31 ? 'st' :
                          d === 2 || d === 22 ? 'nd' :
                          d === 3 || d === 23 ? 'rd' : 'th';
            return `${d}${suffix}`;
          })
          .join(', ');
        return `Every ${days} of the month at ${timeStr}${tzStr}`;
      }

      case 'interval':
        return `Every ${schedule.intervalDays} day${schedule.intervalDays > 1 ? 's' : ''} at ${timeStr}${tzStr}`;

      default:
        return 'Unknown schedule';
    }
  }
}

