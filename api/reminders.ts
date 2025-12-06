import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../src/presentation/telegram/TelegramBot';
import { CreateHabitUseCase } from '../src/domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../src/domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../src/domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../src/domain/use-cases/GetHabitsToCheckUseCase';
import { Logger } from '../src/infrastructure/logger/Logger';

const botToken = process.env.TELEGRAM_BOT_TOKEN || '';

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
      getHabitsToCheckUseCase,
      false // No polling for webhook mode
    );
    
    botService.setupHandlers();
  }
  return botService;
}

// Vercel serverless function handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Only allow POST requests (for cron jobs)
  // if (req.method !== 'POST') {
  //   return res.status(405).json({ error: 'Method not allowed' });
  // }

  // Optional: Add a secret token for security
  const cronSecret = req.headers['x-cron-secret'] || req.query.secret;
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    Logger.info('Starting daily reminders cron job');
    
    const habitRepository = new VercelKVHabitRepository();
    const botService = getBotService();
    const activeUserIds = await habitRepository.getAllActiveUserIds();

    Logger.info('Retrieved active users for reminders', {
      totalUsers: activeUserIds.length,
      userIds: activeUserIds,
    });

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ userId: number; error: string }> = [];

    // Send reminders to all active users
    for (const userId of activeUserIds) {
      try {
        Logger.info('Sending reminder to user', { userId });
        await botService.sendDailyReminder(userId);
        successCount++;
        Logger.info('Reminder sent successfully', { userId });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        Logger.error('Error sending reminder to user', {
          userId,
          error: errorMessage,
        });
        errors.push({ userId, error: errorMessage });
        errorCount++;
      }
    }

    Logger.info('Daily reminders cron job completed', {
      totalUsers: activeUserIds.length,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    return res.status(200).json({
      ok: true,
      message: 'Reminders sent',
      totalUsers: activeUserIds.length,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    Logger.error('Error in reminders cron job', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

