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
  // Only infer completions if there's evidence of user interaction:
  // - streak > 0 (user has completed at least once), OR
  // - has skipped/dropped days (user has interacted with the habit)
  const hasUserInteraction = (habit.streak || 0) > 0 || skippedDates.size > 0 || droppedDates.size > 0;
  const shouldInferCompletions = remindersEnabled && notDisabled && hasUserInteraction;
  
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
  
  // Always rebuild history to match the stored streak value exactly
  // Process ALL days from creation to today, but only mark completions for the most recent streak period
  const targetStreak = habit.streak || 0;
  if (targetStreak > 0) {
    // First, identify which scheduled days should be marked as completed
    // Work backwards from today, marking only the most recent N scheduled days as completed
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
      
      // If this is a scheduled day, mark it as completed
      if (isScheduledDay(workDate)) {
        completedDates.add(dateStr);
        remainingCompletions--;
      }
      
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
          
          // If this is a scheduled day, mark it as completed
          if (isScheduledDay(preDropWorkDate)) {
            completedDates.add(preDropDateStr);
            preDropCompletions--;
          }
          
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
      // For other days (not scheduled, or not part of any streak), we don't add anything
      
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    return adjustedHistory;
  }
  
  return history;
}
