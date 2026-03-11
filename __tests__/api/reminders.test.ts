import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockSendHabitReminders = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    getAllActiveUserIds: vi.fn().mockResolvedValue([]),
    getUserHabits: vi.fn().mockResolvedValue(null),
    getUserPreferences: vi.fn().mockResolvedValue({ timezone: 'UTC', blocked: false }),
  })),
}));

vi.mock('../../src/presentation/telegram/TelegramBot', () => ({
  TelegramBotService: vi.fn().mockImplementation(() => ({
    sendHabitReminders: mockSendHabitReminders,
    setupHandlers: vi.fn(),
  })),
}));

function createMockRes(): VercelResponse & { statusCode: number; body: unknown } {
  const res = {
    statusCode: 0,
    body: null as unknown,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this.body = data;
      return this;
    }),
    setHeader: vi.fn(),
  };
  res.status = res.status.bind(res);
  res.json = res.json.bind(res);
  return res as VercelResponse & { statusCode: number; body: unknown };
}

describe('api/reminders', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.CRON_API_SECRET = 'test-cron-secret';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 401 when Authorization header is missing', async () => {
    const handler = (await import('../../api/reminders')).default;
    const req = {
      method: 'POST',
      headers: {},
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const handler = (await import('../../api/reminders')).default;
    const req = {
      method: 'POST',
      headers: { authorization: 'Basic xyz' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 401 when Bearer token does not match CRON_API_SECRET', async () => {
    const handler = (await import('../../api/reminders')).default;
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer wrong-token' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });

  it('returns 500 when CRON_API_SECRET is not configured', async () => {
    delete process.env.CRON_API_SECRET;
    const handler = (await import('../../api/reminders')).default;
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { error?: string }).error).toBe('Server configuration error');
  });

  it('returns 200 with correct body when authorized and no habits due', async () => {
    const handler = (await import('../../api/reminders')).default;
    const req = {
      method: 'POST',
      headers: { authorization: 'Bearer test-cron-secret' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      message: 'Reminders processed',
      totalHabitsDue: 0,
      totalUsers: 0,
      successCount: 0,
      errorCount: 0,
    });
    expect((res.body as { skippedBlocked?: number }).skippedBlocked).toBeDefined();
  });
});
