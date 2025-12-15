import http from 'http';
import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../presentation/telegram/TelegramBot';
import { GetHabitsDueForReminderUseCase } from '../domain/use-cases/GetHabitsDueForReminderUseCase';
import { CreateHabitUseCase } from '../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from '../domain/use-cases/SetHabitReminderScheduleUseCase';
import { Habit } from '../domain/entities/Habit';
import { Logger } from '../infrastructure/logger/Logger';

/**
 * Creates and returns an HTTP server for handling reminder requests
 * This server is used in local development - in production, reminders are handled by Vercel cron jobs
 * @param botService - The TelegramBotService instance to use for sending reminders
 * @param habitRepository - The habit repository instance
 * @param port - Port to listen on (default: 3000)
 * @returns The HTTP server instance
 */
export function createRemindersServer(
  botService: TelegramBotService,
  habitRepository: VercelKVHabitRepository,
  port: number = 3000
): http.Server {
  const server = http.createServer(async (req, res) => {
  // Only handle POST requests to /api/reminders
  if (req.method !== 'POST' || req.url !== '/api/reminders') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
    return;
  }

  // Optional: Check for cron secret
  const cronSecret = req.headers['x-cron-secret'] || new URL(req.url || '', `http://localhost:${port}`).searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET;
  
  if (expectedSecret && cronSecret !== expectedSecret) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  try {
    Logger.info('Starting hourly reminders request');
    
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

    Logger.info('Hourly reminders request completed', {
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Reminders processed',
      totalHabitsDue: habitsDue.length,
      totalUsers: habitsByUser.size,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    }));
  } catch (error) {
    console.error('Error sending reminders:', error);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    }));
  }
  });

  server.listen(port, () => {
    console.log(`Reminders API server running on port ${port}`);
  });

  return server;
}

// Standalone mode: if this file is run directly, create a separate bot instance
// This is kept for backward compatibility but shouldn't be used in normal development
if (require.main === module) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
  }

  console.log('WARNING: Running reminders-server in standalone mode (not recommended for development)');
  console.log('Use npm run dev instead, which runs both bot and reminders server in a single process');

  const habitRepository = new VercelKVHabitRepository();

  const createHabitUseCase = new CreateHabitUseCase(habitRepository);
  const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
  const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
  const deleteHabitUseCase = new DeleteHabitUseCase(habitRepository);
  const getHabitsToCheckUseCase = new GetHabitsToCheckUseCase(habitRepository);
  const setHabitReminderScheduleUseCase = new SetHabitReminderScheduleUseCase(habitRepository);

  const botService = new TelegramBotService(
    botToken,
    createHabitUseCase,
    getUserHabitsUseCase,
    recordHabitCheckUseCase,
    deleteHabitUseCase,
    getHabitsToCheckUseCase,
    false,
    setHabitReminderScheduleUseCase
  );

  const port = parseInt(process.env.PORT || '3000', 10);
  createRemindersServer(botService, habitRepository, port);
}
