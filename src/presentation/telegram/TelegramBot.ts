import TelegramBot from 'node-telegram-bot-api';
import { CreateHabitUseCase } from '../../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../../domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from '../../domain/use-cases/SetHabitReminderScheduleUseCase';
import { CheckHabitReminderDueUseCase } from '../../domain/use-cases/CheckHabitReminderDueUseCase';
import { SetUserPreferencesUseCase } from '../../domain/use-cases/SetUserPreferencesUseCase';
import { VercelKVHabitRepository } from '../../infrastructure/repositories/VercelKVHabitRepository';
import { Habit } from '../../domain/entities/Habit';
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
  private setHabitReminderScheduleUseCase: SetHabitReminderScheduleUseCase | null = null;
  private checkReminderDue: CheckHabitReminderDueUseCase;
  private setUserPreferencesUseCase: SetUserPreferencesUseCase;

  constructor(
    token: string,
    createHabitUseCase: CreateHabitUseCase,
    getUserHabitsUseCase: GetUserHabitsUseCase,
    recordHabitCheckUseCase: RecordHabitCheckUseCase,
    deleteHabitUseCase: DeleteHabitUseCase,
    getHabitsToCheckUseCase: GetHabitsToCheckUseCase,
    usePolling: boolean = false,
    setHabitReminderScheduleUseCase?: SetHabitReminderScheduleUseCase
  ) {
    this.bot = new TelegramBot(token, { polling: usePolling });
    console.log(`Bot initialized (polling: ${usePolling}) - Process: ${process.env.NODE_ENV || 'development'}`);
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
    this.setHabitReminderScheduleUseCase = setHabitReminderScheduleUseCase || null;
    this.checkReminderDue = new CheckHabitReminderDueUseCase();
    // Create user preferences use case internally (repository is lightweight)
    const habitRepository = new VercelKVHabitRepository();
    this.setUserPreferencesUseCase = new SetUserPreferencesUseCase(habitRepository);
    
    // Set bot commands menu
    this.setupBotCommands();
  }

  private async setupBotCommands(): Promise<void> {
    try {
      await this.bot.setMyCommands([
        {
          command: 'newhabit',
          description: 'Create a new habit to track',
        },
        {
          command: 'myhabits',
          description: 'View all your habits',
        },
      ]);
      Logger.info('Bot commands menu set successfully');
    } catch (error) {
      Logger.error('Error setting bot commands', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  setupHandlers(): void {
    // When polling is enabled, we need to listen to bot events and route them to processUpdate()
    // When webhook mode is used, updates come via processUpdate() directly from the API route
    
    // Listen for messages (commands and text)
    this.bot.on('message', (msg: TelegramBot.Message) => {
      Logger.debug('Message event received', {
        messageId: msg.message_id,
        text: msg.text,
        chatId: msg.chat.id,
      });
      const update: TelegramBot.Update = {
        update_id: Date.now(), // Temporary ID, will be replaced by actual update
        message: msg,
      };
      this.processUpdate(update).catch(error => {
        Logger.error('Error processing message update', {
          error: error instanceof Error ? error.message : 'Unknown error',
          messageId: msg.message_id,
        });
      });
    });

    // Listen for callback queries (button clicks)
    this.bot.on('callback_query', (query: TelegramBot.CallbackQuery) => {
      Logger.debug('Callback query event received', {
        queryId: query.id,
        data: query.data,
      });
      const update: TelegramBot.Update = {
        update_id: Date.now(), // Temporary ID, will be replaced by actual update
        callback_query: query,
      };
      this.processUpdate(update).catch(error => {
        Logger.error('Error processing callback query update', {
          error: error instanceof Error ? error.message : 'Unknown error',
          queryId: query.id,
        });
      });
    });

    Logger.info('Bot handlers set up for polling mode - listening for messages and callback queries');
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
        inline_keyboard: habits.map(habit => {
          const skippedCount = (habit.skipped || []).length;
          return [
            {
              text: `${habit.name} (🔥 ${habit.streak}, ⏭️ ${skippedCount})`,
              callback_data: `habit_view:${habit.id}`,
            },
          ];
        }),
      };

      // Build message with skipped dates
      let message = '📋 Your Habits:\n\n';
      habits.forEach((habit, index) => {
        const skippedCount = (habit.skipped || []).length;
        message += `${index + 1}. ${habit.name}\n`;
        message += `   🔥 Streak: ${habit.streak} days\n`;
        message += `   ⏭️ Skipped: ${skippedCount} day${skippedCount !== 1 ? 's' : ''}\n`;
        if (skippedCount > 0) {
          // Format and show skipped dates
          const skippedDates = (habit.skipped || [])
            .map(s => {
              const date = new Date(s.date);
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            })
            .join(', ');
          message += `   📅 Skipped on: ${skippedDates}\n`;
        }
        message += '\n';
      });
      message += 'Click on a habit to view details or delete it.';
      
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
      
      // Get user's timezone for default schedule display
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';
      
      const schedule = habit.reminderSchedule || {
        type: 'daily' as const,
        hour: 22,
        minute: 0,
        timezone: userTimezone,
      };
      const scheduleDesc = this.checkReminderDue.getScheduleDescription(schedule);
      const reminderStatus = habit.reminderEnabled !== false ? '✅ Enabled' : '❌ Disabled';
      
      const message = `📋 Habit Details\n\n` +
        `Name: ${habit.name}\n` +
        `🔥 Streak: ${habit.streak} days\n` +
        `⏭️ Skipped days: ${skippedCount}\n` +
        `⏰ Reminder: ${scheduleDesc} (${reminderStatus})\n` +
        `📅 Last checked: ${habit.lastCheckedDate || 'Never'}\n` +
        `📆 Created: ${new Date(habit.createdAt).toLocaleDateString()}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '⏰ Set Reminder Schedule', callback_data: `habit_set_schedule:${habit.id}` },
          ],
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

  async sendHabitReminders(userId: number, habits: Habit[]): Promise<void> {
    try {
      Logger.info('Sending habit reminders', { 
        userId, 
        habitCount: habits.length,
        habitIds: habits.map(h => h.id),
      });
      
      if (habits.length === 0) {
        Logger.info('No habits to remind', { userId });
        return;
      }

      // Send reminders for each habit individually
      for (const habit of habits) {
        await this.sendSingleHabitReminder(userId, habit);
      }
      
      Logger.info('Habit reminders sent successfully', { userId });
    } catch (error) {
      Logger.error('Error sending habit reminders', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  private async sendSingleHabitReminder(userId: number, habit: Habit): Promise<void> {
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
      userId,
      `⏰ Reminder: Did you "${habit.name}" today?`,
      {
        reply_markup: keyboard,
      }
    );
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
      
      console.log('wwwww', update);
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
        
        // Handle schedule input (for both new habits and updating existing ones)
        if (conversationState && (conversationState.startsWith('set_schedule:') || conversationState.startsWith('setting_schedule_new:')) && !text.match(/^\//)) {
          await this.handleScheduleInput(chatId, userId, username, text, conversationState);
          return;
        }
        
        // Handle /start command
        if (text.match(/^\/start/)) {
          console.log('WWWWWW');
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

    if (!userId) {
      Logger.warn('Unable to identify user for start command', { chatId });
      await this.bot.sendMessage(chatId, 'Unable to identify user.');
      return;
    }

    try {
      // Check if user has accepted consent
      const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      
      if (!preferences || !preferences.consentAccepted) {
        // Show consent message first
        await this.showConsentMessage(chatId, userId);
        return;
      }
      
      // Check if user has set their timezone
      if (!preferences.timezone) {
        // Show timezone selection
        await this.showTimezoneSelection(chatId, userId);
        return;
      }

      // User has consent and timezone set, show welcome message
      Logger.info('Sending welcome message', { chatId });
      const sentMessage = await this.bot.sendMessage(
        chatId,
        '✨ _Choose what is best, and habit will make it pleasant and easy._ ✨\n' +
        '— Plutarch\n\n' +
        '*Welcome to Habits Tracker! 🎯*\n\n' +
        'Commands:\n' +
        '/newhabit - Create a new habit\n\n' +
        '/myhabits - View all your habits\n\n' +
        'The bot will remind you daily to check your habits! ⏰\n\n',
        { parse_mode: 'Markdown' }
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

  private async showConsentMessage(chatId: number, userId: number): Promise<void> {
    const consentMessage = 
      '📋 *Privacy Policy & Terms of Service*\n\n' +
      'Before using Habits Tracker, please review and accept our policies:\n\n' +
      '🔒 *Data Collection*\n' +
      '• We store your habit data (names, streaks, completion dates)\n' +
      '• We store your timezone preference for accurate reminders\n' +
      '• We store conversation state temporarily during multi-step interactions\n' +
      '• All data is stored securely in our database\n\n' +
      '📱 *How We Use Your Data*\n' +
      '• To send you habit reminders at your preferred times\n' +
      '• To track your habit streaks and progress\n' +
      '• To provide you with habit management features\n' +
      '• We do not share your data with third parties\n\n' +
      '⚙️ *Your Rights*\n' +
      '• You can delete your habits at any time\n' +
      '• You can stop using the bot at any time\n' +
      '• Your data is associated only with your Telegram user ID\n\n' +
      '📝 *Terms*\n' +
      '• This bot is provided "as is" without warranties\n' +
      '• We reserve the right to update these policies\n' +
      '• Continued use implies acceptance of any policy changes\n\n' +
      'By clicking "✅ I Accept", you agree to our Privacy Policy and Terms of Service.';

    const keyboard = {
      inline_keyboard: [
        [
          { text: '✅ I Accept', callback_data: 'consent_accept' },
          { text: '❌ Decline', callback_data: 'consent_decline' },
        ],
      ],
    };

    await this.bot.sendMessage(chatId, consentMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard,
    });
  }

  private async showTimezoneSelection(chatId: number, userId: number): Promise<void> {
    // 24 unique timezones covering all UTC offsets from -12 to +12
    const timezones = [
      // UTC-12:00 to UTC-01:00
      { text: '🌴 Baker Island (BIT)', tz: 'Pacific/Baker_Island' }, // UTC-12:00
      { text: '🏝️ Niue (NUT)', tz: 'Pacific/Niue' }, // UTC-11:00
      { text: '🌺 Hawaii (HST)', tz: 'Pacific/Honolulu' }, // UTC-10:00
      { text: '🏔️ Alaska (AKST)', tz: 'America/Anchorage' }, // UTC-09:00
      { text: '🌴 Los Angeles (PST)', tz: 'America/Los_Angeles' }, // UTC-08:00
      { text: '⛰️ Denver (MST)', tz: 'America/Denver' }, // UTC-07:00
      { text: '🏙️ Chicago (CST)', tz: 'America/Chicago' }, // UTC-06:00
      { text: '🗽 New York (EST)', tz: 'America/New_York' }, // UTC-05:00
      { text: '🌊 Halifax (AST)', tz: 'America/Halifax' }, // UTC-04:00
      { text: '🇧🇷 São Paulo (BRT)', tz: 'America/Sao_Paulo' }, // UTC-03:00
      { text: '🏔️ South Georgia (GST)', tz: 'Atlantic/South_Georgia' }, // UTC-02:00
      { text: '🏝️ Cape Verde (CVT)', tz: 'Atlantic/Cape_Verde' }, // UTC-01:00
      // UTC±00:00 to UTC+12:00
      { text: '🇬🇧 London (GMT)', tz: 'Europe/London' }, // UTC±00:00
      { text: '🇫🇷 Paris (CET)', tz: 'Europe/Paris' }, // UTC+01:00
      { text: '🇺🇦 Kyiv (EET)', tz: 'Europe/Kyiv' }, // UTC+02:00
      { text: '🇷🇺 Moscow (MSK)', tz: 'Europe/Moscow' }, // UTC+03:00
      { text: '🇦🇪 Dubai (GST)', tz: 'Asia/Dubai' }, // UTC+04:00
      { text: '🇵🇰 Karachi (PKT)', tz: 'Asia/Karachi' }, // UTC+05:00
      { text: '🇮🇳 Mumbai (IST)', tz: 'Asia/Kolkata' }, // UTC+05:30
      { text: '🇧🇩 Dhaka (BST)', tz: 'Asia/Dhaka' }, // UTC+06:00
      { text: '🇹🇭 Bangkok (ICT)', tz: 'Asia/Bangkok' }, // UTC+07:00
      { text: '🇨🇳 Shanghai (CST)', tz: 'Asia/Shanghai' }, // UTC+08:00
      { text: '🇯🇵 Tokyo (JST)', tz: 'Asia/Tokyo' }, // UTC+09:00
      { text: '🇦🇺 Sydney (AEST)', tz: 'Australia/Sydney' }, // UTC+10:00
      { text: '🏝️ Solomon Islands (SBT)', tz: 'Pacific/Guadalcanal' }, // UTC+11:00
      { text: '🇳🇿 Auckland (NZST)', tz: 'Pacific/Auckland' }, // UTC+12:00
    ];

    // Create keyboard with timezone buttons (2 columns)
    const keyboard = {
      inline_keyboard: [] as any[][],
    };

    for (let i = 0; i < timezones.length; i += 2) {
      const row = [timezones[i]];
      if (i + 1 < timezones.length) {
        row.push(timezones[i + 1]);
      }
      keyboard.inline_keyboard.push(
        row.map(tz => ({
          text: tz.text,
          callback_data: `timezone_select:${tz.tz}`,
        }))
      );
    }

    await this.bot.sendMessage(
      chatId,
      '🌍 *Welcome to Habits Tracker!*\n\n' +
      'First, please select your timezone so we can send reminders at the right time for you.\n\n' +
      'You can change this later in settings.',
      {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      }
    );
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

  private async handleScheduleInput(
    chatId: number,
    userId: number,
    username: string,
    scheduleInput: string,
    conversationState: string
  ): Promise<void> {
    try {
      // Parse conversation state: set_schedule:habitId:scheduleType or setting_schedule_new:habitId:scheduleType
      const match = conversationState.match(/^(?:set_schedule|setting_schedule_new):(.+):(.+)$/);
      if (!match) {
        await this.bot.sendMessage(chatId, 'Invalid conversation state. Please try again.');
        await this.clearConversationState(userId);
        return;
      }

      const habitId = match[1];
      const scheduleType = match[2];
      const isNewHabit = conversationState.startsWith('setting_schedule_new:');

      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, 'Schedule management is not available.');
        await this.clearConversationState(userId);
        return;
      }

      // Parse simplified input based on schedule type
      let fullInput = scheduleInput.trim();
      
      // Construct full schedule string based on type
      switch (scheduleType) {
        case 'daily':
          // Input: "20:30" → "daily 20:30"
          if (!fullInput.match(/^\d{1,2}:\d{2}$/)) {
            throw new Error('Invalid time format. Use HH:MM (e.g., 20:30)');
          }
          fullInput = `daily ${fullInput}`;
          break;
          
        case 'weekly':
          // Input: "monday 15:48" or "tuesday,saturday 18:00" → "weekly monday 15:48"
          const weeklyMatch = fullInput.match(/^([a-z,]+)\s+(\d{1,2}:\d{2})$/i);
          if (!weeklyMatch) {
            throw new Error('Invalid format. Use: day1,day2 HH:MM (e.g., monday 15:48 or tuesday,saturday 18:00)');
          }
          fullInput = `weekly ${fullInput}`;
          break;
          
        case 'monthly':
          // Input: "15 15:42" or "20,26 22:00" → "monthly 15 15:42"
          const monthlyMatch = fullInput.match(/^(\d{1,2}(?:,\d{1,2})*)\s+(\d{1,2}:\d{2})$/);
          if (!monthlyMatch) {
            throw new Error('Invalid format. Use: day1,day2 HH:MM (e.g., 15 15:42 or 20,26 22:00)');
          }
          fullInput = `monthly ${fullInput}`;
          break;
          
        case 'interval':
          // Input: "2 15:30" → "interval 2 15:30"
          const intervalMatch = fullInput.match(/^(\d+)\s+(\d{1,2}:\d{2})$/);
          if (!intervalMatch) {
            throw new Error('Invalid format. Use: N HH:MM (e.g., 2 15:30)');
          }
          fullInput = `interval ${fullInput}`;
          break;
          
        default:
          // Fallback: try to prepend schedule type if not present
          if (!fullInput.toLowerCase().startsWith(scheduleType.toLowerCase())) {
            fullInput = `${scheduleType} ${fullInput}`;
          }
      }

      // Get user's timezone preference
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      const schedule = this.setHabitReminderScheduleUseCase.parseSchedule(fullInput, userTimezone);
      const updatedHabit = await this.setHabitReminderScheduleUseCase.execute(userId, habitId, schedule);
      const scheduleDesc = this.checkReminderDue.getScheduleDescription(schedule);

      const completionMessage = isNewHabit
        ? `✅ Habit "${updatedHabit.name}" is ready!\n\n` +
          `Schedule: ${scheduleDesc}\n\n` +
          `View all your habits with /myhabits`
        : `✅ Reminder schedule updated!\n\n` +
          `Habit: ${updatedHabit.name}\n` +
          `Schedule: ${scheduleDesc}`;

      await this.bot.sendMessage(chatId, completionMessage);

      await this.clearConversationState(userId);

      // For new habits, don't show habit details - just confirm creation
      // For existing habits, show updated details
      if (!isNewHabit) {
        setTimeout(() => {
          this.showHabitDetails(userId, chatId, habitId);
        }, 1500);
      }
    } catch (error) {
      Logger.error('Error processing schedule input', {
        userId,
        username,
        scheduleInput,
        conversationState,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(
        chatId,
        `❌ Error setting schedule: ${error instanceof Error ? error.message : 'Unknown error'}\n\n` +
        `Please try again or use the buttons.`
      );
    }
  }

  private async handleConsentAcceptance(
    userId: number,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    try {
      await this.setUserPreferencesUseCase.setConsent(userId, true);
      
      await this.safeEditMessage(
        '✅ *Thank you for accepting our Privacy Policy and Terms of Service!*\n\n' +
        'Now let\'s set up your timezone to ensure reminders arrive at the right time.',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );

      // Proceed to timezone selection
      setTimeout(() => {
        this.showTimezoneSelection(chatId, userId);
      }, 1000);

      Logger.info('User accepted consent', { userId });
    } catch (error) {
      Logger.error('Error accepting consent', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleConsentDecline(
    userId: number,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    try {
      await this.setUserPreferencesUseCase.setConsent(userId, false);
      
      await this.safeEditMessage(
        '❌ *Consent Declined*\n\n' +
        'We\'re sorry, but we cannot provide our services without your consent to our Privacy Policy and Terms of Service.\n\n' +
        'If you change your mind, you can start the bot again with /start and accept the policies.',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );

      Logger.info('User declined consent', { userId });
    } catch (error) {
      Logger.error('Error declining consent', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleTimezoneSelection(
    userId: number,
    chatId: number,
    timezone: string,
    messageId?: number
  ): Promise<void> {
    try {
      await this.setUserPreferencesUseCase.setTimezone(userId, timezone);
      
      const timezoneName = timezone.split('/').pop()?.replace(/_/g, ' ') || timezone;
      
      await this.safeEditMessage(
        `✅ Timezone set to ${timezoneName}\n\n` +
        '✨ _Choose what is best, and habit will make it pleasant and easy._ ✨\n' +
        '— Plutarch\n\n' +
        '*Welcome to Habits Tracker! 🎯*\n\n' +
        'Commands:\n' +
        '/newhabit - Create a new habit\n\n' +
        '/myhabits - View all your habits\n\n' +
        'The bot will remind you daily to check your habits! ⏰\n\n',
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
        }
      );

      Logger.info('User timezone set', { userId, timezone });
    } catch (error) {
      Logger.error('Error setting timezone', {
        userId,
        timezone,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error setting timezone: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleScheduleSkipNew(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, 'Habit not found.');
        await this.clearConversationState(userId);
        return;
      }

      // Get user's timezone for display
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';
      const timezoneName = userTimezone.split('/').pop()?.replace(/_/g, ' ') || userTimezone;

      const scheduleDesc = this.checkReminderDue.getScheduleDescription(
        habit.reminderSchedule || { type: 'daily', hour: 22, minute: 0, timezone: userTimezone }
      );

      await this.safeEditMessage(
        `✅ Habit "${habit.name}" is ready!\n\n` +
        `Schedule: ${scheduleDesc} (default)\n\n` +
        `View all your habits with /myhabits`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      await this.clearConversationState(userId);
    } catch (error) {
      Logger.error('Error skipping schedule for new habit', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleHabitNameInput(chatId: number, userId: number, username: string, habitName: string): Promise<void> {
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
      
      // Ask for schedule configuration
      await this.askForScheduleDuringCreation(chatId, userId, habit.id, habit.name);
    } catch (error) {
      Logger.error('Error creating habit', {
        userId,
        username,
        chatId,
        habitName: trimmedName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error creating habit: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await this.clearConversationState(userId);
    }
  }

  private async askForScheduleDuringCreation(chatId: number, userId: number, habitId: string, habitName: string): Promise<void> {
    // Set conversation state for schedule configuration during creation
    await this.setConversationState(userId, `setting_schedule_new:${habitId}`);
    
    // Get user's timezone for display
    const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
    const userTimezone = userPreferences?.timezone || 'UTC';
    const timezoneName = userTimezone.split('/').pop()?.replace(/_/g, ' ') || userTimezone;
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: '📅 Daily', callback_data: `schedule_type_new:${habitId}:daily` },
          { text: '📆 Weekly', callback_data: `schedule_type_new:${habitId}:weekly` },
        ],
        [
          { text: '🗓️ Monthly', callback_data: `schedule_type_new:${habitId}:monthly` },
          { text: '⏱️ Interval', callback_data: `schedule_type_new:${habitId}:interval` },
        ],
        [
          { text: '⏭️ Skip (use default)', callback_data: `schedule_skip_new:${habitId}` },
        ],
      ],
    };

    await this.bot.sendMessage(
      chatId,
      `✅ Habit "${habitName}" created!\n\n` +
      `⏰ Now set up your reminder schedule:\n\n` +
      `Choose a schedule type or skip to use the default (daily at 22:00 ${timezoneName}).`,
      {
        reply_markup: keyboard,
      }
    );
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

    // Handle habit set schedule (show schedule options)
    const setScheduleMatch = data.match(/^habit_set_schedule:(.+)$/);
    if (setScheduleMatch) {
      await this.handleSetScheduleCallback(userId, chatId, setScheduleMatch[1], query.message?.message_id);
      return;
    }

    // Handle schedule type selection for new habits
    const scheduleTypeNewMatch = data.match(/^schedule_type_new:(.+):(.+)$/);
    if (scheduleTypeNewMatch) {
      await this.handleScheduleTypeCallback(userId, chatId, scheduleTypeNewMatch[1], scheduleTypeNewMatch[2], query.message?.message_id, true);
      return;
    }

    // Handle schedule skip for new habits
    const scheduleSkipNewMatch = data.match(/^schedule_skip_new:(.+)$/);
    if (scheduleSkipNewMatch) {
      await this.handleScheduleSkipNew(userId, chatId, scheduleSkipNewMatch[1], query.message?.message_id);
      return;
    }

    // Handle schedule type selection (for updating existing habits)
    const scheduleTypeMatch = data.match(/^schedule_type:(.+):(.+)$/);
    if (scheduleTypeMatch) {
      await this.handleScheduleTypeCallback(userId, chatId, scheduleTypeMatch[1], scheduleTypeMatch[2], query.message?.message_id, false);
      return;
    }

    // Handle quick schedule selection (for weekly schedules with long callback_data)
    const scheduleQuickMatch = data.match(/^schedule_quick:(.+):(\d+)$/);
    if (scheduleQuickMatch) {
      await this.handleScheduleQuickCallback(userId, chatId, scheduleQuickMatch[1], parseInt(scheduleQuickMatch[2], 10), query.message?.message_id);
      return;
    }

    // Handle schedule confirmation
    const scheduleConfirmMatch = data.match(/^schedule_confirm:(.+):(.+)$/);
    if (scheduleConfirmMatch) {
      await this.handleScheduleConfirmCallback(userId, chatId, scheduleConfirmMatch[1], scheduleConfirmMatch[2], query.message?.message_id);
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

    // Handle consent acceptance/rejection
    if (data === 'consent_accept') {
      await this.handleConsentAcceptance(userId, chatId, query.message?.message_id);
      return;
    }

    if (data === 'consent_decline') {
      await this.handleConsentDecline(userId, chatId, query.message?.message_id);
      return;
    }

    // Handle timezone selection
    const timezoneMatch = data.match(/^timezone_select:(.+)$/);
    if (timezoneMatch) {
      await this.handleTimezoneSelection(userId, chatId, timezoneMatch[1], query.message?.message_id);
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

      // Note: We don't ask about other habits here because each habit has its own reminder schedule
      // Users will receive separate reminders for each habit at their scheduled times
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

      // Note: We don't ask about other habits here because each habit has its own reminder schedule
      // Users will receive separate reminders for each habit at their scheduled times
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

  private async handleSetScheduleCallback(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, 'Habit not found.');
        return;
      }

      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, 'Schedule management is not available. Please contact support.');
        return;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: '📅 Daily', callback_data: `schedule_type:${habitId}:daily` },
            { text: '📆 Weekly', callback_data: `schedule_type:${habitId}:weekly` },
          ],
          [
            { text: '🗓️ Monthly', callback_data: `schedule_type:${habitId}:monthly` },
            { text: '⏱️ Interval', callback_data: `schedule_type:${habitId}:interval` },
          ],
          [
            { text: '← Back', callback_data: `habit_view:${habitId}` },
          ],
        ],
      };

      // Get user's timezone for default schedule display
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';
      
      await this.safeEditMessage(
        `⏰ Set Reminder Schedule for "${habit.name}"\n\n` +
        `Current: ${this.checkReminderDue.getScheduleDescription(habit.reminderSchedule || { type: 'daily', hour: 22, minute: 0, timezone: userTimezone })}\n\n` +
        `Choose a schedule type:`,
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      Logger.error('Error showing schedule options', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleScheduleTypeCallback(
    userId: number,
    chatId: number,
    habitId: string,
    scheduleType: string,
    messageId?: number,
    isNewHabit: boolean = false
  ): Promise<void> {
    try {
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit || !this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, 'Error: Habit not found or schedule management unavailable.');
        return;
      }

      let message = `⏰ Set ${scheduleType.charAt(0).toUpperCase() + scheduleType.slice(1)} Schedule\n\n`;
      let keyboard: any;

      switch (scheduleType) {
        case 'daily':
          message += 'Enter the time for daily reminders.\n\n' +
            'Examples:\n' +
            '• 20:30 - Every day at 8:30 PM\n' +
            '• 09:00 - Every day at 9:00 AM\n\n' +
            '📝 Reply with: HH:MM';
          break;

        case 'weekly':
          message += 'Enter days and time for weekly reminders.\n\n' +
            'Examples:\n' +
            '• monday 18:00 - Every Monday at 6 PM\n' +
            '• tuesday,saturday 20:00 - Every Tuesday and Saturday at 8 PM\n' +
            '• monday,wednesday,friday 08:00 - Mon/Wed/Fri at 8 AM\n\n' +
            'Days: sunday, monday, tuesday, wednesday, thursday, friday, saturday\n\n' +
            '📝 Reply with: day1,day2 HH:MM';
          break;

        case 'monthly':
          message += 'Enter day(s) of month and time for monthly reminders.\n\n' +
            'Examples:\n' +
            '• 15 15:42 - 15th of each month at 3:42 PM\n' +
            '• 20,26 22:00 - 20th and 26th at 10 PM\n' +
            '• 1,15 09:00 - 1st and 15th at 9 AM\n\n' +
            '📝 Reply with: day1,day2 HH:MM';
          break;

        case 'interval':
          message += 'Enter number of days and time for interval reminders.\n\n' +
            'Examples:\n' +
            '• 2 15:30 - Every 2 days at 3:30 PM\n' +
            '• 3 09:00 - Every 3 days at 9 AM\n' +
            '• 5 20:00 - Every 5 days at 8 PM\n\n' +
            '📝 Reply with: N HH:MM';
          break;

        default:
          await this.bot.sendMessage(chatId, 'Unknown schedule type.');
          return;
      }

      keyboard = {
        inline_keyboard: [
          [
            { text: '← Back', callback_data: isNewHabit ? `schedule_skip_new:${habitId}` : `habit_set_schedule:${habitId}` },
          ],
        ],
      };

      await this.safeEditMessage(message, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboard,
      });

      // Set conversation state to wait for schedule input
      const statePrefix = isNewHabit ? 'setting_schedule_new' : 'set_schedule';
      await this.setConversationState(userId, `${statePrefix}:${habitId}:${scheduleType}`);
      
      // Update back button for new habits
      if (isNewHabit && keyboard) {
        keyboard.inline_keyboard = keyboard.inline_keyboard || [];
        // Replace back button with skip button
        const backButtonIndex = keyboard.inline_keyboard.findIndex((row: any[]) => 
          row.some((btn: any) => btn.callback_data?.includes('Back'))
        );
        if (backButtonIndex >= 0) {
          keyboard.inline_keyboard[backButtonIndex] = [
            { text: '⏭️ Skip (use default)', callback_data: `schedule_skip_new:${habitId}` },
          ];
        } else {
          keyboard.inline_keyboard.push([
            { text: '⏭️ Skip (use default)', callback_data: `schedule_skip_new:${habitId}` },
          ]);
        }
      }
    } catch (error) {
      Logger.error('Error handling schedule type', {
        userId,
        habitId,
        scheduleType,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleScheduleQuickCallback(
    userId: number,
    chatId: number,
    habitId: string,
    scheduleIndex: number,
    messageId?: number
  ): Promise<void> {
    try {
      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, 'Schedule management is not available.');
        return;
      }

      // Retrieve stored quick schedules from conversation state
      const conversationState = await this.getConversationState(userId);
      if (!conversationState || !conversationState.startsWith(`schedule_quick:${habitId}:`)) {
        await this.bot.sendMessage(chatId, 'Schedule options expired. Please try again.');
        return;
      }

      // Parse the stored schedules
      const schedulesJson = conversationState.replace(`schedule_quick:${habitId}:`, '');
      const quickSchedules: Array<{ text: string; schedule: string }> = JSON.parse(schedulesJson);

      if (scheduleIndex < 0 || scheduleIndex >= quickSchedules.length) {
        await this.bot.sendMessage(chatId, 'Invalid schedule selection.');
        return;
      }

      // Get user's timezone preference
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      const selectedSchedule = quickSchedules[scheduleIndex].schedule;
      const schedule = this.setHabitReminderScheduleUseCase.parseSchedule(selectedSchedule, userTimezone);
      const updatedHabit = await this.setHabitReminderScheduleUseCase.execute(userId, habitId, schedule);
      const scheduleDesc = this.checkReminderDue.getScheduleDescription(schedule);

      await this.safeEditMessage(
        `✅ Reminder schedule updated!\n\n` +
        `Habit: ${updatedHabit.name}\n` +
        `Schedule: ${scheduleDesc}`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      // Clear conversation state
      await this.clearConversationState(userId);

      // Show updated habit details
      setTimeout(() => {
        this.showHabitDetails(userId, chatId, habitId);
      }, 1500);
    } catch (error) {
      Logger.error('Error confirming quick schedule', {
        userId,
        habitId,
        scheduleIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleScheduleConfirmCallback(
    userId: number,
    chatId: number,
    habitId: string,
    scheduleInput: string,
    messageId?: number
  ): Promise<void> {
    try {
      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, 'Schedule management is not available.');
        return;
      }

      // Get user's timezone preference
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      const schedule = this.setHabitReminderScheduleUseCase.parseSchedule(scheduleInput, userTimezone);
      const updatedHabit = await this.setHabitReminderScheduleUseCase.execute(userId, habitId, schedule);
      const scheduleDesc = this.checkReminderDue.getScheduleDescription(schedule);

      await this.safeEditMessage(
        `✅ Reminder schedule updated!\n\n` +
        `Habit: ${updatedHabit.name}\n` +
        `Schedule: ${scheduleDesc}`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      // Clear conversation state
      await this.clearConversationState(userId);

      // Show updated habit details
      setTimeout(() => {
        this.showHabitDetails(userId, chatId, habitId);
      }, 1500);
    } catch (error) {
      Logger.error('Error confirming schedule', {
        userId,
        habitId,
        scheduleInput,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

