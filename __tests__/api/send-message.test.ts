import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: { get: vi.fn(), setWithExpiry: vi.fn() },
}));

const mockGetAllActiveUserIds = vi.fn();
const mockGetUserPreferences = vi.fn();
const mockGetUserHabits = vi.fn();

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    getAllActiveUserIds: mockGetAllActiveUserIds,
    getUserPreferences: mockGetUserPreferences,
    getUserHabits: mockGetUserHabits,
  })),
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

const mockValidate = vi.mocked(validateTelegramInitData);
const mockParse = vi.mocked(parseTelegramInitData);
const mockAuthDate = vi.mocked(isAuthDateValid);

const mockFetch = vi.fn();

function createMockRes(): VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  return {
    statusCode: 0,
    body: null as unknown,
    headers,
    status: vi.fn().mockImplementation(function (this: typeof res, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: typeof res, data: unknown) {
      this.body = data;
      return this;
    }),
    setHeader: vi.fn().mockImplementation(function (this: typeof res, name: string, value: string) {
      this.headers[name] = value;
      return this;
    }),
  } as VercelResponse & { statusCode: number; body: unknown; headers: Record<string, string> };
}

describe('api/send-message', () => {
  beforeEach(() => {
    vi.resetModules();
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({ user: { id: 12345 }, authDate: Math.floor(Date.now() / 1000) });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.ADMIN_USERS = '[12345]';

    mockFetch.mockReset();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    });
    global.fetch = mockFetch as unknown as typeof fetch;

    mockGetAllActiveUserIds.mockResolvedValue([100]);
    mockGetUserPreferences.mockResolvedValue({
      userId: 100,
      timezone: 'Europe/London',
      premium: false,
      blocked: false,
    });
    mockGetUserHabits.mockResolvedValue({ habits: [] });
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/send-message')).default;
    const req = { method: 'GET', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when message is missing or empty', async () => {
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'x', message: '   ' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'message is required' });
  });

  it('returns 401 when initData is invalid', async () => {
    mockValidate.mockReturnValue(false);
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'bad', message: 'Hello' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
  });

  it('returns 403 when user is not in ADMIN_USERS', async () => {
    mockParse.mockReturnValue({ user: { id: 99999 }, authDate: Math.floor(Date.now() / 1000) });
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'x', message: 'Hello' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 404 for individual send when user id is not active', async () => {
    mockGetAllActiveUserIds.mockResolvedValue([200]);
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', message: 'Hi', id: 100 },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: 'User not found' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('sends individual message and returns sent count', async () => {
    mockGetAllActiveUserIds.mockResolvedValue([100]);
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', message: 'Hello', id: 100 },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ sent: 1, failed: 0 });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('api.telegram.org');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body as string)).toMatchObject({
      chat_id: 100,
      text: 'Hello',
    });
  });

  it('sends group messages to all filtered users in batches', async () => {
    mockGetAllActiveUserIds.mockResolvedValue([1, 2]);
    mockGetUserPreferences.mockImplementation(async (uid: number) => ({
      userId: uid,
      timezone: 'Europe/London',
      premium: false,
      blocked: false,
    }));
    const handler = (await import('../../api/send-message')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', message: 'Broadcast' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { sent: number; failed: number };
    expect(body.sent).toBe(2);
    expect(body.failed).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
