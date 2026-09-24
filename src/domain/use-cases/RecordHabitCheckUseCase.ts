import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit, SkippedDay, DroppedDay, CheckedDay, ReminderSchedule } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';
import { checkForNewBadges, awardBadges } from '../utils/HabitBadges';
import { localDay } from '../utils/postpone';

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

/** Returns YYYY-MM-DD for the day after the given date string. */
function dayAfter(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().split('T')[0];
}

/** The habit's creation calendar day (YYYY-MM-DD). */
function createdDay(habit: Habit): string {
  return new Date(habit.createdAt).toISOString().split('T')[0];
}

/**
 * Upper bound on how many missed days a single forward check will record, so a
 * comeback after a very long absence can't write an unbounded `dropped[]` array.
 * 366 covers any realistic gap; older misses simply stay unrecorded.
 */
const MAX_RECORDED_GAP_DAYS = 366;

/**
 * Silent-miss days to record as drops when a daily completion jumps forward over
 * untouched days (a plainly-missed day, or an ignored/auto-paused run): every day
 * strictly between `prevLastChecked` and `checkDate` that isn't already skipped or
 * dropped. Newest-first, capped at MAX_RECORDED_GAP_DAYS. Only the first missed day
 * — where the streak actually broke — carries `streakBeforeDrop`; the rest are 0.
 */
function gapDrops(
  prevLastChecked: string,
  checkDate: string,
  streakBeforeBreak: number,
  droppedSet: Set<string>,
  skippedSet: Set<string>,
): DroppedDay[] {
  const firstMissed = dayAfter(prevLastChecked);
  const out: DroppedDay[] = [];
  let cursor = dayBefore(checkDate); // newest missed day first
  while (cursor >= firstMissed && out.length < MAX_RECORDED_GAP_DAYS) {
    if (!droppedSet.has(cursor) && !skippedSet.has(cursor)) {
      out.push({ date: cursor, streakBeforeDrop: cursor === firstMissed ? streakBeforeBreak : 0 });
    }
    cursor = dayBefore(cursor);
  }
  return out;
}

/**
 * Recompute a daily habit's current streak: the run of completed days ending at
 * `endDate`. Walk backward — a dropped day breaks the run; a skipped day passes
 * through (preserves the streak without adding); every other day counts as a
 * completion. Reliable for a back-fill because Variant A records every interior
 * miss as a drop, so the first drop encountered is the true break. Caveat: the
 * creation→first-check gap is never recorded, so a run that reaches back to a
 * long-delayed first check over-counts those idle days.
 */
function recomputeDailyStreak(
  endDate: string,
  createdStr: string,
  droppedSet: Set<string>,
  skippedSet: Set<string>,
): number {
  if (!endDate) return 0;
  let streak = 0;
  let cursor = endDate;
  let guard = 0;
  while (cursor >= createdStr && guard++ < 100000) {
    if (droppedSet.has(cursor)) break;
    if (!skippedSet.has(cursor)) streak++;
    cursor = dayBefore(cursor);
  }
  return streak;
}

export class RecordHabitCheckUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  /**
   * The calendar day a check applies to. A reminder passes an explicit `targetDate`
   * (already computed as the user's local day). For a manual/MiniApp check with no
   * `targetDate`, "today" must be the user's LOCAL day — never server UTC: a UTC+N
   * user checking in their early morning (00:00–offset local) is UTC "yesterday", so
   * a UTC fallback misattributes the check and breaks the consecutive-day streak
   * comparison (`lastCheckedDate === dayBefore(checkDate)`). Falls back to UTC only
   * when the user has no stored timezone.
   */
  private async resolveCheckDate(userId: number, targetDate?: string): Promise<string> {
    if (targetDate) return targetDate;
    const prefs = await this.habitRepository.getUserPreferences(userId);
    return localDay(new Date(), prefs?.timezone || 'UTC');
  }

  /**
   * Records a habit check (complete or drop).
   * @param targetDate - Optional. The day this check applies to (e.g. reminder's target date). If omitted, uses server today.
   * @param note - Optional. Note for this drop (premium only); stored with the dropped entry.
   */
  async execute(userId: number, habitId: string, completed: boolean, username?: string, targetDate?: string, note?: string): Promise<Habit> {
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

    const checkDate = await this.resolveCheckDate(userId, targetDate);

    Logger.info('Recording habit check', {
      userId,
      username: username || 'unknown',
      habitId,
      completed,
      checkDate,
    });

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

    if (habit.imgIndex === undefined) {
      habit.imgIndex = 1;
    }

    let newStreak = habit.streak;
    const schedule = habit.reminderSchedule;
    const isDaily = !schedule || schedule.type === 'daily';

    if (completed && isDaily) {
      // ---- Variant A: daily completion ----
      const prevLastChecked = lastCheckedDate || '';
      const isForward = checkDate > prevLastChecked;

      // Completing a day means it is neither a silent miss nor a skip: un-mark it.
      let dropped = (habit.dropped || []).filter(d => d.date !== checkDate);
      const skipped = (habit.skipped || []).filter(s => s.date !== checkDate);

      if (isForward) {
        // A forward jump past untouched days = silent misses (an ignored/auto-paused
        // run): record them as drops so analytics shows them red, not inferred green.
        if (prevLastChecked) {
          const droppedSet = new Set(dropped.map(d => d.date));
          const skippedSet = new Set(skipped.map(s => s.date));
          dropped = [...dropped, ...gapDrops(prevLastChecked, checkDate, habit.streak, droppedSet, skippedSet)];
        }
        // Honest incremental streak (matches historical behavior): +1 only when the
        // previous check was exactly the day before; any gap resets to 1.
        if (!prevLastChecked) newStreak = 1;
        else if (prevLastChecked === dayBefore(checkDate)) newStreak = habit.streak + 1;
        else newStreak = 1;
      } else {
        // Back-fill of an earlier day: leave lastCheckedDate where it is (never move
        // backward) and recompute the run ending there — bridging any gap this fill
        // just closed. May raise or lower the streak; never awards badges.
        newStreak = recomputeDailyStreak(
          prevLastChecked,
          createdDay(habit),
          new Set(dropped.map(d => d.date)),
          new Set(skipped.map(s => s.date)),
        );
      }

      const newLastChecked = isForward ? checkDate : prevLastChecked;

      let updatedBadges = habit.badges || [];
      if (isForward) {
        const newBadgeTypes = checkForNewBadges(newStreak, updatedBadges);
        if (newBadgeTypes.length > 0) {
          updatedBadges = awardBadges(newBadgeTypes, updatedBadges);
          Logger.info('Badges awarded', {
            userId, username: username || 'unknown', habitId, habitName: habit.name,
            badgeTypes: newBadgeTypes, streak: newStreak,
          });
        }
      }

      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: newLastChecked,
        skipped,
        dropped,
        checked: habit.checked || [],
        badges: updatedBadges,
        imgIndex: habit.imgIndex,
        // Any response re-engages the habit: reset auto-pause miss tracking.
        missedReminderCount: 0,
        remindersPausedUntil: undefined,
      });
    } else if (completed) {
      // ---- non-daily completion: explicit checked[] dates, unchanged ----
      const previousScheduledDate = getPreviousScheduledDate(checkDate, schedule);
      if (!lastCheckedDate || lastCheckedDate === '') {
        newStreak = 1;
      } else if (lastCheckedDate === previousScheduledDate) {
        newStreak = habit.streak + 1;
      } else {
        newStreak = 1;
      }

      let updatedChecked = habit.checked || [];
      if (!updatedChecked.some(c => c.date === checkDate)) {
        updatedChecked = [...updatedChecked, { date: checkDate }];
      }

      let updatedBadges = habit.badges || [];
      const newBadgeTypes = checkForNewBadges(newStreak, updatedBadges);
      if (newBadgeTypes.length > 0) {
        updatedBadges = awardBadges(newBadgeTypes, updatedBadges);
        Logger.info('Badges awarded', {
          userId, username: username || 'unknown', habitId, habitName: habit.name,
          badgeTypes: newBadgeTypes, streak: newStreak,
        });
      }

      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: checkDate,
        skipped: habit.skipped || [],
        checked: updatedChecked,
        badges: updatedBadges,
        imgIndex: habit.imgIndex,
        missedReminderCount: 0,
        remindersPausedUntil: undefined,
      });
    } else {
      // ---- drop (explicit "No, I broke it") — unchanged ----
      newStreak = 0;

      const dropNote = typeof note === 'string' && note.trim().length > 0
        ? note.trim().slice(0, 500)
        : undefined;
      const updatedDropped = [...(habit.dropped || []), {
        streakBeforeDrop: habit.streak,
        date: checkDate,
        ...(dropNote && { note: dropNote }),
      }];

      await this.habitRepository.updateHabit(userId, habitId, {
        streak: newStreak,
        lastCheckedDate: checkDate,
        skipped: [],
        dropped: updatedDropped,
        badges: habit.badges || [],
        imgIndex: habit.imgIndex,
        // Any response re-engages the habit: reset auto-pause miss tracking.
        missedReminderCount: 0,
        remindersPausedUntil: undefined,
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
   * @param note - Optional. Note for this skip (premium only); stored with the skipped entry.
   */
  async skipHabit(userId: number, habitId: string, username?: string, targetDate?: string, note?: string): Promise<Habit> {
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

    const checkDate = await this.resolveCheckDate(userId, targetDate);

    Logger.info('Skipping habit', {
      userId,
      username: username || 'unknown',
      habitId,
      checkDate,
    });

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
    const skipNote = typeof note === 'string' && note.trim().length > 0
      ? note.trim().slice(0, 500)
      : undefined;
    const skippedDay: SkippedDay = {
      skippedDay: currentStreak,
      date: checkDate,
      ...(skipNote && { note: skipNote }),
    };

    const updatedSkipped = [...(habit.skipped || []), skippedDay];

    await this.habitRepository.updateHabit(userId, habitId, {
      skipped: updatedSkipped,
      lastCheckedDate: checkDate,
      // Any response re-engages the habit: reset auto-pause miss tracking.
      missedReminderCount: 0,
      remindersPausedUntil: undefined,
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

