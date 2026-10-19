import { describe, it, expect, vi, beforeEach } from 'vitest';

const hashes = new Map<string, Map<string, unknown>>();
const sets = new Map<string, Set<string>>();
const expiries = new Map<string, number>();

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: {
    hGet: vi.fn(async (key: string, field: string) => hashes.get(key)?.get(field) ?? null),
    hSet: vi.fn(async (key: string, field: string, value: unknown) => {
      if (!hashes.has(key)) hashes.set(key, new Map());
      hashes.get(key)!.set(field, JSON.parse(JSON.stringify(value)));
    }),
    hGetAll: vi.fn(async (key: string) => Object.fromEntries(hashes.get(key) ?? new Map())),
    expireAt: vi.fn(async (key: string, ts: number) => { expiries.set(key, ts); }),
    sAdd: vi.fn(async (key: string, member: string) => {
      if (!sets.has(key)) sets.set(key, new Set());
      sets.get(key)!.add(member);
    }),
    sMembers: vi.fn(async (key: string) => [...(sets.get(key) ?? [])]),
  },
}));

vi.mock('../../src/infrastructure/logger/Logger', () => ({
  Logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  RedisReminderLogRepository,
  REMINDER_LOG_RETENTION_DAYS,
  logRemindersSentBestEffort,
  recordReminderClickBestEffort,
} from '../../src/infrastructure/repositories/RedisReminderLogRepository';

const base = { kind: 'reminder' as const, userId: 7, habitId: 'h1', habitName: 'Run', username: 'ann', targetDate: '2026-09-30' };

describe('RedisReminderLogRepository', () => {
  let repo: RedisReminderLogRepository;

  beforeEach(() => {
    hashes.clear();
    sets.clear();
    expiries.clear();
    repo = new RedisReminderLogRepository();
  });

  it('records a send in the targetDate hash and expires it after the retention window', async () => {
    await repo.recordSent(base, new Date('2026-09-30T20:00:00Z'));
    const [e] = await repo.getDay('2026-09-30');
    expect(e).toMatchObject({ ...base, sentAt: '2026-09-30T20:00:00.000Z', sends: 1 });
    expect(e.response).toBeUndefined();
    expect(expiries.get('reminders:log:2026-09-30'))
      .toBe(Date.parse('2026-09-30T00:00:00Z') / 1000 + (REMINDER_LOG_RETENTION_DAYS + 1) * 86400);
  });

  it('a same-day re-ask (Check later) bumps sends, keeping the first sentAt', async () => {
    await repo.recordSent(base, new Date('2026-09-30T20:00:00Z'));
    await repo.recordSent(base, new Date('2026-09-30T21:00:00Z'));
    const entries = await repo.getDay('2026-09-30');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ sends: 2, sentAt: '2026-09-30T20:00:00.000Z' });
  });

  it('attaches the answer to the sent reminder; the latest answer wins', async () => {
    await repo.recordSent(base);
    await repo.recordResponse('2026-09-30', 7, 'h1', 'drop', new Date('2026-09-30T20:05:00Z'));
    await repo.recordResponse('2026-09-30', 7, 'h1', 'complete', new Date('2026-10-01T08:00:00Z'));
    const [e] = await repo.getDay('2026-09-30');
    expect(e).toMatchObject({ response: 'complete', respondedAt: '2026-10-01T08:00:00.000Z' });
  });

  it('ignores an answer when no reminder was sent that day (proactive check)', async () => {
    await repo.recordResponse('2026-09-30', 7, 'h1', 'complete');
    expect(await repo.getDay('2026-09-30')).toEqual([]);
  });

  it('keeps pause notices separate from reminders, and answers never attach to them', async () => {
    await repo.recordSent({ ...base, kind: 'pause' });
    await repo.recordResponse('2026-09-30', 7, 'h1', 'complete');
    const entries = await repo.getDay('2026-09-30');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'pause' });
    expect(entries[0].response).toBeUndefined();
  });

  it('logRemindersSentBestEffort keeps going past a failing write', async () => {
    const failing = {
      recordSent: vi.fn().mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(undefined),
      recordResponse: vi.fn(),
      getDay: vi.fn(),
    };
    await expect(logRemindersSentBestEffort(failing, [base, { ...base, habitId: 'h2' }])).resolves.toBeUndefined();
    expect(failing.recordSent).toHaveBeenCalledTimes(2);
  });

  it('active users: one entry per user per day, with the same expiry', async () => {
    await repo.recordActiveUser('2026-10-19', 7);
    await repo.recordActiveUser('2026-10-19', 7);
    await repo.recordActiveUser('2026-10-19', 8);
    expect((await repo.getActiveUsers('2026-10-19')).sort()).toEqual([7, 8]);
    expect(await repo.getActiveUsers('2026-10-18')).toEqual([]);
    expect(expiries.get('reminders:active:2026-10-19'))
      .toBe(Date.parse('2026-10-19T00:00:00Z') / 1000 + (REMINDER_LOG_RETENTION_DAYS + 1) * 86400);
  });

  it('recordReminderClickBestEffort uses the user\'s local day of the action', async () => {
    // 22:30 UTC on the 18th is already the 19th in Kyiv (UTC+3).
    await recordReminderClickBestEffort(repo, 7, 'Europe/Kyiv', new Date('2026-10-18T22:30:00Z'));
    expect(await repo.getActiveUsers('2026-10-19')).toEqual([7]);
    expect(await repo.getActiveUsers('2026-10-18')).toEqual([]);
  });

  it('recordReminderClickBestEffort falls back to UTC for an unresolvable timezone and never throws', async () => {
    await recordReminderClickBestEffort(repo, 7, 'Pacific/Baker_Island', new Date('2026-10-18T22:30:00Z'));
    expect(await repo.getActiveUsers('2026-10-18')).toEqual([7]);
    const failing = { recordSent: vi.fn(), recordResponse: vi.fn(), getDay: vi.fn(), getActiveUsers: vi.fn(),
      recordActiveUser: vi.fn().mockRejectedValue(new Error('redis down')) };
    await expect(recordReminderClickBestEffort(failing, 7, 'UTC')).resolves.toBeUndefined();
  });
});
