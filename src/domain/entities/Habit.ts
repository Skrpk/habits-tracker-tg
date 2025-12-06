export interface SkippedDay {
  skippedDay: number; // The streak day that was skipped
  date: string; // YYYY-MM-DD format
}

export interface Habit {
  id: string;
  userId: number;
  name: string;
  streak: number;
  createdAt: Date;
  lastCheckedDate: string; // YYYY-MM-DD format
  skipped: SkippedDay[]; // Array of skipped days
}

export interface UserHabits {
  userId: number;
  habits: Habit[];
}

