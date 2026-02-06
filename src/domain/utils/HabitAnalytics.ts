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
  const shouldInferCompletions = remindersEnabled && notDisabled && hasUserInteraction;
  
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
  
  // Always rebuild history to match the stored streak value exactly
  // Process ALL days from creation to today, but only mark completions for the most recent streak period
  const targetStreak = habit.streak || 0;
  if (targetStreak > 0) {
    // First, identify which days should be marked as completed
    // Work backwards from today, marking only the most recent N days as completed
    // where N = habit.streak, excluding skipped/dropped days
    // Important: Drops reset the streak, so we only count completions after the most recent drop
    const completedDates = new Set<string>();
    let remainingCompletions = targetStreak;
    const workDate = new Date(today);
    
    // Find the most recent drop date (if any) - completions should only be after this
    let mostRecentDropDate: Date | null = null;
    const tempCheckDate = new Date(today);
    while (tempCheckDate >= creationDate) {
      const dateStr = tempCheckDate.toISOString().split('T')[0];
      if (droppedDates.has(dateStr)) {
        mostRecentDropDate = new Date(tempCheckDate);
        break;
      }
      tempCheckDate.setDate(tempCheckDate.getDate() - 1);
    }
    
    // Work backwards from today to find which days should be completed
    // Only count completions after the most recent drop (if any)
    while (workDate >= creationDate && remainingCompletions > 0) {
      const dateStr = workDate.toISOString().split('T')[0];
      
      // Stop if we've reached a drop (drops reset the streak)
      if (droppedDates.has(dateStr)) {
        break;
      }
      
      // Skip skipped days (they preserve streak but don't count as completions)
      if (skippedDates.has(dateStr)) {
        workDate.setDate(workDate.getDate() - 1);
        continue;
      }
      
      // Only count completions after the most recent drop
      if (mostRecentDropDate && workDate <= mostRecentDropDate) {
        break;
      }
      
      // For daily habits, all days are scheduled, so mark as completed
      completedDates.add(dateStr);
      remainingCompletions--;
      
      workDate.setDate(workDate.getDate() - 1);
    }
    
    // Also infer completions before drops based on streakBeforeDrop
    // Process drops in chronological order and infer completions before each drop
    const dropEntries = Array.from(droppedDates.entries())
      .map(([date, drop]) => ({ date, drop }))
      .sort((a, b) => a.date.localeCompare(b.date));
    
    for (const { date: dropDateStr, drop } of dropEntries) {
      if (drop.streakBeforeDrop && drop.streakBeforeDrop > 0) {
        // Work backwards from the drop date to infer completions
        const dropDate = new Date(dropDateStr);
        dropDate.setHours(0, 0, 0, 0);
        let preDropCompletions = drop.streakBeforeDrop;
        const preDropWorkDate = new Date(dropDate);
        preDropWorkDate.setDate(preDropWorkDate.getDate() - 1); // Day before the drop
        
        while (preDropWorkDate >= creationDate && preDropCompletions > 0) {
          const preDropDateStr = preDropWorkDate.toISOString().split('T')[0];
          
          // Stop if we hit another drop or skip
          if (droppedDates.has(preDropDateStr) || skippedDates.has(preDropDateStr)) {
            preDropWorkDate.setDate(preDropWorkDate.getDate() - 1);
            continue;
          }
          
          // For daily habits, all days are scheduled, so mark as completed
          completedDates.add(preDropDateStr);
          preDropCompletions--;
          
          preDropWorkDate.setDate(preDropWorkDate.getDate() - 1);
        }
      }
    }
    
    // Now process all days forward chronologically and build history
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
      } else if (completedDates.has(dateStr)) {
        // This day is part of a streak - mark as completed
        currentStreak++;
        adjustedHistory.push({
          date: dateStr,
          type: 'completed',
          streak: currentStreak,
        });
      }
      // For other days (not part of any streak), we don't add anything
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return adjustedHistory;
  }
  
  return history;
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
