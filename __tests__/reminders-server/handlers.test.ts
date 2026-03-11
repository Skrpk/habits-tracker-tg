import { describe, it, expect, vi, beforeEach } from 'vitest';
import http from 'http';
import type { VercelKVHabitRepository } from '../../src/infrastructure/repositories/VercelKVHabitRepository';
import type { TelegramBotService } from '../../src/presentation/telegram/TelegramBot';

const mockGetHabitsDueExecute = vi.fn().mockResolvedValue([]);

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn(),
}));

vi.mock('../../src/presentation/telegram/TelegramBot', () => ({
  TelegramBotService: vi.fn(),
}));

vi.mock('../../src/domain/use-cases/GetHabitsDueForReminderUseCase', () => ({
  GetHabitsDueForReminderUseCase: vi.fn().mockImplementation(() => ({
    execute: mockGetHabitsDueExecute,
  })),
}));

import {
  handleRemindersEndpoint,
  handleAnalyticsEndpoint,
} from '../../src/api/reminders-server';

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

describe('handleRemindersEndpoint', () => {
  const mockSendHabitReminders = vi.fn().mockResolvedValue(undefined);
  const mockBotService = { sendHabitReminders: mockSendHabitReminders } as unknown as TelegramBotService;

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
  let mockRepo: { getUserHabits: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockRepo = {
      getUserHabits: vi.fn().mockResolvedValue([]),
    };
  });

  it('returns 400 when userId query param is missing', async () => {
    const req = createMockIncomingMessage({ url: 'http://localhost:3000/api/analytics', method: 'GET' });
    const res = createMockServerResponse();

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when userId is not a valid number', async () => {
    const req = createMockIncomingMessage({
      url: 'http://localhost:3000/api/analytics?userId=notanumber',
      method: 'GET',
    });
    const res = createMockServerResponse();

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(400, { 'Content-Type': 'application/json' });
    expect(JSON.parse(res.body)).toEqual({ error: 'Invalid userId' });
  });

  it('returns 200 with habits array when userId is valid', async () => {
    const req = createMockIncomingMessage({
      url: 'http://localhost:3000/api/analytics?userId=42',
      method: 'GET',
    });
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

    await handleAnalyticsEndpoint(req, res, mockRepo as unknown as VercelKVHabitRepository);

    expect(res.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/json' });
    const data = JSON.parse(res.body);
    expect(data.habits).toHaveLength(1);
    expect(data.habits[0]).toMatchObject({
      id: 'h1',
      name: 'Run',
      streak: 3,
      lastCheckedDate: '2025-02-15',
    });
    expect(data.habits[0].checkHistory).toBeDefined();
  });
});
