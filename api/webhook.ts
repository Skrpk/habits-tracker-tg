import { inject } from '@vercel/analytics';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { CreateHabitUseCase } from '../src/domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../src/domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../src/domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../src/domain/use-cases/GetHabitsToCheckUseCase';
import { TelegramBotService } from '../src/presentation/telegram/TelegramBot';
import TelegramBot from 'node-telegram-bot-api';

// Initialize Vercel Web Analytics
inject();

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

// Initialize repository and use cases (singleton pattern for serverless)
let botService: TelegramBotService | null = null;

function getBotService(): TelegramBotService {
  if (!botService) {
    try {
      console.log('Initializing bot service...');
      console.log('Environment check:', {
        hasBotToken: !!botToken,
        hasRedisUrl: !!process.env.REDIS_URL,
        nodeEnv: process.env.NODE_ENV,
      });

      const habitRepository = new VercelKVHabitRepository();
      const createHabitUseCase = new CreateHabitUseCase(habitRepository);
      const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
      const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
      const deleteHabitUseCase = new DeleteHabitUseCase(habitRepository);
      const getHabitsToCheckUseCase = new GetHabitsToCheckUseCase(habitRepository);

      botService = new TelegramBotService(
        botToken!,
        createHabitUseCase,
        getUserHabitsUseCase,
        recordHabitCheckUseCase,
        deleteHabitUseCase,
        getHabitsToCheckUseCase,
        false // No polling for webhook mode
      );
      
      botService.setupHandlers();
      console.log('Bot service initialized successfully');
    } catch (error) {
      console.error('Error initializing bot service:', error);
      throw error;
    }
  }
  return botService;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Webhook called:', {
    method: req.method,
    hasBody: !!req.body,
    bodyKeys: req.body ? Object.keys(req.body) : [],
  });

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify secret token
  const secretToken = process.env.WEBHOOK_SECRET_TOKEN;
  if (secretToken) {
    const providedToken = req.headers['x-telegram-bot-api-secret-token'];
    if (providedToken !== secretToken) {
      console.warn('Unauthorized webhook request - invalid secret token', {
        providedToken: providedToken ? 'present' : 'missing',
        expectedLength: secretToken.length,
      });
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  try {
    const update = req.body as TelegramBot.Update;
    console.log('Processing update:', {
      updateId: update.update_id,
      messageId: update.message?.message_id,
      chatId: update.message?.chat.id,
      text: update.message?.text,
    });

    const service = getBotService();
    await service.processUpdate(update);
    
    console.log('Update processed successfully');
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    console.error('Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

