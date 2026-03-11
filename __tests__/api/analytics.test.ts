import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const mockExecute = vi.fn();

vi.mock('../../src/infrastructure/repositories/VercelKVHabitRepository', () => ({
  VercelKVHabitRepository: vi.fn().mockImplementation(() => ({
    getUserHabits: vi.fn().mockImplementation(() => ({ habits: [] })),
  })),
}));

vi.mock('../../src/domain/use-cases/GetUserHabitsUseCase', () => ({
  GetUserHabitsUseCase: vi.fn().mockImplementation(() => ({
    execute: mockExecute,
  })),
}));

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
  });

  it('returns 405 when method is not GET', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'POST', query: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
  });

  it('returns 400 when userId is missing', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'GET', query: {} } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'userId is required' });
  });

  it('returns 400 when userId is not a valid number', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'GET', query: { userId: 'abc' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid userId' });
  });

  it('returns 200 with habits array and CORS headers when userId is valid', async () => {
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'GET', query: { userId: '12345' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect((res.body as { habits?: unknown[] }).habits).toEqual([]);
    expect(res.headers['Access-Control-Allow-Origin']).toBe('*');
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET');
    expect(mockExecute).toHaveBeenCalledWith(12345);
  });

  it('returns 500 when use case throws', async () => {
    mockExecute.mockRejectedValueOnce(new Error('DB error'));
    const handler = (await import('../../api/analytics')).default;
    const req = { method: 'GET', query: { userId: '999' } } as VercelRequest;
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect((res.body as { error?: string }).error).toBe('Internal server error');
    expect((res.body as { message?: string }).message).toBe('DB error');
  });
});
