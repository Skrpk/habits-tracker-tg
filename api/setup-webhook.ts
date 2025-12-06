import type { VercelRequest, VercelResponse } from '@vercel/node';
import TelegramBot from 'node-telegram-bot-api';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;
const secretToken = process.env.WEBHOOK_SECRET_TOKEN;
const setupSecret = process.env.SETUP_SECRET; // Optional: protect this endpoint

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Optional: Require a secret to call this endpoint
  if (setupSecret && req.query.secret !== setupSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!botToken) {
    return res.status(500).json({ error: 'TELEGRAM_BOT_TOKEN not configured' });
  }

  if (!webhookUrl) {
    return res.status(500).json({ error: 'WEBHOOK_URL not configured' });
  }

  try {
    const bot = new TelegramBot(botToken);
    
    await bot.setWebHook(`${webhookUrl}/api/webhook`, {
      secret_token: secretToken,
    });
    
    const webhookInfo = await bot.getWebHookInfo();
    
    return res.status(200).json({
      success: true,
      webhookUrl: webhookInfo.url,
      pendingUpdates: webhookInfo.pending_update_count,
      secretTokenConfigured: !!secretToken,
    });
  } catch (error) {
    console.error('Error setting webhook:', error);
    return res.status(500).json({
      error: 'Failed to set webhook',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
