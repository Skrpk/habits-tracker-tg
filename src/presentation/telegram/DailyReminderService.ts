import { TelegramBotService } from './TelegramBot';
import { GetUserHabitsUseCase } from '../../domain/use-cases/GetUserHabitsUseCase';
import { IHabitRepository } from '../../domain/repositories/IHabitRepository';

export class DailyReminderService {
  private botService: TelegramBotService;
  private habitRepository: IHabitRepository;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(botService: TelegramBotService, habitRepository: IHabitRepository) {
    this.botService = botService;
    this.habitRepository = habitRepository;
  }

  start(): void {
    // Check every hour if there are users who need reminders
    this.intervalId = setInterval(async () => {
      await this.checkAndSendReminders();
    }, 60 * 60 * 1000); // Every hour

    // Also run immediately
    this.checkAndSendReminders();
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async checkAndSendReminders(): Promise<void> {
    // Note: Vercel KV doesn't support listing all keys easily
    // In production, you might want to maintain a separate list of user IDs
    // For now, this is a placeholder - you'd need to track active users separately
    
    // This is a simplified approach - in a real scenario, you'd want to:
    // 1. Maintain a set of active user IDs
    // 2. Or use a scheduled job that knows which users to check
    // 3. Or use Vercel Cron Jobs to trigger reminders
    
    console.log('Daily reminder check - implement user tracking for production');
  }

  async sendReminderToUser(userId: number): Promise<void> {
    await this.botService.sendDailyReminder(userId);
  }
}

