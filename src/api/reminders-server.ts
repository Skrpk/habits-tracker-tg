import http from 'http';
import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../presentation/telegram/TelegramBot';
import { CreateHabitUseCase } from '../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../domain/use-cases/GetHabitsToCheckUseCase';
import { Logger } from '../infrastructure/logger/Logger';

const botToken = process.env.TELEGRAM_BOT_TOKEN;

if (!botToken) {
  throw new Error('TELEGRAM_BOT_TOKEN environment variable is required');
}

// Initialize repository and use cases
const habitRepository = new VercelKVHabitRepository();
const createHabitUseCase = new CreateHabitUseCase(habitRepository);
const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
const deleteHabitUseCase = new DeleteHabitUseCase(habitRepository);
const getHabitsToCheckUseCase = new GetHabitsToCheckUseCase(habitRepository);

const botService = new TelegramBotService(
  botToken,
  createHabitUseCase,
  getUserHabitsUseCase,
  recordHabitCheckUseCase,
  deleteHabitUseCase,
  getHabitsToCheckUseCase,
  false // No polling for webhook mode
);

botService.setupHandlers();

const port = process.env.PORT || 3000;

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
    Logger.info('Starting daily reminders request');
    
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

    Logger.info('Daily reminders request completed', {
      totalUsers: activeUserIds.length,
      successCount,
      errorCount,
      errors: errors.length > 0 ? errors : undefined,
    });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      message: 'Reminders sent',
      totalUsers: activeUserIds.length,
      successCount,
      errorCount,
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

