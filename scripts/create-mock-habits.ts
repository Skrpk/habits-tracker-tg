/**
 * Script to generate mock habit data for testing analytics
 * Creates 3 habits with 1 month, 1 year, and 3 years of history
 * 
 * Usage:
 * 1. Run: npx ts-node scripts/create-mock-habits.ts
 * 2. Copy the output JSON
 * 3. Insert into Redis using: SET user:12345:habits '<json>'
 */

import { UserHabits, Habit, SkippedDay, DroppedDay } from '../src/domain/entities/Habit';

const today = new Date('2026-01-23');
today.setHours(0, 0, 0, 0);

// Helper to format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Helper to get random date between start and end
function randomDateBetween(start: Date, end: Date): Date {
  const startTime = start.getTime();
  const endTime = end.getTime();
  const randomTime = startTime + Math.random() * (endTime - startTime);
  return new Date(randomTime);
}

// ============================================
// HABIT 1: 1 Month History (30 days)
// ============================================
function createOneMonthHabit(): Habit {
  const createdAt = addDays(today, -30); // Created 30 days ago
  const lastCheckedDate = formatDate(addDays(today, -1)); // Last checked yesterday
  
  // Current streak: 5 days (last 5 days completed)
  const streak = 5;
  
  // Skipped days: 2 skips during the month
  const skipped: SkippedDay[] = [
    { skippedDay: 3, date: formatDate(addDays(today, -20)) }, // Skipped on day 3 of a streak
    { skippedDay: 8, date: formatDate(addDays(today, -12)) }, // Skipped on day 8 of a streak
  ];
  
  // Dropped days: 1 drop (streak was reset once)
  const dropped: DroppedDay[] = [
    { streakBeforeDrop: 7, date: formatDate(addDays(today, -18)) }, // Had 7 day streak, then dropped
  ];
  
  return {
    id: 'mock-1month-habit-001',
    userId: 12345,
    name: 'Morning Meditation',
    streak: streak,
    createdAt: createdAt,
    lastCheckedDate: lastCheckedDate,
    skipped: skipped,
    dropped: dropped,
    reminderSchedule: {
      type: 'daily',
      hour: 7,
      minute: 0,
      timezone: 'America/New_York',
    },
    reminderEnabled: true,
    disabled: false,
  };
}

// ============================================
// HABIT 2: 1 Year History (365 days)
// ============================================
function createOneYearHabit(): Habit {
  const createdAt = addDays(today, -365); // Created 1 year ago
  const lastCheckedDate = formatDate(addDays(today, -2)); // Last checked 2 days ago
  
  // Current streak: 12 days (good recent streak)
  const streak = 12;
  
  // Skipped days: 8 skips throughout the year
  const skipped: SkippedDay[] = [
    { skippedDay: 5, date: formatDate(addDays(today, -340)) },
    { skippedDay: 10, date: formatDate(addDays(today, -300)) },
    { skippedDay: 3, date: formatDate(addDays(today, -250)) },
    { skippedDay: 15, date: formatDate(addDays(today, -200)) },
    { skippedDay: 8, date: formatDate(addDays(today, -150)) },
    { skippedDay: 20, date: formatDate(addDays(today, -100)) },
    { skippedDay: 5, date: formatDate(addDays(today, -50)) },
    { skippedDay: 10, date: formatDate(addDays(today, -25)) },
  ];
  
  // Dropped days: 3 drops (streak was reset 3 times)
  const dropped: DroppedDay[] = [
    { streakBeforeDrop: 25, date: formatDate(addDays(today, -320)) }, // Had 25 day streak, then dropped
    { streakBeforeDrop: 18, date: formatDate(addDays(today, -180)) }, // Had 18 day streak, then dropped
    { streakBeforeDrop: 30, date: formatDate(addDays(today, -60)) },  // Had 30 day streak, then dropped
  ];
  
  return {
    id: 'mock-1year-habit-002',
    userId: 12345,
    name: 'Daily Exercise',
    streak: streak,
    createdAt: createdAt,
    lastCheckedDate: lastCheckedDate,
    skipped: skipped,
    dropped: dropped,
    reminderSchedule: {
      type: 'daily',
      hour: 18,
      minute: 30,
      timezone: 'America/New_York',
    },
    reminderEnabled: true,
    disabled: false,
  };
}

// ============================================
// HABIT 3: 3 Years History (1095 days)
// ============================================
function createThreeYearHabit(): Habit {
  const createdAt = addDays(today, -1095); // Created 3 years ago
  const lastCheckedDate = formatDate(addDays(today, -1)); // Last checked yesterday
  
  // Current streak: 45 days (excellent recent streak)
  const streak = 45;
  
  // Skipped days: 25 skips throughout 3 years
  const skipped: SkippedDay[] = [
    { skippedDay: 10, date: formatDate(addDays(today, -1000)) },
    { skippedDay: 5, date: formatDate(addDays(today, -950)) },
    { skippedDay: 15, date: formatDate(addDays(today, -900)) },
    { skippedDay: 8, date: formatDate(addDays(today, -850)) },
    { skippedDay: 20, date: formatDate(addDays(today, -800)) },
    { skippedDay: 12, date: formatDate(addDays(today, -750)) },
    { skippedDay: 7, date: formatDate(addDays(today, -700)) },
    { skippedDay: 18, date: formatDate(addDays(today, -650)) },
    { skippedDay: 9, date: formatDate(addDays(today, -600)) },
    { skippedDay: 25, date: formatDate(addDays(today, -550)) },
    { skippedDay: 11, date: formatDate(addDays(today, -500)) },
    { skippedDay: 6, date: formatDate(addDays(today, -450)) },
    { skippedDay: 14, date: formatDate(addDays(today, -400)) },
    { skippedDay: 19, date: formatDate(addDays(today, -350)) },
    { skippedDay: 8, date: formatDate(addDays(today, -300)) },
    { skippedDay: 22, date: formatDate(addDays(today, -250)) },
    { skippedDay: 13, date: formatDate(addDays(today, -200)) },
    { skippedDay: 7, date: formatDate(addDays(today, -150)) },
    { skippedDay: 16, date: formatDate(addDays(today, -100)) },
    { skippedDay: 10, date: formatDate(addDays(today, -75)) },
    { skippedDay: 5, date: formatDate(addDays(today, -60)) },
    { skippedDay: 30, date: formatDate(addDays(today, -50)) },
    { skippedDay: 12, date: formatDate(addDays(today, -35)) },
    { skippedDay: 8, date: formatDate(addDays(today, -20)) },
    { skippedDay: 40, date: formatDate(addDays(today, -10)) },
  ];
  
  // Dropped days: 7 drops (streak was reset 7 times over 3 years)
  const dropped: DroppedDay[] = [
    { streakBeforeDrop: 50, date: formatDate(addDays(today, -980)) },  // Had 50 day streak, then dropped
    { streakBeforeDrop: 35, date: formatDate(addDays(today, -850)) },  // Had 35 day streak, then dropped
    { streakBeforeDrop: 60, date: formatDate(addDays(today, -700)) },  // Had 60 day streak, then dropped
    { streakBeforeDrop: 28, date: formatDate(addDays(today, -550)) },  // Had 28 day streak, then dropped
    { streakBeforeDrop: 42, date: formatDate(addDays(today, -400)) },  // Had 42 day streak, then dropped
    { streakBeforeDrop: 55, date: formatDate(addDays(today, -250)) },  // Had 55 day streak, then dropped
    { streakBeforeDrop: 38, date: formatDate(addDays(today, -100)) }, // Had 38 day streak, then dropped
  ];
  
  return {
    id: 'mock-3year-habit-003',
    userId: 12345,
    name: 'Read 30 Minutes',
    streak: streak,
    createdAt: createdAt,
    lastCheckedDate: lastCheckedDate,
    skipped: skipped,
    dropped: dropped,
    reminderSchedule: {
      type: 'daily',
      hour: 21,
      minute: 0,
      timezone: 'America/New_York',
    },
    reminderEnabled: true,
    disabled: false,
  };
}

// ============================================
// Generate UserHabits object
// ============================================
function generateMockHabits(): UserHabits {
  return {
    userId: 12345,
    habits: [
      createOneMonthHabit(),
      createOneYearHabit(),
      createThreeYearHabit(),
    ],
  };
}

// ============================================
// Main execution
// ============================================
if (require.main === module) {
  const mockHabits = generateMockHabits();
  
  console.log('='.repeat(80));
  console.log('MOCK HABITS DATA FOR REDIS');
  console.log('='.repeat(80));
  console.log('\nRedis Key: user:12345:habits');
  console.log('\nRedis Value (JSON):\n');
  console.log(JSON.stringify(mockHabits, null, 2));
  console.log('\n' + '='.repeat(80));
  console.log('\nTo insert into Redis, use:');
  console.log(`SET user:12345:habits '${JSON.stringify(mockHabits)}'`);
  console.log('\nOr using Redis CLI:');
  console.log(`redis-cli SET user:12345:habits '${JSON.stringify(mockHabits).replace(/'/g, "\\'")}'`);
  console.log('\n' + '='.repeat(80));
  console.log('\nSummary:');
  console.log(`- Habit 1: ${mockHabits.habits[0].name} (${Math.floor((today.getTime() - new Date(mockHabits.habits[0].createdAt).getTime()) / (1000 * 60 * 60 * 24))} days old, streak: ${mockHabits.habits[0].streak})`);
  console.log(`- Habit 2: ${mockHabits.habits[1].name} (${Math.floor((today.getTime() - new Date(mockHabits.habits[1].createdAt).getTime()) / (1000 * 60 * 60 * 24))} days old, streak: ${mockHabits.habits[1].streak})`);
  console.log(`- Habit 3: ${mockHabits.habits[2].name} (${Math.floor((today.getTime() - new Date(mockHabits.habits[2].createdAt).getTime()) / (1000 * 60 * 60 * 24))} days old, streak: ${mockHabits.habits[2].streak})`);
  console.log('='.repeat(80));
}

export { generateMockHabits, createOneMonthHabit, createOneYearHabit, createThreeYearHabit };
