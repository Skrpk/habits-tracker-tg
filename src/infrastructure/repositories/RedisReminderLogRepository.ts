import { kv } from '../config/kv';
import { IReminderLogRepository } from '../../domain/repositories/IReminderLogRepository';
import { ReminderLogEntry, ReminderLogSentInput, ReminderResponse } from '../../domain/entities/ReminderLog';
import { Logger } from '../logger/Logger';

/** Each day's hash expires this many days after its targetDate. */
export const REMINDER_LOG_RETENTION_DAYS = 90;

/**
 * One Redis hash per user-local day: `reminders:log:{YYYY-MM-DD}`, field
 * `{kind}:{userId}:{habitId}` → JSON ReminderLogEntry.
 */
export class RedisReminderLogRepository implements IReminderLogRepository {
  private dayKey(targetDate: string): string {
    return `reminders:log:${targetDate}`;
  }

  private field(kind: string, userId: number, habitId: string): string {
    return `${kind}:${userId}:${habitId}`;
  }

  private expiryFor(targetDate: string): number {
    const dayStart = Date.parse(`${targetDate}T00:00:00Z`) / 1000;
    return dayStart + (REMINDER_LOG_RETENTION_DAYS + 1) * 86400;
  }

  async recordSent(input: ReminderLogSentInput, sentAt: Date = new Date()): Promise<void> {
    const key = this.dayKey(input.targetDate);
    const field = this.field(input.kind, input.userId, input.habitId);
    const existing = await kv.hGet(key, field) as ReminderLogEntry | null;

    const entry: ReminderLogEntry = existing
      ? { ...existing, habitName: input.habitName, sends: (existing.sends || 1) + 1 }
      : {
          kind: input.kind,
          userId: input.userId,
          habitId: input.habitId,
          habitName: input.habitName,
          ...(input.username && { username: input.username }),
          targetDate: input.targetDate,
          sentAt: sentAt.toISOString(),
          sends: 1,
        };

    await kv.hSet(key, field, entry);
    await kv.expireAt(key, this.expiryFor(input.targetDate));
  }

  async recordResponse(
    targetDate: string,
    userId: number,
    habitId: string,
    response: ReminderResponse,
    at: Date = new Date(),
  ): Promise<void> {
    const key = this.dayKey(targetDate);
    const field = this.field('reminder', userId, habitId);
    const existing = await kv.hGet(key, field) as ReminderLogEntry | null;
    if (!existing) return; // no reminder sent that day → proactive check, not counted

    await kv.hSet(key, field, { ...existing, response, respondedAt: at.toISOString() });
  }

  async getDay(targetDate: string): Promise<ReminderLogEntry[]> {
    const all = await kv.hGetAll(this.dayKey(targetDate)) as Record<string, ReminderLogEntry>;
    return Object.values(all);
  }
}

/**
 * Cron helper: log a batch of sends without ever failing the cron — reminder
 * stats are observability, not delivery.
 */
export async function logRemindersSentBestEffort(
  reminderLog: IReminderLogRepository,
  inputs: ReminderLogSentInput[],
): Promise<void> {
  for (const input of inputs) {
    try {
      await reminderLog.recordSent(input);
    } catch (error) {
      Logger.warn('Failed to log reminder send', {
        userId: input.userId,
        habitId: input.habitId,
        kind: input.kind,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
