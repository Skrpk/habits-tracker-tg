import { inject } from '@vercel/analytics';
import { VercelKVHabitRepository } from './infrastructure/repositories/VercelKVHabitRepository';
import { CreateHabitUseCase } from './domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from './domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from './domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from './domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from './domain/use-cases/GetHabitsToCheckUseCase';
import { TelegramBotService } from './presentation/telegram/TelegramBot';
import { DailyReminderService } from './presentation/telegram/DailyReminderService';

// Initialize Vercel Web Analytics
inject();

const isProduction = process.env.NODE_ENV === 'production';
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

if (isProduction) {
  console.log('Running in production mode - webhook will be handled by API route');
  // In production, webhook is handled by /api/webhook.ts
} else {
  console.log('Running in development mode - starting polling...');
  
  // Initialize Telegram bot service with polling enabled
  const botService = new TelegramBotService(
    botToken,
    createHabitUseCase,
    getUserHabitsUseCase,
    recordHabitCheckUseCase,
    deleteHabitUseCase,
    getHabitsToCheckUseCase,
    true // Enable polling for development
  );

  // Setup bot handlers
  botService.setupHandlers();

  // Initialize daily reminder service
  const reminderService = new DailyReminderService(botService, habitRepository);
  reminderService.start();
  
  // Graceful shutdown
  process.once('SIGINT', () => {
    console.log('Shutting down...');
    reminderService.stop();
    botService.getBot().stopPolling();
    process.exit(0);
  });
  
  process.once('SIGTERM', () => {
    console.log('Shutting down...');
    reminderService.stop();
    botService.getBot().stopPolling();
    process.exit(0);
  });
}

