import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';

export class GetUserHabitsUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  async execute(userId: number): Promise<Habit[]> {
    const userHabits = await this.habitRepository.getUserHabits(userId);
    return userHabits?.habits || [];
  }
}

