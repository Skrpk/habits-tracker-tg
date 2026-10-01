import { ReminderLogEntry, ReminderLogSentInput, ReminderResponse } from '../entities/ReminderLog';

export interface IReminderLogRepository {
  /** Record a successful send; a same-day re-send of the same habit bumps `sends`. */
  recordSent(input: ReminderLogSentInput, sentAt?: Date): Promise<void>;
  /**
   * Attach an answer to the reminder sent for `targetDate`. No-op when no reminder
   * was sent that day — proactive checks are deliberately not counted.
   */
  recordResponse(targetDate: string, userId: number, habitId: string, response: ReminderResponse, at?: Date): Promise<void>;
  getDay(targetDate: string): Promise<ReminderLogEntry[]>;
}
