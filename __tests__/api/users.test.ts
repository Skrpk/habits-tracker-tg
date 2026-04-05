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

describe('api/users', () => {
  beforeEach(() => {
    vi.resetModules();
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({ user: { id: 12345 }, authDate: Math.floor(Date.now() / 1000) });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.ADMIN_USERS = '[12345]';

    mockGetAllActiveUserIds.mockResolvedValue([100]);
    mockGetUserPreferences.mockResolvedValue({
      userId: 100,
      timezone: 'Europe/London',
      premium: true,
      blocked: false,
    });
    mockGetUserHabits.mockResolvedValue({
      habits: [
        {
          id: 'h1',
          userId: 100,
          name: 'Run',
          streak: 2,
          createdAt: new Date('2025-01-01'),
          lastCheckedDate: '2025-03-01',
          skipped: [],
          dropped: [],
          checked: [],
        },
      ],
    });
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/users')).default;
    const req = { method: 'GET', query: {}, body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when initData is missing', async () => {
    const handler = (await import('../../api/users')).default;
    const req = { method: 'POST', query: {}, body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'initData is required' });
  });

  it('returns 401 when initData is invalid', async () => {
    mockValidate.mockReturnValue(false);
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: {},
      body: { initData: 'bad' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect((res.body as { error?: string }).error).toBeDefined();
  });

  it('returns 403 when user is not in ADMIN_USERS', async () => {
    mockParse.mockReturnValue({ user: { id: 99999 }, authDate: Math.floor(Date.now() / 1000) });
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: {},
      body: { initData: 'valid-looking' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });

  it('returns 400 when Timezone filter is not allowed', async () => {
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { Timezone: 'Invalid/Zone' },
      body: { initData: 'x' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid Timezone filter' });
  });

  it('returns 200 with users for admin', async () => {
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: {},
      body: { initData: 'signed' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { users: Array<{ userId: number; habits: unknown[] }> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0].userId).toBe(100);
    expect(body.users[0].habits).toHaveLength(1);
  });

  it('filters by premium when isAdmin=false', async () => {
    mockGetUserPreferences.mockResolvedValue({
      userId: 100,
      timezone: 'Europe/London',
      premium: true,
    });
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { isAdmin: 'false' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { users: unknown[] };
    expect(body.users).toHaveLength(0);
  });

  it('returns 400 when userId filter is not numeric', async () => {
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { userId: 'abc' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid userId filter' });
  });

  it('returns 400 when consentDateFrom is invalid', async () => {
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { consentDateFrom: '2025-13-40' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid consentDateFrom' });
  });

  it('returns 400 when consentDateFrom is after consentDateTo', async () => {
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { consentDateFrom: '2025-06-01', consentDateTo: '2025-01-01' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'consentDateFrom must be <= consentDateTo' });
  });

  it('filters to single userId when provided', async () => {
    mockGetAllActiveUserIds.mockResolvedValue([100, 200]);
    mockGetUserPreferences.mockImplementation(async (uid: number) => ({
      userId: uid,
      timezone: 'Europe/London',
      premium: false,
      blocked: false,
    }));
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { userId: '200' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { users: Array<{ userId: number }> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0].userId).toBe(200);
  });

  it('filters by consent date range inclusive', async () => {
    mockGetAllActiveUserIds.mockResolvedValue([100, 200]);
    mockGetUserPreferences.mockImplementation(async (uid: number) => {
      if (uid === 100) {
        return {
          userId: 100,
          timezone: 'Europe/London',
          consentAccepted: true,
          consentDate: '2025-03-15',
        };
      }
      return {
        userId: 200,
        timezone: 'Europe/London',
        consentAccepted: true,
        consentDate: '2025-08-01',
      };
    });
    const handler = (await import('../../api/users')).default;
    const req = {
      method: 'POST',
      query: { consentDateFrom: '2025-03-01', consentDateTo: '2025-04-01' },
      body: { initData: 'signed' },
    } as unknown as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = res.body as { users: Array<{ userId: number }> };
    expect(body.users).toHaveLength(1);
    expect(body.users[0].userId).toBe(100);
  });
});
