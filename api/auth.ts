import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Logger } from '../src/infrastructure/logger/Logger';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../src/infrastructure/auth/validateTelegramInitData';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body || {};

    if (!initData || typeof initData !== 'string') {
      return res.status(400).json({ error: 'initData is required' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!validateTelegramInitData(initData, botToken)) {
      Logger.warn('Invalid Telegram initData signature');
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    const { user, authDate } = parseTelegramInitData(initData);

    if (!isAuthDateValid(authDate)) {
      Logger.warn('Expired Telegram initData', { authDate });
      return res.status(401).json({ error: 'Authentication expired' });
    }

    if (!user || !user.id) {
      Logger.warn('No user in Telegram initData');
      return res.status(401).json({ error: 'Invalid authentication: no user data' });
    }

    Logger.info('Telegram Web App auth successful', { userId: user.id });

    return res.status(200).json({ ok: true, userId: user.id, user });
  } catch (error) {
    Logger.error('Auth error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
