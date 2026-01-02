export interface SkippedDay {
  skippedDay: number; // The streak day that was skipped
  date: string; // YYYY-MM-DD format
}

export interface DroppedDay {
  streakBeforeDrop: number; // The streak value before it was dropped
  date: string; // YYYY-MM-DD format
}

// Reminder schedule types
export type ReminderSchedule =
  | { type: 'daily'; hour: number; minute: number; timezone?: string } // Every day at specific time
  | { type: 'weekly'; daysOfWeek: number[]; hour: number; minute: number; timezone?: string } // Specific days of week (0=Sunday, 6=Saturday)
  | { type: 'monthly'; daysOfMonth: number[]; hour: number; minute: number; timezone?: string } // Specific days of month (1-31)
  | { type: 'interval'; intervalDays: number; hour: number; minute: number; timezone?: string; startDate?: string }; // Every N days

export interface Habit {
  id: string;
  userId: number;
  name: string;
  streak: number;
  createdAt: Date;
  lastCheckedDate: string; // YYYY-MM-DD format
  skipped: SkippedDay[]; // Array of skipped days
  dropped: DroppedDay[]; // Array of dropped days (when streak was reset to 0)
  reminderSchedule?: ReminderSchedule; // Reminder schedule configuration
  reminderEnabled?: boolean; // Whether reminders are enabled (default true)
  disabled?: boolean; // Whether the habit is disabled (default false)
}

export interface UserHabits {
  userId: number;
  habits: Habit[];
}

