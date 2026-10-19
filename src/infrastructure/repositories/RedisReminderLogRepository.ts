import { kv } from '../config/kv';
import { IReminderLogRepository } from '../../domain/repositories/IReminderLogRepository';
import { ReminderLogEntry, ReminderLogSentInput, ReminderResponse } from '../../domain/entities/ReminderLog';
import { Logger } from '../logger/Logger';
import { localDay } from '../../domain/utils/postpone';

/** Each day's hash expires this many days after its targetDate. */
export const REMINDER_LOG_RETENTION_DAYS = 90;

/**
 * One Redis hash per user-local day: `reminders:log:{YYYY-MM-DD}`, field
 * `{kind}:{userId}:{habitId}` → JSON ReminderLogEntry. Plus one Redis set per
 * user-local day, `reminders:active:{YYYY-MM-DD}` → user ids who tapped a
 * reminder message that day (the admin "active users" metric).
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

  private activeKey(day: string): string {
    return `reminders:active:${day}`;
  }

  async recordActiveUser(day: string, userId: number): Promise<void> {
    const key = this.activeKey(day);
    await kv.sAdd(key, String(userId));
    await kv.expireAt(key, this.expiryFor(day));
  }

  async getActiveUsers(day: string): Promise<number[]> {
    const members: string[] = await kv.sMembers(this.activeKey(day));
    return members.map(Number).filter(n => Number.isSafeInteger(n));
  }
}

/**
 * Mark a user active on their local "today" because they tapped a reminder
 * message (any button, or an action in the MiniApp opened from one). The day is
 * when they acted, not the reminder's targetDate. Never throws.
 */
export async function recordReminderClickBestEffort(
  reminderLog: IReminderLogRepository,
  userId: number,
  timezone: string | undefined,
  now: Date = new Date(),
): Promise<void> {
  try {
    let day: string;
    try {
      day = localDay(now, timezone || 'UTC');
    } catch {
      day = localDay(now, 'UTC'); // legacy ids Intl can't resolve (gotcha #2)
    }
    await reminderLog.recordActiveUser(day, userId);
  } catch (error) {
    Logger.warn('Failed to record active user', {
      userId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
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
