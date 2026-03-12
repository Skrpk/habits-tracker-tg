import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

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

function createMockRes(): VercelResponse & { statusCode: number; body: unknown } {
  return {
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
  } as VercelResponse & { statusCode: number; body: unknown };
}

describe('api/auth', () => {
  beforeEach(() => {
    vi.resetModules();
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({
      user: { id: 42, first_name: 'Alice', username: 'alice' },
      authDate: Math.floor(Date.now() / 1000),
    });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'GET' } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when initData is missing', async () => {
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'POST', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'initData is required' });
  });

  it('returns 401 when initData signature is invalid', async () => {
    mockValidate.mockReturnValue(false);
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'POST', body: { initData: 'bad-signature' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid authentication' });
  });

  it('returns 401 when auth_date is expired', async () => {
    mockAuthDate.mockReturnValue(false);
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'POST', body: { initData: 'expired-data' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Authentication expired' });
  });

  it('returns 401 when initData has no user', async () => {
    mockParse.mockReturnValue({ user: null, authDate: Math.floor(Date.now() / 1000) });
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'POST', body: { initData: 'no-user' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid authentication: no user data' });
  });

  it('returns 200 with userId and user when initData is valid', async () => {
    const handler = (await import('../../api/auth')).default;
    const req = { method: 'POST', body: { initData: 'valid-init-data' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      ok: true,
      userId: 42,
      user: { id: 42, first_name: 'Alice', username: 'alice' },
    });
  });
});
