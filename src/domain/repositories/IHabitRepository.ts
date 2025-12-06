import { Habit, UserHabits } from '../entities/Habit';

export interface IHabitRepository {
  getUserHabits(userId: number): Promise<UserHabits | null>;
  saveUserHabits(userHabits: UserHabits): Promise<void>;
  createHabit(userId: number, habitName: string): Promise<Habit>;
  updateHabit(userId: number, habitId: string, updates: Partial<Habit>): Promise<void>;
  deleteHabit(userId: number, habitId: string): Promise<void>;
  getAllActiveUserIds(): Promise<number[]>;
  addActiveUser(userId: number): Promise<void>;
  removeActiveUser(userId: number): Promise<void>;
}

