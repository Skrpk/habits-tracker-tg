import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockProcessUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../src/presentation/telegram/TelegramBot', () => ({
  TelegramBotService: vi.fn().mockImplementation(() => ({
    processUpdate: mockProcessUpdate,
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
  };
  res.status = res.status.bind(res);
  res.json = res.json.bind(res);
  return res as VercelResponse & { statusCode: number; body: unknown };
}

describe('api/webhook', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockProcessUpdate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/webhook')).default;
    const req = { method: 'GET', body: {}, headers: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 401 when WEBHOOK_SECRET_TOKEN is set and header does not match', async () => {
    process.env.WEBHOOK_SECRET_TOKEN = 'secret123';
    const handler = (await import('../../api/webhook')).default;
    const req = {
      method: 'POST',
      body: { update_id: 1 },
      headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
    expect(mockProcessUpdate).not.toHaveBeenCalled();
  });

  it('returns 200 and processes update when secret matches', async () => {
    process.env.WEBHOOK_SECRET_TOKEN = 'secret123';
    const handler = (await import('../../api/webhook')).default;
    const update = { update_id: 1, message: { text: '/start', chat: { id: 1 }, from: { id: 1 } } };
    const req = {
      method: 'POST',
      body: update,
      headers: { 'x-telegram-bot-api-secret-token': 'secret123' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
  });

  it('returns 200 and processes update when WEBHOOK_SECRET_TOKEN is not set', async () => {
    delete process.env.WEBHOOK_SECRET_TOKEN;
    const handler = (await import('../../api/webhook')).default;
    const update = { update_id: 2 };
    const req = {
      method: 'POST',
      body: update,
      headers: {},
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(mockProcessUpdate).toHaveBeenCalledWith(update);
  });

  it('returns 500 when processUpdate throws', async () => {
    mockProcessUpdate.mockRejectedValueOnce(new Error('Bot error'));
    const handler = (await import('../../api/webhook')).default;
    const req = {
      method: 'POST',
      body: { update_id: 3 },
      headers: {},
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { error?: string }).error).toBe('Internal server error');
    expect((res.body as { message?: string }).message).toBe('Bot error');
  });
});
