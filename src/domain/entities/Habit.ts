export interface Habit {
  id: string;
  userId: number;
  name: string;
  streak: number;
  createdAt: Date;
  lastCheckedDate: string; // YYYY-MM-DD format
}

export interface UserHabits {
  userId: number;
  habits: Habit[];
}

