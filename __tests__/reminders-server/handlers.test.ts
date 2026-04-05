import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import { Readable } from 'stream';
import type { VercelKVHabitRepository } from '../../src/infrastructure/repositories/VercelKVHabitRepository';
import type { TelegramBotService } from '../../src/presentation/telegram/TelegramBot';

const mockGetHabitsDueExecute = vi.fn().mockResolvedValue([]);
const mockValidateTelegramInitData = vi.fn();
const mockParseTelegramInitData = vi.fn();
const mockIsAuthDateValid = vi.fn();

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn(),
}));

vi.mock('../../src/infrastructure/auth/validateTelegramInitData', () => ({
  validateTelegramInitData: (initData: string, _botToken: string) => mockValidateTelegramInitData(initData, _botToken),
  parseTelegramInitData: (initData: string) => mockParseTelegramInitData(initData),
  isAuthDateValid: (authDate: number) => mockIsAuthDateValid(authDate),
}));

vi.mock('../../src/presentation/telegram/TelegramBot', () => ({
  TelegramBotService: vi.fn(),
}));

vi.mock('../../src/domain/use-cases/GetHabitsDueForReminderUseCase', () => ({
  GetHabitsDueForReminderUseCase: vi.fn().mockImplementation(() => ({
    execute: mockGetHabitsDueExecute,
  })),
}));

vi.mock('../../src/infrastructure/config/kv', () => ({
  kv: { get: vi.fn(), setWithExpiry: vi.fn() },
}));

vi.mock('../../src/api/analytics-shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/api/analytics-shared')>();
  return {
    ...actual,
    getAnalyticsInsights: vi.fn().mockResolvedValue({}) as typeof actual.getAnalyticsInsights,
  };
});

import {
  handleRemindersEndpoint,
  handleAnalyticsEndpoint,
  handleAnalyticsInsightsEndpoint,
} from '../../src/api/reminders-server';
import { getAnalyticsInsights } from '../../src/api/analytics-shared';

function createMockIncomingMessage(opts: { url?: string; method?: string; headers?: http.IncomingHttpHeaders } = {}): http.IncomingMessage {
  const msg = {
    url: opts.url || '/',
    method: opts.method || 'GET',
    headers: opts.headers || {},
    on: vi.fn(),
    emit: vi.fn(),
  } as unknown as http.IncomingMessage;
  return msg;
}

function createMockServerResponse(): http.ServerResponse & { statusCode: number; headers: Record<string, string>; body: string } {
  const headers: Record<string, string> = {};
  const res: http.ServerResponse & { statusCode: number; headers: Record<string, string>; body: string } = {
    statusCode: 0,
    headers,
    body: '',
    writeHead: vi.fn().mockImplementation((code: number) => {
      res.statusCode = code;
      return res;
    }) as unknown as http.ServerResponse['writeHead'],
    setHeader: vi.fn().mockImplementation((name: string, value: string) => {
      res.headers[name] = value;
      return res;
    }) as unknown as http.ServerResponse['setHeader'],
    end: vi.fn().mockImplementation((chunk?: string) => {
      res.body = chunk ?? '';
      return res;
    }) as unknown as http.ServerResponse['end'],
  } as unknown as http.ServerResponse & { statusCode: number; headers: Record<string, string>; body: string };
  return res;
}

/** Creates a POST request with JSON body (e.g. for /api/analytics with initData). */
function createPostRequestWithBody(url: string, body: object): http.IncomingMessage {
  const stream = Readable.from([Buffer.from(JSON.stringify(body))]);
  const req = Object.assign(stream, {
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
  }) as http.IncomingMessage;
  return req;
}

describe('handleRemindersEndpoint', () => {
  const mockSendHabitReminders = vi.fn().mockResolvedValue(undefined);
  const mockBotService = {
    sendHabitReminders: mockSendHabitReminders,
    getBot: () => ({
      createInvoiceLink: vi.fn().mockResolvedValue('https://t.me/$invoice'),
      sendMessage: vi.fn().mockResolvedValue(undefined),
    }),
  } as unknown as TelegramBotService;

  let mockRepo: {
    getAllActiveUserIds: ReturnType<typeof vi.fn>;
    getUserHabits: ReturnType<typeof vi.fn>;
    getUserPreferences: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockSendHabitReminders.mockClear();
    mockGetHabitsDueExecute.mockResolvedValue([]);
    mockRepo = {
      getAllActiveUserIds: vi.fn().mockResolvedValue([]),
      getUserHabits: vi.fn().mockResolvedValue(null),
      getUserPreferences: vi.fn().mockResolvedValue({ timezone: 'UTC', blocked: false }),
    };
  });

  it('returns 401 when CRON_SECRET is set and request has wrong secret in header', async () => {
    const originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'expected-secret';
    const req = createMockIncomingMessage({
      method: 'POST',
      url: '/api/reminders',
      headers: { 'x-cron-secret': 'wrong-secret' },
    });
    const res = createMockServerResponse();

    await handleRemindersEndpoint(req, res, mockBotService, mockRepo as unknown as VercelKVHabitRepository, 3000);

    expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    process.env.CRON_SECRET = originalSecret;
  });

  it('returns 401 when CRON_SECRET is set and secret in query does not match', async () => {
    const originalSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = 'expected-secret';
    const req = createMockIncomingMessage({
      method: 'POST',
      url: 'http://localhost:3000/api/reminders?secret=wrong',
    });
    const res = createMockServerResponse();

    await handleRemindersEndpoint(req, res, mockBotService, mockRepo as unknown as VercelKVHabitRepository, 3000);

    expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Unauthorized' });
    process.env.CRON_SECRET = originalSecret;
  });

  it('returns 200 with ok true and counts when authorized and no habits due', async () => {
    const originalSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET; // no secret => no auth required
    const req = createMockIncomingMessage({ method: 'POST', url: '/api/reminders' });
    const res = createMockServerResponse();

    await handleRemindersEndpoint(req, res, mockBotService, mockRepo as unknown as VercelKVHabitRepository, 3000);
    process.env.CRON_SECRET = originalSecret;

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    expect(data.ok).toBe(true);
    expect(data.message).toBe('Reminders processed');
    expect(data.totalHabitsDue).toBe(0);
    expect(data.totalUsers).toBe(0);
    expect(data.successCount).toBe(0);
    expect(data.errorCount).toBe(0);
  });

  it('skips blocked users and does not call sendHabitReminders for them', async () => {
    const originalSecret = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    const habitDue = {
      id: 'h1',
      userId: 111,
      name: 'Test',
      streak: 0,
      createdAt: new Date(),
      lastCheckedDate: '',
      reminderSchedule: { type: 'daily', hour: 22, minute: 0 },
      reminderEnabled: true,
    };
    mockGetHabitsDueExecute.mockResolvedValueOnce([habitDue]);
    mockRepo.getUserPreferences.mockResolvedValue({ timezone: 'UTC', blocked: true });

    const req = createMockIncomingMessage({ method: 'POST', url: '/api/reminders' });
    const res = createMockServerResponse();

    await handleRemindersEndpoint(req, res, mockBotService, mockRepo as unknown as VercelKVHabitRepository, 3000);
    process.env.CRON_SECRET = originalSecret;

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    expect(data.skippedBlocked).toBe(1);
    expect(data.totalHabitsDue).toBe(1);
    expect(mockSendHabitReminders).not.toHaveBeenCalled();
  });
});

describe('handleAnalyticsEndpoint', () => {
  let mockRepo: { getUserHabits: ReturnType<typeof vi.fn>; getUserPreferences: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = {
      getUserHabits: vi.fn().mockResolvedValue([]),
      getUserPreferences: vi.fn().mockResolvedValue(null),
    };
    mockValidateTelegramInitData.mockReturnValue(true);
    mockParseTelegramInitData.mockReturnValue({ user: { id: 42 }, authDate: Math.floor(Date.now() / 1000) - 100 });
    mockIsAuthDateValid.mockReturnValue(true);
  });

  it('returns 405 when method is not POST', async () => {
    const req = createMockIncomingMessage({ url: 'http://localhost:3000/api/analytics', method: 'GET' });
    const res = createMockServerResponse();

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(405, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when initData is missing in body', async () => {
    const req = createPostRequestWithBody('http://localhost:3000/api/analytics', {});
    const res = createMockServerResponse();

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'initData is required' });
  });

  it('returns 401 when initData fails validation', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockValidateTelegramInitData.mockReturnValue(false);
    const req = createPostRequestWithBody('http://localhost:3000/api/analytics', { initData: 'invalid' });
    const res = createMockServerResponse();

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid authentication' });
  });

  it('returns 200 with habits and premium when initData is valid', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    const req = createPostRequestWithBody('http://localhost:3000/api/analytics', { initData: 'valid_init_data' });
    const res = createMockServerResponse();
    const habit = {
      id: 'h1',
      userId: 42,
      name: 'Run',
      streak: 3,
      createdAt: new Date('2025-01-01'),
      lastCheckedDate: '2025-02-15',
      skipped: [],
      dropped: [],
      badges: [],
    };
    mockRepo.getUserHabits.mockResolvedValue({ habits: [habit] });
    mockRepo.getUserPreferences.mockResolvedValue(null); // not premium

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    expect(data.habits).toHaveLength(1);
    expect(data.premium).toBe(false);
    expect(data.habits[0]).toMatchObject({
      id: 'h1',
      name: 'Run',
      streak: 3,
      lastCheckedDate: '2025-02-15',
    });
    expect(data.habits[0].checkHistory).toBeDefined();
  });
});

describe('handleAnalyticsInsightsEndpoint', () => {
  const mockRepo = { getUserHabits: vi.fn(), getUserPreferences: vi.fn() };

  beforeEach(() => {
    vi.mocked(getAnalyticsInsights).mockResolvedValue({});
    mockValidateTelegramInitData.mockReturnValue(true);
    mockParseTelegramInitData.mockReturnValue({ user: { id: 42 }, authDate: Math.floor(Date.now() / 1000) - 100 });
    mockIsAuthDateValid.mockReturnValue(true);
  });

  it('returns 405 when method is not POST', async () => {
    const req = createMockIncomingMessage({ url: 'http://localhost:3000/api/analytics-insights', method: 'GET' });
    const res = createMockServerResponse();

    await handleAnalyticsInsightsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(405, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Method not allowed' });
  });

  it('returns 401 when initData fails validation', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    mockValidateTelegramInitData.mockReturnValue(false);
    const req = createPostRequestWithBody('http://localhost:3000/api/analytics-insights', { initData: 'invalid' });
    const res = createMockServerResponse();

    await handleAnalyticsInsightsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(401, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid authentication' });
  });

  it('returns 200 with insights when initData is valid', async () => {
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    vi.mocked(getAnalyticsInsights).mockResolvedValue({ h1: '<p class="insights-paragraph">Good streak.</p>' });
    const req = createPostRequestWithBody('http://localhost:3000/api/analytics-insights', { initData: 'valid' });
    const res = createMockServerResponse();

    await handleAnalyticsInsightsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    expect(data.insights).toEqual({ h1: '<p class="insights-paragraph">Good streak.</p>' });
  });
});
