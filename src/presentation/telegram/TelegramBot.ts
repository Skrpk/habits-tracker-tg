import TelegramBot from 'node-telegram-bot-api';
import { CreateHabitUseCase } from '../../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../../domain/use-cases/GetHabitsToCheckUseCase';
import { Logger } from '../../infrastructure/logger/Logger';
import { kv } from '../../infrastructure/config/kv';

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
    
    // Add error handlers for debugging
    this.bot.on('error', (error: Error) => {
      Logger.error('Telegram bot error', {
        message: error.message,
        stack: error.stack,
      });
    });
    
    this.bot.on('polling_error', (error: Error) => {
      Logger.error('Telegram bot polling error', {
        message: error.message,
        stack: error.stack,
      });
    });
    
    this.createHabitUseCase = createHabitUseCase;
    this.getUserHabitsUseCase = getUserHabitsUseCase;
    this.recordHabitCheckUseCase = recordHabitCheckUseCase;
    this.deleteHabitUseCase = deleteHabitUseCase;
    this.getHabitsToCheckUseCase = getHabitsToCheckUseCase;
  }

  setupHandlers(): void {
    // All handlers are now manually handled in processUpdate()
    // This method is kept for potential future use or compatibility
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
          await this.safeEditMessage(message, {
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
        await this.safeEditMessage(message, {
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

      const skippedCount = (habit.skipped || []).length;
      const message = `📋 Habit Details\n\n` +
        `Name: ${habit.name}\n` +
        `🔥 Streak: ${habit.streak} days\n` +
        `⏭️ Skipped days: ${skippedCount}\n` +
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
        await this.safeEditMessage(message, {
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
        await this.safeEditMessage(message, {
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
          ],
          [
            { text: '❌ No (drop streak)', callback_data: `habit_check:${habit.id}:no` },
            { text: '⏭️ Skip (keep streak)', callback_data: `habit_check:${habit.id}:skip` },
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
    try {
      Logger.debug('Processing update', {
        updateId: update.update_id,
        messageText: update.message?.text,
      });
      
      // Handle text messages (commands)
      if (update.message?.text) {
        const text = update.message.text;
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const username = getUsername(msg.from);
        
        if (!userId) {
          Logger.warn('Message received without user ID', { chatId });
          return;
        }
        
        // Check for conversation state first (before processing commands)
        const conversationState = await this.getConversationState(userId);
        
        // If user sends a command while in conversation state, clear the state
        if (conversationState && text.match(/^\//)) {
          await this.clearConversationState(userId);
        }
        
        if (conversationState === 'creating_habit' && !text.match(/^\//)) {
          // User is in the middle of creating a habit - treat this message as the habit name
          await this.handleHabitNameInput(chatId, userId, username, text);
          return;
        }
        
        // Handle /start command
        if (text.match(/^\/start/)) {
          await this.handleStartCommand(chatId, userId, username);
          return;
        }
        
        // Handle /newhabit command (without arguments)
        if (text.match(/^\/newhabit$/)) {
          await this.handleNewHabitCommand(chatId, userId, username);
          return;
        }
        
        // Handle /newhabit command with argument (backward compatibility)
        const newHabitMatch = text.match(/^\/newhabit (.+)$/);
        if (newHabitMatch) {
          await this.handleNewHabitCommandWithName(chatId, userId, username, newHabitMatch[1]);
          return;
        }
        
        // Handle /myhabits command
        if (text.match(/^\/myhabits/)) {
          await this.handleMyHabitsCommand(chatId, userId, username);
          return;
        }
        
        // Unknown command - ignore silently
        Logger.debug('Unknown command received', { text, userId, chatId });
        return;
      }
      
      // Handle callback queries
      if (update.callback_query) {
        await this.handleCallbackQuery(update.callback_query);
        return;
      }
      
      // For other update types, use processUpdate
      await this.bot.processUpdate(update);
      
      Logger.debug('Update processed', { updateId: update.update_id });
    } catch (error) {
      Logger.error('Error processing update', {
        updateId: update.update_id,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorName: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  // Command handlers - extracted for clean manual handling
  private async handleStartCommand(chatId: number, userId: number | undefined, username: string): Promise<void> {
    Logger.info('User started bot', {
      userId,
      username,
      chatId,
    });

    try {
      Logger.info('Sending welcome message', { chatId });
      const sentMessage = await this.bot.sendMessage(
        chatId,
        'Choose what is best, and habit will make it pleasant and easy.\n' +
        '— Plutarch\n\n' +
        'Welcome to Habits Tracker! 🎯\n\n' +
        'Commands:\n' +
        '/newhabit - Create a new habit\n\n' +
        '/myhabits - View all your habits\n\n' +
        'The bot will remind you daily to check your habits!\n\n' +
        'You can also check your habits by replying to the bot\'s message.'
      );
      Logger.info('Welcome message sent successfully', {
        chatId,
        messageId: sentMessage.message_id,
      });
    } catch (error) {
      Logger.error('Error sending welcome message', {
        chatId,
        userId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorName: error instanceof Error ? error.name : undefined,
        errorCode: (error as any)?.code,
        errorResponse: (error as any)?.response,
        stack: error instanceof Error ? error.stack : undefined,
      });
      throw error;
    }
  }

  private async handleNewHabitCommand(chatId: number, userId: number, username: string): Promise<void> {
    // Set conversation state to "creating_habit"
    await this.setConversationState(userId, 'creating_habit');
    
    Logger.info('User started creating habit', { userId, username, chatId });
    await this.bot.sendMessage(
      chatId,
      '📝 What would you like to name your new habit?\n\n' +
      'Just type the name and send it to me.'
    );
  }

  private async handleHabitNameInput(chatId: number, userId: number, username: string, habitName: string): Promise<void> {
    // Clear conversation state
    await this.clearConversationState(userId);
    
    const trimmedName = habitName.trim();
    
    if (!trimmedName || trimmedName.length === 0) {
      Logger.info('Empty habit name provided', { userId, username, chatId });
      await this.bot.sendMessage(chatId, '❌ Habit name cannot be empty. Please try again with /newhabit');
      return;
    }

    // Check if name starts with a command (user might have sent a command by mistake)
    if (trimmedName.startsWith('/')) {
      Logger.info('User sent command instead of habit name', { userId, username, chatId, text: trimmedName });
      await this.bot.sendMessage(chatId, '❌ Please provide a habit name, not a command. Try again with /newhabit');
      return;
    }

    try {
      Logger.info('Creating habit', { userId, username, chatId, habitName: trimmedName });
      const habit = await this.createHabitUseCase.execute(userId, trimmedName, username);
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
        habitName: trimmedName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error creating habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleNewHabitCommandWithName(chatId: number, userId: number, username: string, habitName: string): Promise<void> {
    // Backward compatibility: handle /newhabit <name> format
    const trimmedName = habitName.trim();
    
    if (!trimmedName || trimmedName.length === 0) {
      Logger.info('Invalid habit creation request', { userId, username, chatId });
      await this.bot.sendMessage(chatId, 'Please provide a habit name: /newhabit <name>');
      return;
    }

    try {
      const habit = await this.createHabitUseCase.execute(userId, trimmedName, username);
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
  }

  // Conversation state management
  private async getConversationState(userId: number): Promise<string | null> {
    try {
      const state = await kv.get(`conversation_state:${userId}`) as string | null;
      return state;
    } catch (error) {
      Logger.error('Error getting conversation state', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return null;
    }
  }

  private async setConversationState(userId: number, state: string): Promise<void> {
    try {
      await kv.set(`conversation_state:${userId}`, state);
      // Set expiration to 1 hour (in case user abandons the conversation)
      // Note: Redis SET doesn't support expiration directly, we'd need to use SETEX
      // For now, we'll rely on manual cleanup or implement SETEX if needed
    } catch (error) {
      Logger.error('Error setting conversation state', {
        userId,
        state,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async clearConversationState(userId: number): Promise<void> {
    try {
      await kv.del(`conversation_state:${userId}`);
    } catch (error) {
      Logger.error('Error clearing conversation state', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - clearing state is not critical
    }
  }

  private async handleMyHabitsCommand(chatId: number, userId: number | undefined, username: string): Promise<void> {
    if (!userId) {
      Logger.warn('Unable to identify user for list habits', { chatId });
      await this.bot.sendMessage(chatId, 'Unable to identify user.');
      return;
    }

    Logger.info('User requested habits list', { userId, username, chatId });
    await this.showHabitsList(userId, chatId);
  }


  // Callback query handlers
  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const username = getUsername(query.from);
    const data = query.data;

    if (!chatId || !data) {
      Logger.warn('Invalid callback query', { userId, username, hasChatId: !!chatId, hasData: !!data });
      return;
    }

    // Answer callback query immediately to remove loading state
    await this.bot.answerCallbackQuery(query.id);

    // Handle habit check (Yes/No/Skip/Cancel)
    const checkMatch = data.match(/^habit_check:(.+):(yes|no|skip|cancel)$/);
    if (checkMatch) {
      const action = checkMatch[2];
      if (action === 'skip') {
        // Show confirmation for skip
        await this.handleHabitSkipConfirmation(userId, chatId, checkMatch[1], query.message?.message_id);
        return;
      }
      if (action === 'cancel') {
        // Cancel skip - go back to habit check question
        const habits = await this.getUserHabitsUseCase.execute(userId);
        const habit = habits.find(h => h.id === checkMatch[1]);
        if (habit) {
          const keyboard = {
            inline_keyboard: [
              [
                { text: '✅ Yes', callback_data: `habit_check:${habit.id}:yes` },
              ],
              [
                { text: '❌ No (drop streak)', callback_data: `habit_check:${habit.id}:no` },
                { text: '⏭️ Skip (keep streak)', callback_data: `habit_check:${habit.id}:skip` },
              ],
            ],
          };
          await this.safeEditMessage(
            `Did you "${habit.name}" today?`,
            {
              chat_id: chatId,
              message_id: query.message?.message_id,
              reply_markup: keyboard,
            }
          );
        }
        return;
      }
      await this.handleHabitCheckCallback(userId, chatId, username, checkMatch[1], action === 'yes', query);
      return;
    }

    // Handle habit skip confirmation
    const skipConfirmMatch = data.match(/^habit_skip_confirm:(.+)$/);
    if (skipConfirmMatch) {
      await this.handleHabitSkipCallback(userId, chatId, username, skipConfirmMatch[1], query.message?.message_id);
      return;
    }

    // Handle habit view (show details)
    const viewMatch = data.match(/^habit_view:(.+)$/);
    if (viewMatch) {
      await this.handleHabitViewCallback(userId, chatId, viewMatch[1], query.message?.message_id);
      return;
    }

    // Handle habit delete confirmation
    const deleteConfirmMatch = data.match(/^habit_delete_confirm:(.+)$/);
    if (deleteConfirmMatch) {
      await this.handleHabitDeleteConfirmCallback(userId, chatId, deleteConfirmMatch[1], query.message?.message_id, username);
      return;
    }

    // Handle habit delete (show confirmation)
    const deleteMatch = data.match(/^habit_delete:(.+)$/);
    if (deleteMatch) {
      await this.handleHabitDeleteCallback(userId, chatId, deleteMatch[1], query.message?.message_id, username);
      return;
    }

    // Handle back to list
    if (data === 'habit_list') {
      await this.handleHabitListCallback(userId, chatId, query.message?.message_id);
      return;
    }

    Logger.warn('Unknown callback query data', { userId, username, data, chatId });
  }

  private async handleHabitCheckCallback(
    userId: number,
    chatId: number,
    username: string,
    habitId: string,
    completed: boolean,
    query: TelegramBot.CallbackQuery
  ): Promise<void> {
    try {
      const updatedHabit = await this.recordHabitCheckUseCase.execute(userId, habitId, completed, username);
      
      const emoji = completed ? '✅' : '❌';
      const message = completed
        ? `Great! Your streak for "${updatedHabit.name}" is now ${updatedHabit.streak} days! 🔥`
        : `Streak reset. You can start fresh tomorrow! 💪`;

      await this.safeEditMessage(
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
  }

  private async handleHabitSkipConfirmation(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for skip confirmation', { userId, habitId, chatId });
        await this.bot.answerCallbackQuery('', {
          text: 'Habit not found',
          show_alert: true,
        });
        return;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Yes, skip', callback_data: `habit_skip_confirm:${habitId}` },
            { text: '❌ Cancel', callback_data: `habit_check:${habitId}:cancel` },
          ],
        ],
      };

      await this.safeEditMessage(
        `Are you sure you want to skip "${habit.name}" today?\n\n⏭️ Your streak will be preserved.`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      Logger.error('Error showing skip confirmation', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async handleHabitSkipCallback(
    userId: number,
    chatId: number,
    username: string,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const updatedHabit = await this.recordHabitCheckUseCase.skipHabit(userId, habitId, username);
      
      const message = `⏭️ Skipped "${updatedHabit.name}" today. Your streak of ${updatedHabit.streak} days is preserved! 💪`;

      await this.safeEditMessage(
        message,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      // Ask about remaining habits
      await this.askAboutHabits(userId, chatId);
    } catch (error) {
      Logger.error('Error skipping habit', {
        userId,
        username,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error skipping habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleHabitViewCallback(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    await this.showHabitDetails(userId, chatId, habitId, messageId);
  }

  private async handleHabitDeleteCallback(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number,
    username?: string
  ): Promise<void> {
    try {
      // Get habit details to show in confirmation
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for deletion confirmation', { userId, username, habitId, chatId });
        await this.bot.answerCallbackQuery('', {
          text: 'Habit not found',
          show_alert: true,
        });
        return;
      }

      // Show confirmation message
      const confirmationMessage = `⚠️ Are you sure you want to delete "${habit.name}"?\n\nThis action cannot be undone.`;
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Yes, delete', callback_data: `habit_delete_confirm:${habitId}` },
            { text: '❌ Cancel', callback_data: `habit_view:${habitId}` },
          ],
        ],
      };

      if (messageId) {
        await this.safeEditMessage(confirmationMessage, {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, confirmationMessage, {
          reply_markup: keyboard,
        });
      }
    } catch (error) {
      Logger.error('Error showing delete confirmation', {
        userId,
        username,
        habitId,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleHabitDeleteConfirmCallback(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number,
    username?: string
  ): Promise<void> {
    await this.deleteHabit(userId, chatId, habitId, messageId, username);
  }

  private async handleHabitListCallback(
    userId: number,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    await this.showHabitsList(userId, chatId, messageId);
  }

  // Add this helper method to the TelegramBotService class
  private async safeEditMessage(
    text: string,
    options: TelegramBot.EditMessageTextOptions
  ): Promise<void> {
    try {
      await this.bot.editMessageText(text, options);
    } catch (error: any) {
      // Ignore "message is not modified" error - it means the message is already correct
      if (error?.response?.body?.description?.includes('message is not modified')) {
        Logger.debug('Message not modified, skipping edit', {
          chatId: options.chat_id,
          messageId: options.message_id,
        });
        return;
      }
      // Re-throw other errors
      throw error;
    }
  }
}

