import TelegramBot from 'node-telegram-bot-api';
import { CreateHabitUseCase } from '../../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../../domain/use-cases/GetHabitsToCheckUseCase';
import { Logger } from '../../infrastructure/logger/Logger';

// Helper function to get username from Telegram user
function getUsername(from: TelegramBot.User | undefined): string {
  if (!from) return 'unknown';
  return from.username || `${from.first_name || ''} ${from.last_name || ''}`.trim() || `user_${from.id}`;
}

export class TelegramBotService {
  private bot: TelegramBot;
  private createHabitUseCase: CreateHabitUseCase;
  private getUserHabitsUseCase: GetUserHabitsUseCase;
  private recordHabitCheckUseCase: RecordHabitCheckUseCase;
  private deleteHabitUseCase: DeleteHabitUseCase;
  private getHabitsToCheckUseCase: GetHabitsToCheckUseCase;

  constructor(
    token: string,
    createHabitUseCase: CreateHabitUseCase,
    getUserHabitsUseCase: GetUserHabitsUseCase,
    recordHabitCheckUseCase: RecordHabitCheckUseCase,
    deleteHabitUseCase: DeleteHabitUseCase,
    getHabitsToCheckUseCase: GetHabitsToCheckUseCase,
    usePolling: boolean = false
  ) {
    this.bot = new TelegramBot(token, { polling: usePolling });
    this.createHabitUseCase = createHabitUseCase;
    this.getUserHabitsUseCase = getUserHabitsUseCase;
    this.recordHabitCheckUseCase = recordHabitCheckUseCase;
    this.deleteHabitUseCase = deleteHabitUseCase;
    this.getHabitsToCheckUseCase = getHabitsToCheckUseCase;
  }

  setupHandlers(): void {
    // Start command
    this.bot.onText(/\/start/, async (msg: TelegramBot.Message) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const username = getUsername(msg.from);

      Logger.info('User started bot', {
        userId,
        username,
        chatId,
      });

      await this.bot.sendMessage(
        chatId,
        'Welcome to Habits Tracker! 🎯\n\n' +
        'Commands:\n' +
        '/newhabit <name> - Create a new habit\n' +
        '/myhabits - View all your habits\n' +
        '/check - Check habits for today\n\n' +
        'The bot will remind you daily to check your habits!'
      );
    });

    // Create habit command
    this.bot.onText(/\/newhabit (.+)/, async (msg: TelegramBot.Message, match: RegExpMatchArray | null) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const username = getUsername(msg.from);
      
      if (!userId) {
        Logger.warn('Unable to identify user for create habit', { chatId });
        await this.bot.sendMessage(chatId, 'Unable to identify user.');
        return;
      }

      if (!match || !match[1]) {
        Logger.info('Invalid habit creation request', { userId, username, chatId });
        await this.bot.sendMessage(chatId, 'Please provide a habit name: /newhabit <name>');
        return;
      }

      try {
        const habit = await this.createHabitUseCase.execute(userId, match[1], username);
        await this.bot.sendMessage(
          chatId,
          `✅ Habit "${habit.name}" created!\n\n` +
          `View all your habits with /myhabits`
        );
      } catch (error) {
        Logger.error('Error creating habit', {
          userId,
          username,
          chatId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        await this.bot.sendMessage(chatId, `Error creating habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    });

    // List habits command
    this.bot.onText(/\/myhabits/, async (msg: TelegramBot.Message) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const username = getUsername(msg.from);
      
      if (!userId) {
        Logger.warn('Unable to identify user for list habits', { chatId });
        await this.bot.sendMessage(chatId, 'Unable to identify user.');
        return;
      }

      Logger.info('User requested habits list', { userId, username, chatId });
      await this.showHabitsList(userId, chatId);
    });


    // Check habits command
    this.bot.onText(/\/check/, async (msg: TelegramBot.Message) => {
      const chatId = msg.chat.id;
      const userId = msg.from?.id;
      const username = getUsername(msg.from);
      
      if (!userId) {
        Logger.warn('Unable to identify user for check habits', { chatId });
        await this.bot.sendMessage(chatId, 'Unable to identify user.');
        return;
      }

      Logger.info('User requested habit check', { userId, username, chatId });
      await this.askAboutHabits(userId, chatId);
    });

    // Handle callback queries (Yes/No buttons, habit list, delete)
    this.bot.on('callback_query', async (query: TelegramBot.CallbackQuery) => {
      const chatId = query.message?.chat.id;
      const userId = query.from.id;
      const username = getUsername(query.from);
      const data = query.data;

      if (!chatId || !data) {
        Logger.warn('Invalid callback query', { userId, username, hasChatId: !!chatId, hasData: !!data });
        return;
      }

      await this.bot.answerCallbackQuery(query.id);

      // Handle habit check (Yes/No)
      const checkMatch = data.match(/^habit_check:(.+):(yes|no)$/);
      if (checkMatch) {
        const habitId = checkMatch[1];
        const completed = checkMatch[2] === 'yes';

        try {
          const updatedHabit = await this.recordHabitCheckUseCase.execute(userId, habitId, completed, username);
          
          const emoji = completed ? '✅' : '❌';
          const message = completed
            ? `Great! Your streak for "${updatedHabit.name}" is now ${updatedHabit.streak} days! 🔥`
            : `Streak reset. You can start fresh tomorrow! 💪`;

          await this.bot.editMessageText(
            `${emoji} ${message}`,
            {
              chat_id: chatId,
              message_id: query.message?.message_id,
            }
          );

          // Ask about remaining habits
          await this.askAboutHabits(userId, chatId);
        } catch (error) {
          Logger.error('Error recording habit check', {
            userId,
            username,
            habitId,
            completed,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          await this.bot.answerCallbackQuery(query.id, {
            text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            show_alert: true,
          });
        }
        return;
      }

      // Handle habit view (show details)
      const viewMatch = data.match(/^habit_view:(.+)$/);
      if (viewMatch) {
        const habitId = viewMatch[1];
        await this.showHabitDetails(userId, chatId, habitId, query.message?.message_id);
        return;
      }

      // Handle habit delete
      const deleteMatch = data.match(/^habit_delete:(.+)$/);
      if (deleteMatch) {
        const habitId = deleteMatch[1];
        await this.deleteHabit(userId, chatId, habitId, query.message?.message_id);
        return;
      }

      // Handle back to list
      if (data === 'habit_list') {
        await this.showHabitsList(userId, chatId, query.message?.message_id);
        return;
      }
    });
  }

  private async showHabitsList(userId: number, chatId: number, messageId?: number): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      
      Logger.info('Showing habits list', {
        userId,
        chatId,
        habitCount: habits.length,
      });
      
      if (habits.length === 0) {
        const message = 'You don\'t have any habits yet. Create one with /newhabit <name>';
        if (messageId) {
          await this.bot.editMessageText(message, {
            chat_id: chatId,
            message_id: messageId,
          });
        } else {
          await this.bot.sendMessage(chatId, message);
        }
        return;
      }

      // Create inline keyboard with one button per habit
      const keyboard = {
        inline_keyboard: habits.map(habit => [
          {
            text: `${habit.name} (🔥 ${habit.streak} days)`,
            callback_data: `habit_view:${habit.id}`,
          },
        ]),
      };

      const message = '📋 Your Habits:\n\nClick on a habit to view details or delete it.';
      
      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error fetching habits: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async showHabitDetails(userId: number, chatId: number, habitId: string, messageId?: number): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.answerCallbackQuery('', {
          text: 'Habit not found',
          show_alert: true,
        });
        return;
      }

      const message = `📋 Habit Details\n\n` +
        `Name: ${habit.name}\n` +
        `🔥 Streak: ${habit.streak} days\n` +
        `📅 Last checked: ${habit.lastCheckedDate || 'Never'}\n` +
        `📆 Created: ${new Date(habit.createdAt).toLocaleDateString()}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🗑️ Delete Habit', callback_data: `habit_delete:${habit.id}` },
          ],
          [
            { text: '← Back to List', callback_data: 'habit_list' },
          ],
        ],
      };

      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      await this.bot.sendMessage(chatId, `Error fetching habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async deleteHabit(userId: number, chatId: number, habitId: string, messageId?: number, username?: string): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for deletion', { userId, username, habitId, chatId });
        await this.bot.answerCallbackQuery('', {
          text: 'Habit not found',
          show_alert: true,
        });
        return;
      }

      await this.deleteHabitUseCase.execute(userId, habitId, username, habit.name);
      
      const message = `✅ Habit "${habit.name}" deleted successfully!`;
      
      if (messageId) {
        await this.bot.editMessageText(message, {
          chat_id: chatId,
          message_id: messageId,
        });
        
        // Show updated list
        await this.showHabitsList(userId, chatId);
      } else {
        await this.bot.sendMessage(chatId, message);
        await this.showHabitsList(userId, chatId);
      }
    } catch (error) {
      Logger.error('Error deleting habit', {
        userId,
        username,
        habitId,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error deleting habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async askAboutHabits(userId: number, chatId: number): Promise<void> {
    try {
      const habitsToCheck = await this.getHabitsToCheckUseCase.execute(userId);

      Logger.info('Checking habits for user', {
        userId,
        chatId,
        habitsToCheckCount: habitsToCheck.length,
        habitIds: habitsToCheck.map(h => h.id),
      });

      if (habitsToCheck.length === 0) {
        Logger.info('All habits already checked for today', { userId, chatId });
        await this.bot.sendMessage(chatId, '✅ All habits checked for today! Great job! 🎉');
        return;
      }

      // Ask about the first unchecked habit
      const habit = habitsToCheck[0];
      Logger.info('Asking about habit', {
        userId,
        chatId,
        habitId: habit.id,
        habitName: habit.name,
      });

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Yes', callback_data: `habit_check:${habit.id}:yes` },
            { text: '❌ No', callback_data: `habit_check:${habit.id}:no` },
          ],
        ],
      };

      await this.bot.sendMessage(
        chatId,
        `Did you "${habit.name}" today?`,
        {
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      Logger.error('Error checking habits', {
        userId,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error checking habits: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async sendDailyReminder(userId: number): Promise<void> {
    try {
      Logger.info('Sending daily reminder', { userId });
      
      const habitsToCheck = await this.getHabitsToCheckUseCase.execute(userId);
      
      if (habitsToCheck.length === 0) {
        Logger.info('User has no habits to check', { userId });
        return; // All habits already checked
      }

      Logger.info('Sending reminder with habits to check', {
        userId,
        habitsToCheckCount: habitsToCheck.length,
        habitIds: habitsToCheck.map(h => h.id),
        habitNames: habitsToCheck.map(h => h.name),
      });

      // Use userId as chatId for direct messages (Telegram user IDs are chat IDs for private chats)
      await this.askAboutHabits(userId, userId);
      
      Logger.info('Daily reminder sent successfully', { userId });
    } catch (error) {
      Logger.error('Error sending daily reminder', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error; // Re-throw to allow caller to handle
    }
  }

  getBot(): TelegramBot {
    return this.bot;
  }

  async processUpdate(update: TelegramBot.Update): Promise<void> {
    await this.bot.processUpdate(update);
  }
}

