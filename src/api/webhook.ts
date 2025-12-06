import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { CreateHabitUseCase } from '../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../domain/use-cases/GetHabitsToCheckUseCase';
import { TelegramBotService } from '../presentation/telegram/TelegramBot';
import TelegramBot from 'node-telegram-bot-api';

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookUrl = process.env.WEBHOOK_URL;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

// Initialize repository and use cases (singleton pattern for serverless)
let botService: TelegramBotService | null = null;

function getBotService(): TelegramBotService {
  if (!botService) {
    const habitRepository = new VercelKVHabitRepository();
    const createHabitUseCase = new CreateHabitUseCase(habitRepository);
    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
    const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
    const deleteHabitUseCase = new DeleteHabitUseCase(habitRepository);
    const getHabitsToCheckUseCase = new GetHabitsToCheckUseCase(habitRepository);

    botService = new TelegramBotService(
      botToken,
      createHabitUseCase,
      getUserHabitsUseCase,
      recordHabitCheckUseCase,
      deleteHabitUseCase,
      getHabitsToCheckUseCase
    );
    
    botService.setupHandlers();
  }
  return botService;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const update = req.body as TelegramBot.Update;
    const service = getBotService();
    await service.processUpdate(update);
    
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

// Setup webhook on first deployment
export async function setupWebhook() {
  if (!webhookUrl) {
    console.warn('WEBHOOK_URL not set, skipping webhook setup');
    return;
  }

  try {
    const bot = new TelegramBot(botToken);
    await bot.setWebHook(`${webhookUrl}/api/webhook`);
    console.log('Webhook set successfully');
  } catch (error) {
    console.error('Error setting webhook:', error);
  }
}

