import { Habit, CheckHistoryEntry, SkippedDay, DroppedDay } from '../entities/Habit';

/**
 * Computes check history for a habit based on streak, creation date, skips, drops, and checked dates.
 * 
 * For daily habits:
 * - Infer completions from streak, skipped days, and dropped days
 * - Take start day, skipped days, and dropped days, and consider all days that are not among them as checked
 * 
 * For non-daily habits:
 * - Use the checked array to get explicit check dates
 * - Merge skipped, dropped, and checked dates (and start day) and analyze each check separately
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
  
  // Determine schedule type
  const schedule = habit.reminderSchedule;
  const isDaily = !schedule || schedule.type === 'daily';
  const remindersEnabled = habit.reminderEnabled !== false;
  const notDisabled = habit.disabled !== true;
  
  // For daily habits: use inference logic
  if (isDaily) {
    return computeDailyHabitHistory(habit, creationDate, today, skippedDates, droppedDates, remindersEnabled, notDisabled);
  }
  
  // For non-daily habits: use checked array
  return computeNonDailyHabitHistory(habit, creationDate, today, skippedDates, droppedDates);
}

/**
 * Computes check history for daily habits by inferring completions from streak, skipped, and dropped days.
 * Takes start day, skipped days, and dropped days, and considers all days that are not among them as checked.
 */
function computeDailyHabitHistory(
  habit: Habit,
  creationDate: Date,
  today: Date,
  skippedDates: Set<string>,
  droppedDates: Map<string, DroppedDay>,
  remindersEnabled: boolean,
  notDisabled: boolean
): CheckHistoryEntry[] {
  const history: CheckHistoryEntry[] = [];
  
  // Only infer completions if there's evidence of user interaction:
  // - streak > 0 (user has completed at least once), OR
  // - has skipped/dropped days (user has interacted with the habit)
  const hasUserInteraction = (habit.streak || 0) > 0 || skippedDates.size > 0 || droppedDates.size > 0;
  const shouldInferCompletions = remindersEnabled && notDisabled;
  
  // If we shouldn't infer completions, only return explicit events (skips/drops)
  if (!shouldInferCompletions) {
    const currentDate = new Date(creationDate);
    while (currentDate <= today) {
      const dateStr = currentDate.toISOString().split('T')[0];
      
      if (droppedDates.has(dateStr)) {
        const drop = droppedDates.get(dateStr)!;
        history.push({
          date: dateStr,
          type: 'dropped',
          streak: 0,
          streakBefore: drop.streakBeforeDrop,
        });
      } else if (skippedDates.has(dateStr)) {
        history.push({
          date: dateStr,
          type: 'skipped',
          streak: 0,
        });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    return history;
  }
  
  // For daily habits: all days from creation to today are considered completed
  // unless they are in the skipped or dropped list
  // Process all days chronologically and build history
  const adjustedHistory: CheckHistoryEntry[] = [];
  let currentStreak = 0;
  const currentDate = new Date(creationDate);
  
  while (currentDate <= today) {
    const dateStr = currentDate.toISOString().split('T')[0];
    
    if (droppedDates.has(dateStr)) {
      // Drop: reset streak to 0
      const drop = droppedDates.get(dateStr)!;
      adjustedHistory.push({
        date: dateStr,
        type: 'dropped',
        streak: 0,
        streakBefore: drop.streakBeforeDrop,
      });
      currentStreak = 0;
    } else if (skippedDates.has(dateStr)) {
      // Skip: preserve streak (don't increment)
      adjustedHistory.push({
        date: dateStr,
        type: 'skipped',
        streak: currentStreak,
      });
      // Streak remains the same
    } else {
      // All other days are considered completed
      currentStreak++;
      adjustedHistory.push({
        date: dateStr,
        type: 'completed',
        streak: currentStreak,
      });
    }
    
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return adjustedHistory;
}

/**
 * Computes check history for non-daily habits using the checked array.
 * Merges skipped, dropped, and checked dates (and start day) and analyzes each check separately.
 */
function computeNonDailyHabitHistory(
  habit: Habit,
  creationDate: Date,
  today: Date,
  skippedDates: Set<string>,
  droppedDates: Map<string, DroppedDay>
): CheckHistoryEntry[] {
  const history: CheckHistoryEntry[] = [];
  
  // Get all checked dates from the checked array
  const checkedDates = new Set((habit.checked || []).map(c => c.date));
  
  // Collect all event dates: checked, skipped, dropped, and creation date
  const allEventDates = new Set<string>();
  checkedDates.forEach(date => allEventDates.add(date));
  skippedDates.forEach(date => allEventDates.add(date));
  droppedDates.forEach((_, date) => allEventDates.add(date));
  
  // Add creation date as the start day
  const creationDateStr = creationDate.toISOString().split('T')[0];
  allEventDates.add(creationDateStr);
  
  // Sort all dates chronologically
  const sortedDates = Array.from(allEventDates).sort((a, b) => a.localeCompare(b));
  
  // Process each date chronologically and build history
  let currentStreak = 0;
  
  for (const dateStr of sortedDates) {
    // Skip dates after today
    if (dateStr > today.toISOString().split('T')[0]) {
      continue;
    }
    
    // Skip dates before creation
    if (dateStr < creationDateStr) {
      continue;
    }
    
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
    } else if (checkedDates.has(dateStr)) {
      // Checked: increment streak
      currentStreak++;
      history.push({
        date: dateStr,
        type: 'completed',
        streak: currentStreak,
      });
    } else if (dateStr === creationDateStr) {
      // Creation date: only add if it's also checked, skipped, or dropped
      // Otherwise, we don't add it to history
    }
  }
  
  return history;
}
