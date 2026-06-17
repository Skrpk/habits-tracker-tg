import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: { get: vi.fn(), setWithExpiry: vi.fn() },
}));

const mockSaveUserPreferences = vi.fn();
const mockGetUserPreferences = vi.fn();
const mockGetUserHabits = vi.fn();
const mockSaveUserHabits = vi.fn();

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    saveUserPreferences: mockSaveUserPreferences,
    getUserPreferences: mockGetUserPreferences,
    getUserHabits: mockGetUserHabits,
    saveUserHabits: mockSaveUserHabits,
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

describe('api/grant-lifetime-premium', () => {
  beforeEach(() => {
    vi.resetModules();
    mockSaveUserPreferences.mockClear();
    mockGetUserPreferences.mockClear();
    mockGetUserHabits.mockClear();
    mockSaveUserHabits.mockClear();
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({ user: { id: 12345 }, authDate: Math.floor(Date.now() / 1000) });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.ADMIN_USERS = '[12345]';
    mockSaveUserPreferences.mockResolvedValue(undefined);
    mockGetUserPreferences.mockResolvedValue(null);
    mockGetUserHabits.mockResolvedValue(null);
    mockSaveUserHabits.mockResolvedValue(undefined);
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = { method: 'GET', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it('returns 400 when grant is not boolean', async () => {
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = {
      method: 'POST',
      body: { initData: 'x', targetUserId: 100, grant: 'yes' },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect((res.body as { error?: string }).error).toBe('grant must be true or false');
  });

  it('returns 403 when caller is not admin', async () => {
    mockParse.mockReturnValue({ user: { id: 99999 }, authDate: Math.floor(Date.now() / 1000) });
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = {
      method: 'POST',
      body: { initData: 'x', targetUserId: 100, grant: true },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
  });

  it('grants lifetime premium for admin', async () => {
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', targetUserId: 777, grant: true },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockSaveUserPreferences).toHaveBeenCalledWith({
      userId: 777,
      isLifetimePremium: true,
      premium: true,
    });
    expect(res.body).toEqual({ ok: true, targetUserId: 777, grant: true });
  });

  it('revokes lifetime premium and clears premium when no active paid subscription', async () => {
    mockGetUserPreferences.mockResolvedValue({
      userId: 888,
      premium: true,
      isLifetimePremium: true,
    });
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', targetUserId: 888, grant: false },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockSaveUserPreferences).toHaveBeenNthCalledWith(1, {
      userId: 888,
      isLifetimePremium: false,
      premium: false,
    });
    expect(mockSaveUserPreferences).toHaveBeenNthCalledWith(2, {
      userId: 888,
      premium: false,
    });
  });

  it('revokes lifetime but keeps premium when paid subscription is still active', async () => {
    const recent = new Date();
    recent.setDate(recent.getDate() - 5);
    mockGetUserPreferences.mockResolvedValue({
      userId: 888,
      premium: true,
      premiumDate: recent.toISOString(),
      isLifetimePremium: true,
    });
    const handler = (await import('../../api/grant-lifetime-premium')).default;
    const req = {
      method: 'POST',
      body: { initData: 'signed', targetUserId: 888, grant: false },
    } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(mockSaveUserPreferences).toHaveBeenCalledTimes(1);
    expect(mockSaveUserPreferences).toHaveBeenCalledWith({
      userId: 888,
      isLifetimePremium: false,
    });
    expect(mockGetUserHabits).not.toHaveBeenCalled();
  });
});
