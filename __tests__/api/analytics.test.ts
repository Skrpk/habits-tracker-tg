import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockExecute = vi.fn();

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: { get: vi.fn(), setWithExpiry: vi.fn() },
}));

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    getUserHabits: vi.fn().mockImplementation(() => ({ habits: [] })),
    getUserPreferences: vi.fn().mockResolvedValue({ userId: 12345, premium: false }),
  })),
}));

vi.mock('../../src/domain/use-cases/GetUserHabitsUseCase', () => ({
  GetUserHabitsUseCase: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
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

describe('api/analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    mockExecute.mockResolvedValue([]);
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({ user: { id: 12345 }, authDate: Math.floor(Date.now() / 1000) });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'GET', query: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when initData is missing', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'initData is required' });
  });

  it('returns 401 when initData signature is invalid', async () => {
    mockValidate.mockReturnValue(false);
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: { initData: 'invalid-data' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid authentication' });
  });

  it('returns 401 when auth_date is expired', async () => {
    mockAuthDate.mockReturnValue(false);
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: { initData: 'valid-but-expired' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication expired' });
  });

  it('returns 401 when initData has no user', async () => {
    mockParse.mockReturnValue({ user: null, authDate: Math.floor(Date.now() / 1000) });
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: { initData: 'no-user' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid authentication: no user data' });
  });

  it('returns 200 with habits array when initData is valid', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: { initData: 'valid-init-data' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { habits?: unknown[] }).habits).toEqual([]);
    expect(mockExecute).toHaveBeenCalledWith(12345);
  });

  it('returns 500 when use case throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB error'));
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', body: { initData: 'valid-init-data' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { error?: string }).error).toBe('Internal server error');
    expect((res.body as { message?: string }).message).toBe('DB error');
  });
});
