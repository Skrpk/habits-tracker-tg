import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockKvGet = vi.fn();
const mockKvSetWithExpiry = vi.fn();
const mockGetUserPreferences = vi.fn();
const mockGetUserHabits = vi.fn();
const mockChatCompletionsCreate = vi.fn();

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: {
    get: (...args: unknown[]) => mockKvGet(...args),
    setWithExpiry: (...args: unknown[]) => mockKvSetWithExpiry(...args),
  },
}));

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    getUserPreferences: mockGetUserPreferences,
    getUserHabits: mockGetUserHabits,
  })),
}));

vi.mock('../../src/infrastructure/auth/validateTelegramInitData', () => ({
  validateTelegramInitData: vi.fn(),
  parseTelegramInitData: vi.fn(),
  isAuthDateValid: vi.fn(),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockChatCompletionsCreate,
      },
    },
  })),
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

describe('api/analytics-insights', () => {
  const userId = 12345;

  beforeEach(() => {
    vi.clearAllMocks();
    mockValidate.mockReturnValue(true);
    mockParse.mockReturnValue({ user: { id: userId }, authDate: Math.floor(Date.now() / 1000) });
    mockAuthDate.mockReturnValue(true);
    process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token';
    process.env.OPENAI_API_KEY = 'test-openai-key';
    mockGetUserPreferences.mockResolvedValue({ userId, premium: true, premiumDate: new Date().toISOString() });
    mockGetUserHabits.mockResolvedValue({ habits: [] });
    mockKvGet.mockResolvedValue(null);
    mockChatCompletionsCreate.mockResolvedValue({
      choices: [{ message: { content: '{"habit-1":"<p>Test insight</p>"}' } }],
    });
  });

  it('returns 405 when method is not POST', async () => {
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'GET', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when initData is missing', async () => {
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'initData is required' });
  });

  it('returns 401 when initData signature is invalid', async () => {
    mockValidate.mockReturnValue(false);
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: { initData: 'invalid' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid authentication' });
    expect(mockKvGet).not.toHaveBeenCalled();
  });

  it('returns 200 with empty insights when user is not premium', async () => {
    mockGetUserPreferences.mockResolvedValue({ userId, premium: false });
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: { initData: 'valid' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { insights?: Record<string, string> }).insights).toEqual({});
    expect(mockKvGet).not.toHaveBeenCalled();
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
  });

  // DISABLED: AI analytics insights are turned off — getAnalyticsInsights early-returns {}
  // (OpenAI call commented out). Re-enable when insights are switched back on.
  it.skip('returns 200 with cached insights when cache hit for premium user', async () => {
    const cached = { 'habit-1': '<p>Cached insight</p>' };
    mockKvGet.mockResolvedValue(cached);
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: { initData: 'valid' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { insights?: Record<string, string> }).insights).toEqual(cached);
    expect(mockKvGet).toHaveBeenCalledWith('insights:12345');
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
    expect(mockKvSetWithExpiry).not.toHaveBeenCalled();
  });

  // DISABLED: AI analytics insights are turned off — getAnalyticsInsights early-returns {}
  // (OpenAI call commented out). Re-enable when insights are switched back on.
  it.skip('calls OpenAI and caches result when cache miss for premium user', async () => {
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: { initData: 'valid' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { insights?: Record<string, string> }).insights).toEqual({
      'habit-1': '<p>Test insight</p>',
    });
    expect(mockKvGet).toHaveBeenCalledWith('insights:12345');
    expect(mockChatCompletionsCreate).toHaveBeenCalled();
    expect(mockKvSetWithExpiry).toHaveBeenCalledWith(
      'insights:12345',
      { 'habit-1': '<p>Test insight</p>' },
      86400
    );
  });

  it('returns 200 with empty insights when OPENAI_API_KEY is missing and cache miss', async () => {
    delete process.env.OPENAI_API_KEY;
    const handler = (await import('../../api/analytics-insights')).default;
    const req = { method: 'POST', body: { initData: 'valid' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { insights?: Record<string, string> }).insights).toEqual({});
    expect(mockChatCompletionsCreate).not.toHaveBeenCalled();
    expect(mockKvSetWithExpiry).not.toHaveBeenCalled();
    process.env.OPENAI_API_KEY = 'test-openai-key';
  });
});
