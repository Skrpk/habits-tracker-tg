import { IHabitRepository } from '../repositories/IHabitRepository';
import { Habit } from '../entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';

/**
 * Sets/clears the transient `postponedUntil` flag used by the "Check later
 * (in 1 hour)" feature. The reminder cron re-asks a habit whose postpone is due
 * (see GetHabitsDueForReminderUseCase) and the send path clears it afterwards.
 */
export class PostponeHabitReminderUseCase {
  constructor(private habitRepository: IHabitRepository) {}

  /** Look up a single habit for the user, or null if not found. */
  async getHabit(userId: number, habitId: string): Promise<Habit | null> {
    const userHabits = await this.habitRepository.getUserHabits(userId);
    return userHabits?.habits.find(h => h.id === habitId) ?? null;
  }

  /** Postpone the reminder to `target` (stored as an ISO-8601 UTC instant). */
  async setPostpone(userId: number, habitId: string, target: Date): Promise<void> {
    await this.habitRepository.updateHabit(userId, habitId, {
      postponedUntil: target.toISOString(),
    });
    Logger.info('Habit reminder postponed', {
      userId,
      habitId,
      postponedUntil: target.toISOString(),
    });
  }

  /** Clear any pending postpone (no-op if none set). */
  async clearPostpone(userId: number, habitId: string): Promise<void> {
    await this.habitRepository.updateHabit(userId, habitId, {
      postponedUntil: undefined,
    });
  }
}
