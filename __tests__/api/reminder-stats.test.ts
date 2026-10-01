import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('../../src/infrastructure/config/kv', () => ({ kv: {} }));

const mockGetDay = vi.fn();

vi.mock('../../src/infrastructure/repositories/RedisReminderLogRepository', () => ({
  RedisReminderLogRepository: vi.fn().mockImplementation(() => ({
    recordSent: vi.fn(),
    recordResponse: vi.fn(),
    getDay: mockGetDay,
  })),
}));

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn(),
}));

vi.mock('../../src/infrastructure/auth/validateTelegramInitData', () => ({
  validateTelegramInitData: vi.fn(),
  parseTelegramInitData: vi.fn(),
  isAuthDateValid: vi.fn(),
}));

import {
  validateTelegramInitData,
  parseTelegramInitData,
  isAuthDateValid,
} from '../../src/infrastructure/auth/validateTelegramInitData';

function createMockRes(): VercelResponse & { statusCode: number; body: any } {
  return {
    statusCode: 0,
    body: null,
    status: vi.fn().mockImplementation(function (this: any, code: number) { this.statusCode = code; return this; }),
    json: vi.fn().mockImplementation(function (this: any, data: unknown) { this.body = data; return this; }),
    setHeader: vi.fn(),
  } as unknown as VercelResponse & { statusCode: number; body: any };
}

const entry = (date: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'reminder', userId: 100, habitId: 'h1', habitName: 'Run', targetDate: date,
  sentAt: `${date}T20:00:00.000Z`, sends: 1, ...overrides,
});

async function call(query: Record<string, string>, body: Record<string, unknown> = { initData: 'x' }) {
  const handler = (await import('../../api/reminder-stats')).default;
  const res = createMockRes();
  await handler({ method: 'POST', query, body } as unknown as VercelRequest, res);
  return res;
}

describe('api/reminder-stats', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T12:00:00Z'));
    vi.mocked(validateTelegramInitData).mockReturnValue(true);
    vi.mocked(parseTelegramInitData).mockReturnValue({ user: { id: 12345 }, authDate: Math.floor(Date.now() / 1000) } as any);
    vi.mocked(isAuthDateValid).mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.ADMIN_USERS = '[12345]';
    mockGetDay.mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects non-admins', async () => {
    vi.mocked(parseTelegramInitData).mockReturnValue({ user: { id: 999 }, authDate: Math.floor(Date.now() / 1000) } as any);
    const res = await call({});
    expect(res.statusCode).toBe(403);
    expect(mockGetDay).not.toHaveBeenCalled();
  });

  it('requires initData', async () => {
    const res = await call({}, {});
    expect(res.statusCode).toBe(400);
  });

  it('validates days and date', async () => {
    expect((await call({ days: '0' })).statusCode).toBe(400);
    expect((await call({ days: '91' })).statusCode).toBe(400);
    expect((await call({ days: 'abc' })).statusCode).toBe(400);
    expect((await call({ date: '2026-02-30' })).statusCode).toBe(400);
  });

  it('returns N daily summaries newest first, ending today when UTC-tomorrow is empty', async () => {
    mockGetDay.mockImplementation(async (d: string) =>
      d === '2026-10-01' ? [entry(d, { response: 'complete' }), entry(d, { habitId: 'h2' })] : []);
    const res = await call({ days: '3' });
    expect(res.statusCode).toBe(200);
    expect(res.body.days.map((d: any) => d.date)).toEqual(['2026-10-01', '2026-09-30', '2026-09-29']);
    expect(res.body.days[0]).toMatchObject({ sent: 2, complete: 1, noAnswer: 1 });
  });

  it('includes UTC-tomorrow when users east of UTC already have reminders there', async () => {
    mockGetDay.mockImplementation(async (d: string) => (d === '2026-10-02' ? [entry(d)] : []));
    const res = await call({ days: '3' });
    expect(res.body.days.map((d: any) => d.date)).toEqual(['2026-10-02', '2026-10-01', '2026-09-30']);
  });

  it('returns one day\'s entries, pause notices after reminders', async () => {
    mockGetDay.mockResolvedValue([
      entry('2026-09-30', { kind: 'pause', username: 'aa' }),
      entry('2026-09-30', { username: 'bob', response: 'skip' }),
    ]);
    const res = await call({ date: '2026-09-30' });
    expect(res.statusCode).toBe(200);
    expect(mockGetDay).toHaveBeenCalledWith('2026-09-30');
    expect(res.body.entries.map((e: any) => e.kind)).toEqual(['pause', 'reminder']);
    expect(res.body.summary).toMatchObject({ sent: 1, skip: 1, paused: 1, users: 1 });
  });
});
