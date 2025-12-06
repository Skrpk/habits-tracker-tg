import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { CreateHabitUseCase } from '../src/domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../src/domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../src/domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../src/domain/use-cases/GetHabitsToCheckUseCase';
import { TelegramBotService } from '../src/presentation/telegram/TelegramBot';
import TelegramBot from 'node-telegram-bot-api';

const botToken = process.env.TELEGRAM_BOT_TOKEN;

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
      botToken!,
      createHabitUseCase,
      getUserHabitsUseCase,
      recordHabitCheckUseCase,
      deleteHabitUseCase,
      getHabitsToCheckUseCase,
      false // No polling for webhook mode
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

