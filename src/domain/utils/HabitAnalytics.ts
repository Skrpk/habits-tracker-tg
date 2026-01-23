import { Habit, CheckHistoryEntry, SkippedDay, DroppedDay } from '../entities/Habit';

/**
 * Computes check history for a habit based on streak, creation date, skips, and drops.
 * This allows us to infer completion dates without storing every single check.
 * 
 * Logic (forward chronological):
 * - Work forward from creation date to today
 * - For daily habits (with reminders enabled and not disabled): 
 *   - If a day is not skipped, dropped, or disabled, infer it as completed
 * - Track streak incrementally:
 *   - Completed days: increment streak
 *   - Skipped days: preserve streak (no change)
 *   - Dropped days: reset streak to 0
 * - For non-daily schedules: only infer completions on scheduled days
 */
export function computeCheckHistory(habit: Habit): CheckHistoryEntry[] {
  const history: CheckHistoryEntry[] = [];
  
  if (!habit.createdAt) {
    return history;
  }

  const creationDate = new Date(habit.createdAt);
  creationDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Create lookup structures
  const skippedDates = new Set((habit.skipped || []).map(s => s.date));
  const droppedDates = new Map<string, DroppedDay>();
  (habit.dropped || []).forEach(d => {
    droppedDates.set(d.date, d);
  });
  
  // Determine if we should infer completions and which days are scheduled
  const schedule = habit.reminderSchedule;
  const remindersEnabled = habit.reminderEnabled !== false;
  const notDisabled = habit.disabled !== true;
  const shouldInferCompletions = remindersEnabled && notDisabled;
  
  // Helper to check if a date is a scheduled day
  function isScheduledDay(date: Date): boolean {
    if (!schedule || !shouldInferCompletions) return false;
    
    const dayOfWeek = date.getDay(); // 0=Sunday, 1=Monday, ..., 6=Saturday
    
    switch (schedule.type) {
      case 'daily':
        return true;
      case 'weekly':
        return schedule.daysOfWeek.includes(dayOfWeek);
      case 'monthly':
        const dayOfMonth = date.getDate();
        return schedule.daysOfMonth.includes(dayOfMonth);
      case 'interval':
        // For interval schedules, calculate from startDate or creationDate
        const intervalStartDate = schedule.startDate 
          ? new Date(schedule.startDate)
          : creationDate;
        intervalStartDate.setHours(0, 0, 0, 0);
        
        // Calculate days difference
        const daysDiff = Math.floor((date.getTime() - intervalStartDate.getTime()) / (1000 * 60 * 60 * 24));
        
        // Check if this date is exactly N days from the start (where N is a multiple of intervalDays)
        return daysDiff >= 0 && daysDiff % schedule.intervalDays === 0;
      default:
        return false;
    }
  }
  
  // Current streak value as we process forward
  let currentStreak = 0;
  
  // Process each day forward from creation to today
  const currentDate = new Date(creationDate);
  
  while (currentDate <= today) {
    const dateStr = currentDate.toISOString().split('T')[0];
    
    // Check if this date has an explicit event
    if (droppedDates.has(dateStr)) {
      // Drop: reset streak to 0
      const drop = droppedDates.get(dateStr)!;
      history.push({
        date: dateStr,
        type: 'dropped',
        streak: 0,
        streakBefore: drop.streakBeforeDrop,
      });
      currentStreak = 0;
    } else if (skippedDates.has(dateStr)) {
      // Skip: preserve streak (don't increment)
      history.push({
        date: dateStr,
        type: 'skipped',
        streak: currentStreak,
      });
      // Streak remains the same
    } else if (isScheduledDay(currentDate)) {
      // Scheduled day: infer as completed if not skipped/dropped/disabled
      currentStreak++;
      history.push({
        date: dateStr,
        type: 'completed',
        streak: currentStreak,
      });
    }
    // For unscheduled days, we don't infer completions
    
    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  // Verify final streak matches expected
  // If it doesn't, there might be an issue with the data, but we'll trust the stored streak
  // The computed history should match the stored streak at the end
  
  return history;
}
