import { VercelKVHabitRepository } from './infrastructure/repositories/VercelKVHabitRepository';
import { CreateHabitUseCase } from './domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from './domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from './domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from './domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from './domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from './domain/use-cases/SetHabitReminderScheduleUseCase';
import { TelegramBotService } from './presentation/telegram/TelegramBot';
import { DailyReminderService } from './presentation/telegram/DailyReminderService';
import { createRemindersServer } from './api/reminders-server';

const isProduction = process.env.NODE_ENV === 'production';
const botToken = process.env.TELEGRAM_BOT_TOKEN;

console.log('Bot token:', botToken);
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
const setHabitReminderScheduleUseCase = new SetHabitReminderScheduleUseCase(habitRepository);

if (isProduction) {
  console.log('Running in production mode - webhook will be handled by API route');
  // In production, webhook is handled by /api/webhook.ts
} else {
  console.log('Running in development mode - starting bot with polling and reminders server...');
  
  // Initialize Telegram bot service with polling enabled
  const botService = new TelegramBotService(
    botToken,
    createHabitUseCase,
    getUserHabitsUseCase,
    recordHabitCheckUseCase,
    deleteHabitUseCase,
    getHabitsToCheckUseCase,
    true, // Enable polling for development
    setHabitReminderScheduleUseCase
  );

  // Setup bot handlers
  botService.setupHandlers();

  // Initialize daily reminder service (for periodic checks)
  const reminderService = new DailyReminderService(botService, habitRepository);
  reminderService.start();

  // Start HTTP server for reminders endpoint (used by Docker cron)
  const port = parseInt(process.env.PORT || '3000', 10);
  const remindersServer = createRemindersServer(botService, habitRepository, port);
  
  // Graceful shutdown
  const shutdown = () => {
    console.log('Shutting down...');
    reminderService.stop();
    botService.getBot().stopPolling();
    remindersServer.close(() => {
      console.log('Reminders server closed');
      process.exit(0);
    });
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

