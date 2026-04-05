import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { Logger } from '../src/infrastructure/logger/Logger';
import { runAdminUsersList, logAdminUsersError } from '../src/api/admin-users-shared';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body || {};

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const habitRepository = new VercelKVHabitRepository();
    const result = await runAdminUsersList(
      typeof initData === 'string' ? initData : '',
      botToken,
      (req.query || {}) as Record<string, string | string[] | undefined>,
      habitRepository
    );

    res.setHeader('Content-Type', 'application/json');
    return res.status(result.status).json(result.body);
  } catch (error) {
    logAdminUsersError(error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
