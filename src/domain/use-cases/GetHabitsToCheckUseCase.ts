import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';

export class GetHabitsToCheckUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number): Promise<Habit[]> {
    const userHabits = await this.habitRepository.getUserHabits(userId);
    if (!userHabits) {
      return [];
    }

    const today = new Date().toISOString().split('T')[0];
    
    // Return habits that haven't been checked today
    return userHabits.habits.filter(habit => habit.lastCheckedDate !== today);
  }
}

