import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../src/presentation/telegram/TelegramBot';
import { CreateHabitUseCase } from '../src/domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../src/domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../src/domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../src/domain/use-cases/GetHabitsToCheckUseCase';
import { GetHabitsDueForReminderUseCase } from '../src/domain/use-cases/GetHabitsDueForReminderUseCase';
import { SetHabitReminderScheduleUseCase } from '../src/domain/use-cases/SetHabitReminderScheduleUseCase';
import { Habit } from '../src/domain/entities/Habit';
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
      const setHabitReminderScheduleUseCase = new SetHabitReminderScheduleUseCase(habitRepository);

      botService = new TelegramBotService(
        botToken,
        createHabitUseCase,
        getUserHabitsUseCase,
        recordHabitCheckUseCase,
        deleteHabitUseCase,
        getHabitsToCheckUseCase,
        false, // No polling for webhook mode
        setHabitReminderScheduleUseCase
      );
    
    botService.setupHandlers();
  }
  return botService;
}

// Vercel serverless function handler
export default async function handler(req: VercelRequest, res: VercelResponse) {
  // SECURITY: Verify request is from Vercel Cron
  // Vercel sends both x-vercel-cron header AND Authorization header with signed token

  try {
    Logger.info('Starting hourly reminders cron job');
    
    const habitRepository = new VercelKVHabitRepository();
    const botService = getBotService();
    
    // Get current time (UTC)
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMinute = now.getUTCMinutes();

    Logger.info('Checking for habits due for reminder', {
      currentHour,
      currentMinute,
      timezone: 'UTC',
    });

    // Get habits that are due for reminders right now based on their schedules
    const getHabitsDueForReminderUseCase = new GetHabitsDueForReminderUseCase(habitRepository);
    const habitsDue = await getHabitsDueForReminderUseCase.execute(now, currentHour, currentMinute, 'UTC');

    Logger.info('Found habits due for reminder', {
      count: habitsDue.length,
      habitIds: habitsDue.map(h => h.id),
    });

    // Group habits by user
    const habitsByUser = new Map<number, Habit[]>();
    for (const habit of habitsDue) {
      if (!habitsByUser.has(habit.userId)) {
        habitsByUser.set(habit.userId, []);
      }
      habitsByUser.get(habit.userId)!.push(habit);
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ userId: number; error: string }> = [];

    // Send reminders grouped by user
    for (const [userId, habits] of habitsByUser.entries()) {
      try {
        Logger.info('Sending reminder to user', { userId, habitCount: habits.length });
        
        // Send reminders for this user's habits
        await botService.sendHabitReminders(userId, habits);
        successCount++;
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

    Logger.info('Hourly reminders cron job completed', {
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    return res.status(200).json({
      ok: true,
      message: 'Reminders processed',
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
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

