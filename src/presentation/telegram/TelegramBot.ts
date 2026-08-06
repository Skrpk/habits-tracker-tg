import * as fs from 'fs';
import * as path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { CreateHabitUseCase } from '../../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../../domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from '../../domain/use-cases/SetHabitReminderScheduleUseCase';
import { CheckHabitReminderDueUseCase } from '../../domain/use-cases/CheckHabitReminderDueUseCase';
import { SetUserPreferencesUseCase } from '../../domain/use-cases/SetUserPreferencesUseCase';
import { ToggleHabitDisabledUseCase } from '../../domain/use-cases/ToggleHabitDisabledUseCase';
import { PostponeHabitReminderUseCase } from '../../domain/use-cases/PostponeHabitReminderUseCase';
import { ResumeRemindersUseCase } from '../../domain/use-cases/ResumeRemindersUseCase';
import { REMINDER_PAUSE_DAYS } from '../../domain/use-cases/EvaluateReminderPauseUseCase';
import { computePostponeTarget, localDay } from '../../domain/utils/postpone';
import { SubscriptionUseCase, userHasPremiumAccess } from '../../domain/use-cases/SubscriptionUseCase';
import { VercelKVHabitRepository } from '../../infrastructure/repositories/VercelKVHabitRepository';
import { Habit } from '../../domain/entities/Habit';
import { Logger } from '../../infrastructure/logger/Logger';
import { kv } from '../../infrastructure/config/kv';
import { isAdminUser } from '../../infrastructure/admin/parseAdminUsers';
import { buildTimezonePickerOptions, ALLOWED_TIMEZONE_IDS, formatLocalTime, formatUtcOffset, getUtcOffsetMinutes } from '../../constants/allowedTimezones';
import { QuoteManager } from '../../infrastructure/quotes/QuoteManager';
import {
  t,
  Language,
  SUPPORTED_LANGUAGES,
  isSupportedLanguage,
  languageNativeName,
  mapTelegramLangCode,
} from '../../i18n';
import OpenAI from 'openai';

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
  private toggleHabitDisabledUseCase: ToggleHabitDisabledUseCase;
  private postponeHabitReminderUseCase: PostponeHabitReminderUseCase;
  private resumeRemindersUseCase: ResumeRemindersUseCase;
  private subscriptionUseCase: SubscriptionUseCase;
  private quoteManager: QuoteManager;
  private openai: OpenAI | null = null;

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
    // this.bot = new TelegramBot(token, { polling: {
    //   params: {
    //   allowed_updates: [
    //     "message",
    //     "pre_checkout_query",  // 👈 must explicitly add this
    //     "callback_query",
    //   ],
    // },
    // } });
    this.bot = new TelegramBot(token, usePolling ? {
        polling: {
            params: {
                allowed_updates: [
                    "pre_checkout_query",
                    "message",
                    "callback_query",
                ],
            },
        },
    } : { polling: false });
    console.log(`Bot initialized (polling: ${usePolling}) - Process: ${process.env.NODE_ENV || 'development'}`);
    // Add error handlers for debugging
    this.bot.on('error', (error: Error) => {
      Logger.error('Telegram bot error', {
        message: error.message,
        stack: error.stack,
      });
    });

    this.bot.on("pre_checkout_query", async (query) => {
      console.log("pre_checkout_query received!", query); // add this to verify
      await this.bot.answerPreCheckoutQuery(query.id, true);
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
    this.toggleHabitDisabledUseCase = new ToggleHabitDisabledUseCase(habitRepository);
    this.postponeHabitReminderUseCase = new PostponeHabitReminderUseCase(habitRepository);
    this.resumeRemindersUseCase = new ResumeRemindersUseCase(habitRepository);
    this.subscriptionUseCase = new SubscriptionUseCase(habitRepository);
    this.quoteManager = new QuoteManager();
    
    // Initialize OpenAI if API key is available
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
    
    // Set bot commands menu
    this.setupBotCommands();
  }

  private async setupBotCommands(): Promise<void> {
    // Register the command menu once per supported language (Telegram scopes it by
    // the client's language_code). English ('en') doubles as the default scope so
    // clients in unsupported languages still get a menu. Keep this list in sync
    // with the /start welcome and the unhandled-message reply.
    const buildCommands = (lang: Language) => [
      { command: 'newhabit', description: t(lang, 'cmd.newhabit') },
      { command: 'myhabits', description: t(lang, 'cmd.myhabits') },
      { command: 'analytics', description: t(lang, 'cmd.analytics') },
      { command: 'settings', description: t(lang, 'cmd.settings') },
    ];

    try {
      // Default scope (no language_code) — fallback for any client language.
      await this.bot.setMyCommands(buildCommands('en'));
      // Per-language scopes.
      for (const { code } of SUPPORTED_LANGUAGES) {
        await this.bot.setMyCommands(buildCommands(code), { language_code: code });
      }
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);

      Logger.info('Showing habits list', {
        userId,
        chatId,
        habitCount: habits.length,
      });

      if (habits.length === 0) {
        const message = t(lang, 'habits.list.empty');
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
          const statusIcon = habit.disabled === true ? '⏸️' : '▶️';
          return [
            {
              text: `${statusIcon} ${habit.name} (🔥 ${habit.streak}, ⏭️ ${skippedCount})`,
              callback_data: `habit_view:${habit.id}`,
            },
          ];
        }),
      };

      // Build message with skipped dates
      let message = `${t(lang, 'habits.list.header')}\n\n`;
      habits.forEach((habit, index) => {
        const skippedCount = (habit.skipped || []).length;
        const statusText = habit.disabled === true ? t(lang, 'habits.status.disabled') : t(lang, 'habits.status.active');
        message += `${index + 1}. ${habit.name} (${statusText})\n`;
        message += `   ${t(lang, 'habits.list.streak', { streak: habit.streak })}\n`;
        message += `   ${t(lang, 'habits.list.skipped', { count: skippedCount })}\n`;
        if (skippedCount > 0) {
          // Format and show skipped dates
          const skippedDates = (habit.skipped || [])
            .map(s => {
              const date = new Date(s.date);
              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            })
            .join(', ');
          message += `   ${t(lang, 'habits.list.skipped_on', { dates: skippedDates })}\n`;
        }
        message += '\n';
      });
      message += t(lang, 'habits.list.footer');
      
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.safeAnswerCallbackQuery('', {
          text: t(lang, 'habits.not_found'),
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
      const reminderStatus = habit.reminderEnabled !== false ? t(lang, 'habits.reminder_on') : t(lang, 'habits.reminder_off');
      const disabledStatus = habit.disabled === true ? t(lang, 'habits.status.disabled') : t(lang, 'habits.status.active');

      // Format badges
      let badgesText = '';
      const badges = habit.badges || [];
      if (badges.length > 0) {
        const { getBadgeInfo } = await import('../../domain/utils/HabitBadges');
        const badgeEmojis = badges.map(b => getBadgeInfo(b.type).emoji).join(' ');
        badgesText = `\n${t(lang, 'habits.details.badges', { badges: badgeEmojis })}`;
      }

      const message = `${t(lang, 'habits.details.title')}\n\n` +
        `${t(lang, 'habits.details.name', { name: habit.name })}\n` +
        `${t(lang, 'habits.details.status', { status: disabledStatus })}\n` +
        `${t(lang, 'habits.details.streak', { streak: habit.streak })}${badgesText}\n` +
        `${t(lang, 'habits.details.skipped', { count: skippedCount })}\n` +
        `${t(lang, 'habits.details.reminder', { schedule: scheduleDesc, status: reminderStatus })}\n` +
        `${t(lang, 'habits.details.last_checked', { date: habit.lastCheckedDate || t(lang, 'habits.details.never') })}\n` +
        `${t(lang, 'habits.details.created', { date: new Date(habit.createdAt).toLocaleDateString() })}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: habit.disabled === true ? t(lang, 'btn.enable') : t(lang, 'btn.disable'), callback_data: `habit_toggle_disabled:${habit.id}` },
          ],
          [
            { text: t(lang, 'btn.set_schedule'), callback_data: `habit_set_schedule:${habit.id}` },
          ],
          [
            { text: t(lang, 'btn.delete'), callback_data: `habit_delete:${habit.id}` },
          ],
          [
            { text: t(lang, 'btn.back_to_list'), callback_data: 'habit_list' },
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

  private async handleHabitToggleDisabled(
    userId: number,
    chatId: number,
    habitId: string,
    callbackQueryId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const userHabits = await this.getUserHabitsUseCase.execute(userId);
      const habit = userHabits.find(h => h.id === habitId);

      // Premium disabled: enabling habits is free for everyone (no active-habit cap)
      // if (habit?.disabled) {
      //   const prefs = await this.setUserPreferencesUseCase.getPreferences(userId);
      //   if (!userHasPremiumAccess(prefs)) {
      //     const maxFree = parseInt(process.env.MAX_FREE_HABITS || '3', 10);
      //     const activeCount = userHabits.filter(h => !h.disabled).length;
      //     if (activeCount >= maxFree) {
      //       await this.bot.sendMessage(
      //         chatId,
      //         'Upgrade to Premium to enable more habits and more features. Tap below for the same flow as /subscribe.',
      //         {
      //           reply_markup: {
      //             inline_keyboard: [[{ text: 'Upgrade to Premium', callback_data: 'open_subscribe' }]],
      //           },
      //         }
      //       );
      //       return;
      //     }
      //   }
      // }

      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const isDisabled = await this.toggleHabitDisabledUseCase.execute(userId, habitId);
      await this.safeAnswerCallbackQuery(callbackQueryId, {
        text: isDisabled ? t(lang, 'habits.toast.disabled') : t(lang, 'habits.toast.enabled'),
        show_alert: false,
      });

      // Refresh the habit details view
      await this.showHabitDetails(userId, chatId, habitId, messageId);
    } catch (error) {
      Logger.error('Error toggling habit disabled state', {
        userId,
        habitId,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.safeAnswerCallbackQuery(callbackQueryId, {
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        show_alert: true,
      });
    }
  }

  private async deleteHabit(userId: number, chatId: number, habitId: string, messageId?: number, username?: string): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for deletion', { userId, username, habitId, chatId });
        await this.safeAnswerCallbackQuery('', {
          text: t(lang, 'habits.not_found'),
          show_alert: true,
        });
        return;
      }

      await this.deleteHabitUseCase.execute(userId, habitId, username, habit.name);

      const message = t(lang, 'habits.deleted', { name: habit.name });

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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habitsToCheck = await this.getHabitsToCheckUseCase.execute(userId);

      Logger.info('Checking habits for user', {
        userId,
        chatId,
        habitsToCheckCount: habitsToCheck.length,
        habitIds: habitsToCheck.map(h => h.id),
      });

      if (habitsToCheck.length === 0) {
        Logger.info('All habits already checked for today', { userId, chatId });
        await this.bot.sendMessage(chatId, t(lang, 'reminder.all_checked'));
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
            { text: t(lang, 'reminder.btn.yes'), callback_data: `habit_check:${habit.id}:yes` },
          ],
          [
            { text: t(lang, 'reminder.btn.no'), callback_data: `habit_check:${habit.id}:no` },
            { text: t(lang, 'reminder.btn.skip'), callback_data: `habit_check:${habit.id}:skip` },
          ],
        ],
      };

      await this.bot.sendMessage(
        chatId,
        t(lang, 'reminder.ask', { name: habit.name }),
        {
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Error checking habits', {
        userId,
        chatId,
        error: errorMessage,
      });
      
      await this.bot.sendMessage(chatId, `Error checking habits: ${errorMessage}`);
      
      // Send notification to channel
      await this.sendErrorNotification(userId, undefined, 'Error checking habits', errorMessage);
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

  /**
   * One-time heads-up that a habit's reminders were auto-paused, with a
   * "Resume now" button. Best-effort — swallows send failures (blocked user).
   */
  async sendPauseNotice(userId: number, habitName: string, habitId: string): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      await this.bot.sendMessage(
        userId,
        t(lang, 'reminder.paused_notice', { name: habitName, days: REMINDER_PAUSE_DAYS }),
        {
          reply_markup: {
            inline_keyboard: [[{ text: t(lang, 'reminder.btn.resume'), callback_data: `resume_reminders:${habitId}` }]],
          },
        }
      );
    } catch (error) {
      Logger.warn('Failed to send auto-pause notice', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Send each habit's reminder, returning the IDs that were successfully sent.
   * A single habit's failure no longer aborts the rest of the batch, and callers
   * use the returned IDs to persist per-habit state only for what actually shipped.
   */
  async sendHabitReminders(userId: number, habits: Habit[], targetDate: string): Promise<string[]> {
    const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
    const username = getUsername(preferences?.user);
    const lang = preferences?.language ?? mapTelegramLangCode(preferences?.user?.language_code);

    Logger.info('Sending habit reminders', {
      userId,
      username,
      habitCount: habits.length,
      habitIds: habits.map(h => h.id),
      targetDate,
    });

    if (habits.length === 0) {
      Logger.info('No habits to remind', { userId, username });
      return [];
    }

    const sentIds: string[] = [];
    for (const habit of habits) {
      Logger.info(`Sending reminder "${habit.name}" to user ${username} ${userId}`, {
        userId,
        username,
        habitId: habit.id,
        habitName: habit.name,
        targetDate,
      });
      try {
        await this.sendSingleHabitReminder(userId, habit, targetDate, preferences?.timezone || 'UTC', lang);
        sentIds.push(habit.id);
      } catch (error) {
        // sendSingleHabitReminder already logged, flagged blocked users, and
        // notified ops. Skip this habit but keep sending the rest of the batch.
        Logger.error('Habit reminder failed; continuing batch', {
          userId,
          habitId: habit.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    Logger.info('Habit reminders sent', { userId, username, sentCount: sentIds.length });
    return sentIds;
  }

  private async sendSingleHabitReminder(userId: number, habit: Habit, targetDate: string, userTimezone: string = 'UTC', lang: Language = 'en'): Promise<void> {
    const suffix = targetDate ? `:${targetDate}` : '';
    const reminderText = t(lang, 'reminder.ask', { name: habit.name });

    const baseRows: any[][] = [
      [
        { text: t(lang, 'reminder.btn.yes'), callback_data: `habit_check:${habit.id}:yes${suffix}` },
      ],
      [
        { text: t(lang, 'reminder.btn.no'), callback_data: `habit_check:${habit.id}:no${suffix}` },
        { text: t(lang, 'reminder.btn.skip'), callback_data: `habit_check:${habit.id}:skip${suffix}` },
      ],
    ];

    // Offer "Check later" only while a 1-hour postpone stays within today
    // (a 23:xx reminder can't be pushed without crossing midnight).
    if (targetDate && computePostponeTarget(new Date(), userTimezone) !== null) {
      baseRows.push([
        { text: t(lang, 'reminder.btn.later'), callback_data: `habit_postpone:${habit.id}:${targetDate}` },
      ]);
    }

    const keyboardWithoutMiniApp = { inline_keyboard: baseRows };

    try {
      // Clear any postpone that led here — this send satisfies it, and clearing
      // on every send also sweeps up stale flags from prior days.
      if (habit.postponedUntil) {
        await this.postponeHabitReminderUseCase.clearPostpone(userId, habit.id);
      }

      const sent = await this.bot.sendMessage(userId, reminderText, {
        reply_markup: keyboardWithoutMiniApp,
      });

      const chatId = sent.chat.id;
      const messageId = sent.message_id;
      const checkUrl = `https://habits-builder.com/check?habitId=${habit.id}` +
        (targetDate ? `&targetDate=${targetDate}` : '') +
        `&chatId=${chatId}&msgId=${messageId}`;

      const keyboardWithMiniApp = {
        inline_keyboard: [
          ...keyboardWithoutMiniApp.inline_keyboard,
          [
            { text: t(lang, 'reminder.btn.miniapp'), web_app: { url: checkUrl } },
          ],
        ],
      };

      await this.safeEditMessage(reminderText, {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: keyboardWithMiniApp,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      Logger.error('Error sending habit reminder', {
        userId,
        habitId: habit.id,
        habitName: habit.name,
        error: errorMessage,
      });

      // If user blocked the bot, mark as blocked so we skip reminders until they /start again
      if (errorMessage.toLowerCase().includes('bot was blocked by the user')) {
        await this.setUserPreferencesUseCase.setBlocked(userId, true);
      }
      
      // Send notification to channel
      await this.sendErrorNotification(userId, habit.name, 'Error sending habit reminder', errorMessage);
      throw error;
    }
  }

  /**
   * "Check later (in 1 hour)": strip the reminder's buttons, store a postpone,
   * and let the cron re-ask ~1h later (same day). If it's too late in the day to
   * postpone, keep the answer buttons so the user can still respond.
   */
  private async handleHabitPostpone(
    userId: number,
    chatId: number,
    habitId: string,
    targetDate: string,
    messageId?: number
  ): Promise<void> {
    try {
      const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const lang = preferences?.language ?? mapTelegramLangCode(preferences?.user?.language_code);

      const habit = await this.postponeHabitReminderUseCase.getHabit(userId, habitId);
      if (!habit) {
        await this.safeEditMessage(t(lang, 'reminder.habit_not_found'), { chat_id: chatId, message_id: messageId });
        return;
      }

      // Already answered for this day — nothing to postpone.
      if (habit.lastCheckedDate === targetDate) {
        await this.safeEditMessage(
          t(lang, 'reminder.already_recorded', { name: habit.name }),
          { chat_id: chatId, message_id: messageId }
        );
        return;
      }

      const userTimezone = preferences?.timezone || 'UTC';
      const now = new Date();

      // Stale button (tapped on a later day) or too late to postpone within today:
      // keep the answer buttons so the user can still respond now.
      const target = computePostponeTarget(now, userTimezone);
      if (localDay(now, userTimezone) !== targetDate || target === null) {
        const suffix = `:${targetDate}`;
        await this.safeEditMessage(
          t(lang, 'reminder.too_late', { name: habit.name }),
          {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: {
              inline_keyboard: [
                [{ text: t(lang, 'reminder.btn.yes'), callback_data: `habit_check:${habit.id}:yes${suffix}` }],
                [
                  { text: t(lang, 'reminder.btn.no'), callback_data: `habit_check:${habit.id}:no${suffix}` },
                  { text: t(lang, 'reminder.btn.skip'), callback_data: `habit_check:${habit.id}:skip${suffix}` },
                ],
              ],
            },
          }
        );
        return;
      }

      await this.postponeHabitReminderUseCase.setPostpone(userId, habitId, target);

      await this.safeEditMessage(
        t(lang, 'reminder.postponed', { name: habit.name, time: formatLocalTime(userTimezone, target) }),
        { chat_id: chatId, message_id: messageId }
      );

      Logger.info('Habit reminder postponed', {
        userId,
        habitId,
        targetDate,
        postponedUntil: target.toISOString(),
      });
    } catch (error) {
      Logger.error('Error postponing habit reminder', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /** "Resume now" on an auto-paused habit: clear the pause and confirm. */
  private async handleResumeReminders(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habit = await this.resumeRemindersUseCase.getHabit(userId, habitId);
      if (!habit) {
        await this.safeEditMessage(t(lang, 'habits.not_found'), { chat_id: chatId, message_id: messageId });
        return;
      }

      await this.resumeRemindersUseCase.resume(userId, habitId);

      await this.safeEditMessage(
        t(lang, 'reminder.resumed', { name: habit.name }),
        { chat_id: chatId, message_id: messageId }
      );
    } catch (error) {
      Logger.error('Error resuming reminders', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  getBot(): TelegramBot {
    return this.bot;
  }

  async processUpdate(update: TelegramBot.Update): Promise<void> {
    try {
      console.log('Processing update', update);
      Logger.debug('Processing update', {
        updateId: update.update_id,
        messageText: update.message?.text,
      });
      
      // Handle successful payment (before text check — payment messages may lack .text)
      if (update.message?.successful_payment) {
        const payment = update.message.successful_payment as { invoice_payload?: string; is_first_recurring?: boolean; is_recurring?: boolean };
        const userId = update.message.from?.id;
        const chatId = update.message.chat.id;
        if (userId) {
          if (payment.is_first_recurring) {
            await this.subscriptionUseCase.activateSubscription(userId, 'monthly');
            await this.bot.sendMessage(chatId,
              '🎉 *Welcome to Premium!*\n\nYour subscription is now active. You can now create unlimited habits! It will automatically renew every 30 days.',
              { parse_mode: 'Markdown' }
            );
          } else if (payment.is_recurring) {
            await this.subscriptionUseCase.extendSubscription(userId);
            await this.bot.sendMessage(chatId,
              '✅ *Subscription renewed!*\n\nYour Premium access has been extended for another 30 days.',
              { parse_mode: 'Markdown' }
            );
          } else {
            const payload = payment.invoice_payload || '';
            const isAnnual = payload.startsWith('sub_annual_');
            await this.subscriptionUseCase.activateSubscription(userId, isAnnual ? 'annual' : 'monthly');
            if (isAnnual) {
              await this.bot.sendMessage(chatId,
                '🎉 *Welcome to Premium!*\n\nYour subscription is now active for 1 year. You can create unlimited habits!',
                { parse_mode: 'Markdown' }
              );
            } else {
              await this.bot.sendMessage(chatId,
                '🎉 *Welcome to Premium!*\n\nYour subscription is now active. You can now create unlimited habits!',
                { parse_mode: 'Markdown' }
              );
            }
          }
        }
        return;
      }

      // Handle text messages (commands)
      if (update.message?.text) {
        const text = update.message.text;
        const msg = update.message;
        const chatId = msg.chat.id;
        const userId = msg.from?.id;
        const username = getUsername(msg.from);
        const user = msg.from;
        
        if (!userId) {
          Logger.warn('Message received without user ID', { chatId });
          return;
        }
        
        // Update user information in Redis if we have user data (async, don't block)
        if (user) {
          this.setUserPreferencesUseCase.updateUser(userId, user).catch(error => {
            Logger.error('Error updating user information', {
              userId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
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
          await this.handleStartCommand(chatId, userId, username, msg.from);
          return;
        }

        // Guard: require consent + timezone before any other command.
        // (Gated on consentAccepted, NOT language — legacy users have no stored
        // language and must not be re-blocked; they default to English.)
        const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
        if (!preferences || !preferences.consentAccepted || !preferences.timezone) {
          const guardLang = preferences?.language ?? mapTelegramLangCode(msg.from?.language_code);
          await this.bot.sendMessage(chatId, t(guardLang, 'setup.required'));
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
        
        // Handle /settings command
        if (text.match(/^\/settings/)) {
          await this.handleSettingsCommand(chatId, userId, username);
          return;
        }
        
        // Handle /analytics command
        if (text.match(/^\/analytics/)) {
          Logger.debug('Analytics command', { userId, username, chatId, text });
          await this.handleAnalyticsCommand(chatId, userId, username, msg.from);
          return;
        }

        // Handle /subscribe command
        // if (text.match(/^\/subscribe/)) {
        //   await this.handleSubscribeCommand(chatId, userId, username);
        //   return;
        // }
        
        // Handle /quote command (admin only, not registered in commands menu)
        if (text.match(/^\/quote/)) {
          await this.handleQuoteCommand(chatId, userId, username);
          return;
        }
        
        // Handle quote editing (conversation state)
        if (conversationState && conversationState.startsWith('quote_edit:') && !text.match(/^\//)) {
          await this.handleQuoteEditInput(chatId, userId, username, text, conversationState);
          return;
        }
        
        // Handle quote regenerate with custom prompt (conversation state)
        if (conversationState && conversationState.startsWith('quote_regenerate:') && !text.match(/^\//)) {
          await this.handleQuoteRegenerateInput(chatId, userId, username, text, conversationState);
          return;
        }
        
        // Unhandled text — reply with a friendly fallback + command list, and forward to ops channel
        Logger.info('Unhandled message received', {
          userId,
          chatId,
          textLength: text.length,
        });
        await this.sendUnhandledMessageReply(chatId, preferences.language ?? mapTelegramLangCode(msg.from?.language_code));
        void this.sendUnhandledMessageNotification(chatId, userId, username, text, msg.from);
        return;
      }
      
      // Handle callback queries
      if (update.callback_query) {
        const user = update.callback_query.from;
        const userId = user?.id;
        
        // Update user information in Redis if we have user data (async, don't block)
        if (userId && user) {
          this.setUserPreferencesUseCase.updateUser(userId, user).catch(error => {
            Logger.error('Error updating user information', {
              userId,
              error: error instanceof Error ? error.message : 'Unknown error',
            });
          });
        }
        
        // Acknowledge immediately (before any Redis reads) so the loading
        // spinner clears fast and the callback query can't expire mid-handler.
        await this.safeAnswerCallbackQuery(update.callback_query.id);

        const cbData = update.callback_query.data || '';
        const isOnboardingCallback = cbData.startsWith('language_') ||
                                      cbData.startsWith('timezone_') ||
                                      cbData.startsWith('tz_page:');

        if (!isOnboardingCallback && userId) {
          const cbPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
          if (!cbPreferences || !cbPreferences.consentAccepted || !cbPreferences.timezone) {
            // Query is already answered above, so send a normal message instead of an alert.
            const cbChatId = update.callback_query.message?.chat.id;
            if (cbChatId) {
              const guardLang = cbPreferences?.language ?? mapTelegramLangCode(user?.language_code);
              await this.bot.sendMessage(cbChatId, t(guardLang, 'setup.required'));
            }
            return;
          }
        }

        await this.handleCallbackQuery(update.callback_query);
        return;
      }
      
      // Handle pre-checkout queries (must respond within 10 seconds)
      if (update.pre_checkout_query) {
        try {
          console.log('WWWWWWWWW', update.pre_checkout_query);
          await this.bot.answerPreCheckoutQuery(update.pre_checkout_query.id, true);
        } catch (err) {
          try {
            await this.bot.answerPreCheckoutQuery(update.pre_checkout_query.id, false, { error_message: 'Something went wrong, please try again' } as any);
          } catch { /* ignore */ }
        }
        return;
      }

      // For other update types, use processUpdate
      await this.bot.processUpdate(update);
      
      Logger.debug('Update processed', { updateId: update.update_id });
    } catch (error) {
      // Swallow errors here so the webhook still returns 200. Telegram retries
      // the same update on a non-2xx response, which causes duplicate processing
      // and "query is too old" errors on the retried callback query.
      Logger.error('Error processing update', {
        updateId: update.update_id,
        error: error instanceof Error ? error.message : 'Unknown error',
        errorName: error instanceof Error ? error.name : undefined,
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  // Command handlers - extracted for clean manual handling
  private async handleStartCommand(chatId: number, userId: number | undefined, username: string, user?: TelegramBot.User): Promise<void> {
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
      // Read preferences BEFORE any write — setBlocked creates a record, which
      // would make every user look like a returning one below.
      const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);

      // User came back — clear blocked flag so they receive reminders again
      await this.setUserPreferencesUseCase.setBlocked(userId, false);

      // Send notification if this is a new user (no preferences exist)
      if (!preferences) {
        await this.sendNewUserNotification(userId, username, user);
        // Store user information for new users
        if (user) {
          await this.setUserPreferencesUseCase.updateUser(userId, user);
        }
      } else if (user) {
        // Update user information if it has changed
        await this.setUserPreferencesUseCase.updateUser(userId, user);
      }
      
      // Gate the language step on consent, NOT on `language`: choosing a language
      // records consent, so a user without consent hasn't onboarded. Legacy users
      // (consentAccepted from the old flow, no stored language) are NOT re-prompted
      // — they default to English and can switch in Settings (decision 2).
      if (!preferences || !preferences.consentAccepted) {
        await this.showLanguageSelection(chatId, userId, user);
        return;
      }

      const lang = preferences.language ?? mapTelegramLangCode(user?.language_code);

      // Check if user has set their timezone
      if (!preferences.timezone) {
        // Show timezone selection
        await this.showTimezoneSelection(chatId, userId, lang);
        return;
      }

      // User has completed onboarding — show welcome message
      Logger.info('Sending welcome message', { chatId });
      const sentMessage = await this.bot.sendMessage(
        chatId,
        t(lang, 'welcome'),
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

  private async sendNewUserNotification(
    userId: number,
    username: string,
    user?: TelegramBot.User
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    
    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping new user notification', { userId });
      return;
    }

    try {
      // Format user information
      const firstName = user?.first_name || 'Unknown';
      const lastName = user?.last_name || '';
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || username;
      const userLink = user?.username 
        ? `[@${user.username}](https://t.me/${user.username})`
        : `[${fullName}](tg://user?id=${userId})`;
      
      // Format notification message
      const notificationMessage = 
        '🎉 *New User Joined!*\n\n' +
        `👤 User: ${userLink}\n` +
        `🆔 ID: \`${userId}\`\n` +
        `📛 Name: ${fullName}\n` +
        `⏰ Time: ${new Date().toLocaleString('en-US', { 
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} UTC`;

      await this.bot.sendMessage(channelId, notificationMessage, {
        parse_mode: 'Markdown',
        disable_notification: false,
      });

      Logger.info('New user notification sent', {
        userId,
        username,
        channelId,
      });
    } catch (error) {
      // Don't fail the start command if notification fails
      Logger.error('Error sending new user notification', {
        userId,
        username,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private static readonly UNHANDLED_MESSAGE_MAX_LEN = 3000;

  /**
   * Replies to the user when their message isn't a known command or expected input.
   * Lists the available commands so they know what they can do. Never throws.
   */
  private async sendUnhandledMessageReply(chatId: number, lang: Language = 'en'): Promise<void> {
    try {
      await this.bot.sendMessage(chatId, t(lang, 'unhandled.reply'));
    } catch (error) {
      Logger.error('Error sending unhandled message reply', {
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Forwards unhandled chat text to NOTIFICATION_CHANNEL_ID (plain text, truncated).
   * Never throws; failures are logged only.
   */
  private async sendUnhandledMessageNotification(
    chatId: number,
    userId: number,
    username: string,
    text: string,
    user?: TelegramBot.User
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;

    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping unhandled message notification', { userId });
      return;
    }

    const maxLen = TelegramBotService.UNHANDLED_MESSAGE_MAX_LEN;
    const snippet =
      text.length > maxLen ? `${text.slice(0, maxLen)}\n…(truncated)` : text;

    const firstName = user?.first_name || '';
    const lastName = user?.last_name || '';
    const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || '—';
    const uname = user?.username ? `@${user.username}` : username || '—';

    const notificationMessage =
      'Unhandled message\n\n' +
      `User ID: ${userId}\n` +
      `Chat ID: ${chatId}\n` +
      `Username: ${uname}\n` +
      `Name: ${fullName}\n` +
      `Time: ${new Date().toISOString()} UTC\n\n` +
      'Message:\n' +
      snippet;

    try {
      await this.bot.sendMessage(channelId, notificationMessage, {
        disable_notification: false,
      });
      Logger.info('Unhandled message notification sent', { userId, chatId });
    } catch (error) {
      Logger.error('Error sending unhandled message notification', {
        userId,
        chatId,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private async sendErrorNotification(
    userId: number,
    habitName: string | undefined,
    context: string,
    errorMessage: string
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    
    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping error notification', { userId });
      return;
    }

    try {
      const notificationMessage = 
        '⚠️ *Error Notification*\n\n' +
        `📝 Context: ${context}\n` +
        `🆔 User ID: \`${userId}\`\n` +
        (habitName ? `📛 Habit Name: ${habitName}\n` : '') +
        `❌ Error: \`${errorMessage}\`\n` +
        `⏰ Time: ${new Date().toLocaleString('en-US', { 
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} UTC`;

      await this.bot.sendMessage(channelId, notificationMessage, {
        parse_mode: 'Markdown',
        disable_notification: false,
      });

      Logger.info('Error notification sent', {
        userId,
        habitName,
        context,
        channelId,
      });
    } catch (error) {
      // Don't fail the main operation if notification fails
      Logger.error('Error sending error notification', {
        userId,
        habitName,
        context,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private async sendHabitReactionNotification(
    userId: number,
    username: string,
    habitName: string,
    action: 'completed' | 'dropped' | 'skipped',
    streak: number,
    user?: TelegramBot.User
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    
    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping habit reaction notification', { userId });
      return;
    }

    try {
      // Get user info from preferences if not provided
      let userInfo = user;
      if (!userInfo) {
        const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
        userInfo = preferences?.user;
      }

      // Format user information
      const firstName = userInfo?.first_name || 'Unknown';
      const lastName = userInfo?.last_name || '';
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || username;
      const userLink = userInfo?.username 
        ? `[@${userInfo.username}](https://t.me/${userInfo.username})`
        : `[${fullName}](tg://user?id=${userId})`;

      // Format action emoji and text
      const actionEmoji = action === 'completed' ? '✅' : action === 'dropped' ? '❌' : '⏭️';
      const actionText = action === 'completed' ? 'Completed' : action === 'dropped' ? 'Dropped' : 'Skipped';
      
      // Format notification message
      const notificationMessage = 
        `${actionEmoji} *Habit ${actionText}*\n\n` +
        `👤 User: ${userLink}\n` +
        `🆔 ID: \`${userId}\`\n` +
        `📝 Habit: *${habitName}*\n` +
        `🔥 Streak: ${streak} days\n` +
        `⏰ Time: ${new Date().toLocaleString('en-US', { 
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} UTC`;

      await this.bot.sendMessage(channelId, notificationMessage, {
        parse_mode: 'Markdown',
        disable_notification: false,
      });

      Logger.info('Habit reaction notification sent', {
        userId,
        username,
        habitName,
        action,
        streak,
        channelId,
      });
    } catch (error) {
      // Don't fail the habit check if notification fails
      Logger.error('Error sending habit reaction notification', {
        userId,
        username,
        habitName,
        action,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private async sendAnalyticsCommandNotification(
    userId: number,
    username: string,
    user?: TelegramBot.User
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    
    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping analytics command notification', { userId });
      return;
    }

    try {
      // Get user info from preferences if not provided
      let userInfo = user;
      if (!userInfo) {
        const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
        userInfo = preferences?.user;
      }

      // Format user information
      const firstName = userInfo?.first_name || 'Unknown';
      const lastName = userInfo?.last_name || '';
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || username;
      const userLink = userInfo?.username 
        ? `[@${userInfo.username}](https://t.me/${userInfo.username})`
        : `[${fullName}](tg://user?id=${userId})`;
      
      // Format notification message
      const notificationMessage = 
        '📊 *Analytics Command Used*\n\n' +
        `👤 User: ${userLink}\n` +
        `🆔 ID: \`${userId}\`\n` +
        `📛 Name: ${fullName}\n` +
        `⏰ Time: ${new Date().toLocaleString('en-US', { 
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} UTC`;

      await this.bot.sendMessage(channelId, notificationMessage, {
        parse_mode: 'Markdown',
        disable_notification: false,
      });

      Logger.info('Analytics command notification sent', {
        userId,
        username,
        channelId,
      });
    } catch (error) {
      // Don't fail the analytics command if notification fails
      Logger.error('Error sending analytics command notification', {
        userId,
        username,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  private async sendAnalyticsPageVisitNotification(
    userId: number
  ): Promise<void> {
    const channelId = process.env.NOTIFICATION_CHANNEL_ID;
    
    if (!channelId) {
      Logger.debug('NOTIFICATION_CHANNEL_ID not set, skipping analytics page visit notification', { userId });
      return;
    }

    try {
      // Get user info from preferences
      const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userInfo = preferences?.user;

      if (!userInfo) {
        Logger.debug('User info not found, skipping analytics page visit notification', { userId });
        return;
      }

      // Format user information
      const firstName = userInfo.first_name || 'Unknown';
      const lastName = userInfo.last_name || '';
      const fullName = `${firstName}${lastName ? ` ${lastName}` : ''}`.trim() || `user_${userId}`;
      const username = userInfo.username || '';
      const userLink = username
        ? `[@${username}](https://t.me/${username})`
        : `[${fullName}](tg://user?id=${userId})`;
      
      // Format notification message
      const notificationMessage = 
        '🌐 *Analytics Page Visited*\n\n' +
        `👤 User: ${userLink}\n` +
        `🆔 ID: \`${userId}\`\n` +
        `📛 Name: ${fullName}\n` +
        `⏰ Time: ${new Date().toLocaleString('en-US', { 
          timeZone: 'UTC',
          dateStyle: 'medium',
          timeStyle: 'short'
        })} UTC`;

      await this.bot.sendMessage(channelId, notificationMessage, {
        parse_mode: 'Markdown',
        disable_notification: false,
      });

      Logger.info('Analytics page visit notification sent', {
        userId,
        username,
        channelId,
      });
    } catch (error) {
      // Don't fail the analytics API if notification fails
      Logger.error('Error sending analytics page visit notification', {
        userId,
        channelId,
        error: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      });
    }
  }

  /**
   * First onboarding step: pick a language. Choosing one also records consent
   * (see handleLanguageSelection / SetUserPreferencesUseCase.setLanguage), so the
   * consent line + policy links below keep acceptance meaningful. The prompt is
   * language-neutral (trilingual) because the user hasn't chosen a language yet.
   */
  private async showLanguageSelection(chatId: number, userId: number, user?: TelegramBot.User): Promise<void> {
    const prompt =
      '🌍 *Please choose your language*\n' +
      'Будь ласка, оберіть мову\n' +
      'Пожалуйста, выберите язык\n\n' +
      'By choosing a language you agree to our ' +
      '[Privacy Policy](https://habits-builder.com/privacy-policy) and ' +
      '[Terms](https://habits-builder.com/terms).';

    const keyboard = {
      inline_keyboard: SUPPORTED_LANGUAGES.map(l => [
        { text: l.label, callback_data: `language_select:${l.code}` },
      ]),
    };

    await this.bot.sendMessage(chatId, prompt, {
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
      reply_markup: keyboard,
    });
  }

  private async showTimezoneSelection(chatId: number, userId: number, lang: Language = 'en'): Promise<void> {
    const timezones = buildTimezonePickerOptions();

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
      t(lang, 'onboarding.timezone.prompt'),
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
    const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
    await this.bot.sendMessage(
      chatId,
      t(lang, 'newhabit.prompt')
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      // Parse conversation state: set_schedule:habitId:scheduleType or setting_schedule_new:habitId:scheduleType
      const match = conversationState.match(/^(?:set_schedule|setting_schedule_new):(.+):(.+)$/);
      if (!match) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.invalid_state'));
        await this.clearConversationState(userId);
        return;
      }

      const habitId = match[1];
      const scheduleType = match[2];
      const isNewHabit = conversationState.startsWith('setting_schedule_new:');

      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.not_available'));
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
        ? t(lang, 'schedule.dsl.completion_new', { name: updatedHabit.name, schedule: scheduleDesc })
        : t(lang, 'schedule.dsl.completion_update', { name: updatedHabit.name, schedule: scheduleDesc });

      await this.bot.sendMessage(chatId, completionMessage);

      await this.clearConversationState(userId);

      // For new habits, don't show habit details - just confirm creation
      // For existing habits, show updated details
      if (!isNewHabit) {
        await this.showHabitDetails(userId, chatId, habitId);
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

  /**
   * Language pick handler. Onboarding: sets language (+ records consent, see
   * setLanguage) then advances to the timezone step. From Settings: just updates
   * the language and returns to the Settings menu.
   */
  private async handleLanguageSelection(
    userId: number,
    chatId: number,
    langChoice: string,
    messageId?: number,
    user?: TelegramBot.User,
    isFromSettings: boolean = false
  ): Promise<void> {
    try {
      if (!isSupportedLanguage(langChoice)) {
        Logger.warn('Invalid language selected', { userId, langChoice });
        await this.bot.sendMessage(chatId, 'Invalid language. Please try again.');
        return;
      }

      await this.setUserPreferencesUseCase.setLanguage(userId, langChoice, user);
      const langName = languageNativeName(langChoice);

      if (isFromSettings) {
        await this.safeEditMessage(
          t(langChoice, 'settings.language.updated', { lang: langName }),
          { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
        );
        // Return to settings menu in the new language
        await this.handleSettingsCommand(chatId, userId, user?.username || 'unknown', messageId);
        Logger.info('User changed language from settings', { userId, language: langChoice });
        return;
      }

      await this.safeEditMessage(
        t(langChoice, 'onboarding.language.confirmed', { lang: langName }),
        { chat_id: chatId, message_id: messageId, parse_mode: 'Markdown' }
      );

      // Proceed to timezone selection (must be awaited — see gotcha #6)
      await this.showTimezoneSelection(chatId, userId, langChoice);

      Logger.info('User selected language', { userId, language: langChoice });
    } catch (error) {
      Logger.error('Error setting language', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleSettingsCommand(
    chatId: number,
    userId: number | undefined,
    username: string,
    messageId?: number
  ): Promise<void> {
    if (!userId) {
      Logger.warn('Unable to identify user for settings command', { chatId });
      await this.bot.sendMessage(chatId, 'Unable to identify user.');
      return;
    }

    try {
      const preferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const lang = preferences?.language ?? mapTelegramLangCode(preferences?.user?.language_code);
      const currentTimezone = preferences?.timezone;
      let timezoneDisplay = t(lang, 'common.not_set');
      if (currentTimezone) {
        try {
          const now = new Date();
          timezoneDisplay = `${formatLocalTime(currentTimezone, now)} · ${formatUtcOffset(getUtcOffsetMinutes(currentTimezone, now))}`;
        } catch {
          timezoneDisplay = currentTimezone.split('/').pop()?.replace(/_/g, ' ') || currentTimezone;
        }
      }
      const languageDisplay = languageNativeName(lang);

      const keyboardRows: TelegramBot.InlineKeyboardButton[][] = [
        [
          { text: t(lang, 'settings.btn.timezone'), callback_data: 'settings_timezone' },
        ],
        [
          { text: t(lang, 'settings.btn.language'), callback_data: 'settings_language' },
        ],
      ];
      if (userId && isAdminUser(userId)) {
        keyboardRows.push([
          { text: t(lang, 'settings.btn.admin'), web_app: { url: 'https://habits-builder.com/admin' } },
        ]);
      }
      const keyboard = { inline_keyboard: keyboardRows };

      const message = `${t(lang, 'settings.title')}\n\n` +
        `${t(lang, 'settings.current')}\n` +
        `${t(lang, 'settings.timezone_label', { value: timezoneDisplay })}\n` +
        `${t(lang, 'settings.language_label', { value: languageDisplay })}\n\n` +
        `${t(lang, 'settings.select_option')}`;

      if (messageId) {
        await this.safeEditMessage(message, {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      } else {
        await this.bot.sendMessage(chatId, message, {
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        });
      }

      Logger.info('Settings menu shown', { userId, chatId });
    } catch (error) {
      Logger.error('Error showing settings menu', {
        userId,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async showTimezoneSelectionFromSettings(
    userId: number,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
    const timezones = buildTimezonePickerOptions();

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
          callback_data: `timezone_select:${tz.tz}:settings`,
        }))
      );
    }

    // Add back button
    keyboard.inline_keyboard.push([
      { text: t(lang, 'settings.back'), callback_data: 'settings_menu' },
    ]);

    const message = t(lang, 'settings.timezone.title');

    if (messageId) {
      await this.safeEditMessage(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } else {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
  }

  /**
   * Language picker reached from Settings — updates language in place and returns
   * to the Settings menu (via `language_select:{lang}:settings`). Does not re-run
   * onboarding.
   */
  private async showLanguageSelectionFromSettings(
    userId: number,
    chatId: number,
    messageId?: number
  ): Promise<void> {
    const lang = await this.setUserPreferencesUseCase.getLanguage(userId);

    const keyboard = {
      inline_keyboard: [
        ...SUPPORTED_LANGUAGES.map(l => [
          { text: l.label, callback_data: `language_select:${l.code}:settings` },
        ]),
        [{ text: t(lang, 'settings.back'), callback_data: 'settings_menu' }],
      ],
    };

    const message = t(lang, 'settings.language.title');

    if (messageId) {
      await this.safeEditMessage(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    } else {
      await this.bot.sendMessage(chatId, message, {
        parse_mode: 'Markdown',
        reply_markup: keyboard,
      });
    }
  }

  private async handleTimezoneSelection(
    userId: number,
    chatId: number,
    timezone: string,
    messageId?: number,
    user?: TelegramBot.User,
    isFromSettings: boolean = false
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId, user);

      if (!ALLOWED_TIMEZONE_IDS.includes(timezone)) {
        Logger.warn('Invalid timezone selected', { userId, timezone });
        await this.bot.sendMessage(chatId, 'Invalid timezone. Please try again.');
        return;
      }

      await this.setUserPreferencesUseCase.setTimezone(userId, timezone, user);

      const now = new Date();
      const timezoneLabel = `${formatLocalTime(timezone, now)} · ${formatUtcOffset(getUtcOffsetMinutes(timezone, now))}`;

      if (isFromSettings) {
        // Return to settings menu after timezone change
        await this.safeEditMessage(
          t(lang, 'settings.timezone.updated', { tz: timezoneLabel }),
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          }
        );

        // Show settings menu again
        await this.handleSettingsCommand(chatId, userId, user?.username || 'unknown', messageId);
      } else {
        // Onboarding: confirm timezone, then show the welcome message
        await this.safeEditMessage(
          `${t(lang, 'onboarding.timezone.set', { tz: timezoneLabel })}\n\n` +
          t(lang, 'welcome'),
          {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'Markdown',
          }
        );
      }

      Logger.info('User timezone set', { userId, timezone, isFromSettings });
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        await this.clearConversationState(userId);
        return;
      }

      // Get user's timezone for display
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      const scheduleDesc = this.checkReminderDue.getScheduleDescription(
        habit.reminderSchedule || { type: 'daily', hour: 22, minute: 0, timezone: userTimezone }
      );

      await this.safeEditMessage(
        t(lang, 'create.ready_full', { name: habit.name, schedule: scheduleDesc }),
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

  // "← Back" from any customization sub-screen returns to the finish-first
  // confirmation (the default daily reminder), not the old type-picker gate.
  private async handleScheduleBackNew(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        await this.clearConversationState(userId);
        return;
      }

      await this.setConversationState(userId, `setting_schedule_new:${habitId}`);

      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';
      const timezoneName = userTimezone.split('/').pop()?.replace(/_/g, ' ') || userTimezone;
      const schedule = habit.reminderSchedule || { type: 'daily' as const, hour: 22, minute: 0, timezone: userTimezone };
      const time = `${schedule.hour.toString().padStart(2, '0')}:${schedule.minute.toString().padStart(2, '0')}`;

      await this.safeEditMessage(
        t(lang, 'create.planted', { name: habit.name, time, tz: timezoneName }),
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: this.buildNewHabitConfirmKeyboard(habitId, lang),
        }
      );
    } catch (error) {
      Logger.error('Error going back to schedule picker', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // "🕐 Change time" / advanced "Daily": one-tap preset times for a daily reminder.
  private async handleSchedulePickTimeNew(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        await this.clearConversationState(userId);
        return;
      }

      // If the user taps "⌨️ Custom time" they'll type HH:MM; parse it as daily.
      await this.setConversationState(userId, `setting_schedule_new:${habitId}:daily`);

      const timeRows: any[][] = [];
      const presets = TelegramBotService.PRESET_REMINDER_TIMES;
      for (let i = 0; i < presets.length; i += 2) {
        const row = [presets[i], presets[i + 1]]
          .filter(Boolean)
          .map(preset => ({ text: preset, callback_data: `schedule_settime_new:${habitId}:${preset.replace(':', '')}` }));
        timeRows.push(row);
      }

      const keyboard = {
        inline_keyboard: [
          ...timeRows,
          [{ text: t(lang, 'btn.custom_time'), callback_data: `schedule_type_new:${habitId}:daily` }],
          [{ text: t(lang, 'btn.back'), callback_data: `schedule_back_new:${habitId}` }],
        ],
      };

      await this.safeEditMessage(
        t(lang, 'schedule.pick_time', { name: habit.name }),
        {
          chat_id: chatId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      Logger.error('Error showing time picker for new habit', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // A preset time was tapped: set a daily schedule at that time and finish.
  private async handleScheduleSetTimeNew(
    userId: number,
    chatId: number,
    habitId: string,
    hhmm: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.not_available'));
        return;
      }

      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);
      if (!habit) {
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        await this.clearConversationState(userId);
        return;
      }

      const hour = parseInt(hhmm.slice(0, 2), 10);
      const minute = parseInt(hhmm.slice(2, 4), 10);

      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';

      const schedule = { type: 'daily' as const, hour, minute, timezone: userTimezone };
      const updatedHabit = await this.setHabitReminderScheduleUseCase.execute(userId, habitId, schedule);
      const scheduleDesc = this.checkReminderDue.getScheduleDescription(schedule);

      await this.safeEditMessage(
        t(lang, 'create.ready_short', { name: updatedHabit.name, schedule: scheduleDesc }),
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      await this.clearConversationState(userId);
    } catch (error) {
      Logger.error('Error setting preset time for new habit', {
        userId,
        habitId,
        hhmm,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // "📅 Different schedule": advanced type picker (Weekly/Monthly/Interval),
  // kept out of the default path to avoid choice paralysis during onboarding.
  private async handleScheduleMoreNew(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        await this.clearConversationState(userId);
        return;
      }

      await this.setConversationState(userId, `setting_schedule_new:${habitId}`);

      const keyboard = {
        inline_keyboard: [
          [
            { text: t(lang, 'btn.daily'), callback_data: `schedule_pick_time_new:${habitId}` },
            { text: t(lang, 'btn.weekly'), callback_data: `schedule_type_new:${habitId}:weekly` },
          ],
          [
            { text: t(lang, 'btn.monthly'), callback_data: `schedule_type_new:${habitId}:monthly` },
            { text: t(lang, 'btn.interval'), callback_data: `schedule_type_new:${habitId}:interval` },
          ],
          [
            { text: t(lang, 'btn.back'), callback_data: `schedule_back_new:${habitId}` },
          ],
        ],
      };

      await this.safeEditMessage(
        t(lang, 'schedule.more', { name: habit.name }),
        {
          chat_id: chatId,
          message_id: messageId,
          reply_markup: keyboard,
        }
      );
    } catch (error) {
      Logger.error('Error showing advanced schedule picker', {
        userId,
        habitId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleHabitNameInput(chatId: number, userId: number, username: string, habitName: string): Promise<void> {
    const trimmedName = habitName.trim();
    const lang = await this.setUserPreferencesUseCase.getLanguage(userId);

    if (!trimmedName || trimmedName.length === 0) {
      Logger.info('Empty habit name provided', { userId, username, chatId });
      await this.bot.sendMessage(chatId, t(lang, 'newhabit.name_empty'));
      return;
    }

    // Check if name starts with a command (user might have sent a command by mistake)
    if (trimmedName.startsWith('/')) {
      Logger.info('User sent command instead of habit name', { userId, username, chatId, text: trimmedName });
      await this.bot.sendMessage(chatId, t(lang, 'newhabit.name_is_command'));
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

  // One-tap reminder times offered during habit creation (24h). Covers the
  // common "morning / midday / evening" spread so ~most users never type.
  private static readonly PRESET_REMINDER_TIMES = ['09:00', '12:00', '18:00', '20:00', '21:00', '22:00'];

  /**
   * Finish-first confirmation shown right after a habit is named. The habit is
   * already fully working (default daily 22:00), so this is optional tuning, not
   * a gate: "Sounds good" finishes; the other buttons customize.
   */
  private buildNewHabitConfirmKeyboard(habitId: string, lang: Language = 'en') {
    return {
      inline_keyboard: [
        [{ text: t(lang, 'btn.sounds_good'), callback_data: `schedule_skip_new:${habitId}` }],
        [{ text: t(lang, 'btn.change_time'), callback_data: `schedule_pick_time_new:${habitId}` }],
        [{ text: t(lang, 'btn.different_schedule'), callback_data: `schedule_more_new:${habitId}` }],
      ],
    };
  }

  private async askForScheduleDuringCreation(chatId: number, userId: number, habitId: string, habitName: string): Promise<void> {
    // Set conversation state for schedule configuration during creation
    await this.setConversationState(userId, `setting_schedule_new:${habitId}`);

    // Get user's timezone for display
    const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
    const userTimezone = userPreferences?.timezone || 'UTC';
    const timezoneName = userTimezone.split('/').pop()?.replace(/_/g, ' ') || userTimezone;
    const lang = userPreferences?.language ?? mapTelegramLangCode(userPreferences?.user?.language_code);

    // The habit already carries a working default schedule (daily 22:00); show
    // the actual time rather than assuming, then let the user confirm or tune.
    const userHabits = await this.getUserHabitsUseCase.execute(userId);
    const habit = userHabits.find(h => h.id === habitId);
    const defaultSchedule = habit?.reminderSchedule || { type: 'daily' as const, hour: 22, minute: 0, timezone: userTimezone };
    const defaultTime = `${defaultSchedule.hour.toString().padStart(2, '0')}:${defaultSchedule.minute.toString().padStart(2, '0')}`;
    const isFirstHabit = userHabits.length === 1;

    let text = t(lang, 'create.confirm', { name: habitName, time: defaultTime, tz: timezoneName });

    if (isFirstHabit) {
      text += `\n\n${t(lang, 'create.confirm.tip')}`;
    }

    await this.bot.sendMessage(chatId, text, {
      reply_markup: this.buildNewHabitConfirmKeyboard(habitId, lang),
      parse_mode: 'Markdown',
    });
  }

  private async handleNewHabitCommandWithName(chatId: number, userId: number, username: string, habitName: string): Promise<void> {
    // Backward compatibility: handle /newhabit <name> format
    const trimmedName = habitName.trim();
    const lang = await this.setUserPreferencesUseCase.getLanguage(userId);

    if (!trimmedName || trimmedName.length === 0) {
      Logger.info('Invalid habit creation request', { userId, username, chatId });
      await this.bot.sendMessage(chatId, t(lang, 'newhabit.provide_name'));
      return;
    }

    try {
      const habit = await this.createHabitUseCase.execute(userId, trimmedName, username);
      await this.bot.sendMessage(
        chatId,
        t(lang, 'newhabit.created_simple', { name: habit.name })
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

  private async handleSubscribeCommand(chatId: number, userId: number, username: string): Promise<void> {
    try {
      const alreadySubscribed = await this.subscriptionUseCase.isSubscribed(userId);
      if (alreadySubscribed) {
        const prefs = await this.setUserPreferencesUseCase.getPreferences(userId);
        if (prefs?.isLifetimePremium === true) {
          await this.bot.sendMessage(
            chatId,
            '✅ You have lifetime Premium — unlimited habits, notes, and AI insights. No renewal needed.',
          );
          return;
        }
        const periodDays = prefs?.premiumType === 'annual' ? 365 : 30;
        const expiryDate = prefs?.premiumDate
          ? new Date(new Date(prefs.premiumDate).getTime() + periodDays * 24 * 60 * 60 * 1000).toLocaleDateString()
          : 'unknown';
        const typeLabel = prefs?.premiumType === 'annual' ? ' (Annual)' : '';
        await this.bot.sendMessage(chatId,
          `✅ You already have an active Premium subscription${typeLabel}!\n\nRenews: ${expiryDate}`,
        );
        return;
      }

      const starsPrice = parseInt(process.env.PREMIUM_STARS_PRICE || '1', 10);
      const starsAnnual = process.env.PREMIUM_STARS_ANNUAL
        ? parseInt(process.env.PREMIUM_STARS_ANNUAL, 10)
        : starsPrice * 10;

      const monthlyLink = await this.bot.createInvoiceLink(
        'Premium Subscription (Monthly)',
        'Unlimited habits, notes on habits, and AI data insights. Renewed every 30 days. Cancel anytime in Telegram settings.',
        `sub_${userId}`,
        '',
        'XTR',
        [{ label: 'Monthly Premium', amount: starsPrice }],
        { subscription_period: 2592000 }
      );

      const annualLink = await this.bot.createInvoiceLink(
        'Premium Subscription (Annual)',
        'Unlimited habits, notes, and data insights for 1 year. One payment; no auto-renewal.',
        `sub_annual_${userId}`,
        '',
        'XTR',
        [{ label: 'Annual Premium', amount: starsAnnual }],
        {}
      );

      const maxFree = parseInt(process.env.MAX_FREE_HABITS || '3', 10);
      await this.bot.sendMessage(chatId,
        `💎 *Premium Subscription*\n\n` +
        `Free plan: up to ${maxFree} habits\n` +
        `Premium: unlimited habits, notes on habits, and AI data insights\n\n` +
        `• *Monthly:* renews automatically every 30 days\n` +
        `• *Annual:* one payment per year; no auto-renewal`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `Monthly — ${starsPrice} ⭐/month`, url: monthlyLink }],
              [{ text: `Annual — ${starsAnnual} ⭐/year`, url: annualLink }],
            ],
          },
        }
      );
    } catch (error) {
      Logger.error('Error handling subscribe command', {
        userId,
        username,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, 'Error processing subscription. Please try again later.');
    }
  }

  private async handleAnalyticsCommand(chatId: number, userId: number | undefined, username: string, user?: TelegramBot.User): Promise<void> {
    Logger.debug('Analytics command', { chatId, userId, username, user });
    if (!userId) {
      Logger.warn('Unable to identify user for analytics', { chatId });
      await this.bot.sendMessage(chatId, 'Unable to identify user.');
      return;
    }

    const lang = await this.setUserPreferencesUseCase.getLanguage(userId, user);
    Logger.info('User requested analytics', { userId, username, chatId });
    
    // Get base URL from environment variables
    let baseUrl = process.env.PROD_URL 
      ? `https://${process.env.PROD_URL}`
      : process.env.WEBHOOK_URL 
        ? process.env.WEBHOOK_URL.replace('/api/webhook', '')
        : 'http://localhost:3000';
    
    // Ensure baseUrl doesn't have trailing slash
    baseUrl = baseUrl.replace(/\/$/, '');
    
    // const analyticsUrl = `${baseUrl}/analytics/${userId}`;
    const analyticsUrl = `https://habits-builder.com/analytics/${userId}`;
    
    const message = t(lang, 'analytics.intro');

    Logger.debug('Sending analytics message', { chatId, userId, username, message });
    await this.bot.sendMessage(chatId, message, {
      parse_mode: 'Markdown',
      disable_web_page_preview: false, // Allow preview of the link
      reply_markup: {
        inline_keyboard: [[
        {
          "text": t(lang, 'analytics.btn.open'),
          "web_app": { "url": analyticsUrl }
        }
      ]]
      }
    });

    // Send notification to channel (async, don't block)
    Logger.debug('Sending analytics command notification', { userId, username, user });
    this.sendAnalyticsCommandNotification(userId, username, user).catch(error => {
      Logger.error('Error sending analytics command notification', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });
  }

  // Callback query handlers
  private async handleCallbackQuery(query: TelegramBot.CallbackQuery): Promise<void> {
    const chatId = query.message?.chat.id;
    const userId = query.from.id;
    const username = getUsername(query.from);
    const data = query.data;
    Logger.debug('Callback query', { userId, username, chatId, data });

    if (!chatId || !data) {
      Logger.warn('Invalid callback query', { userId, username, hasChatId: !!chatId, hasData: !!data });
      return;
    }

    // Callback query is already acknowledged in processUpdate before this runs.

    if (data === 'open_subscribe') {
      await this.handleSubscribeCommand(chatId, userId, username);
      return;
    }

    // Handle "Resume now" for an auto-paused habit
    const resumeMatch = data.match(/^resume_reminders:(.+)$/);
    if (resumeMatch) {
      await this.handleResumeReminders(userId, chatId, resumeMatch[1], query.message?.message_id);
      return;
    }

    // Handle "Check later (in 1 hour)" postpone
    const postponeMatch = data.match(/^habit_postpone:(.+):(\d{4}-\d{2}-\d{2})$/);
    if (postponeMatch) {
      await this.handleHabitPostpone(userId, chatId, postponeMatch[1], postponeMatch[2], query.message?.message_id);
      return;
    }

    // Handle habit check (Yes/No/Skip/Cancel); optional 4th segment = targetDate (reminder's day)
    const checkMatch = data.match(/^habit_check:(.+):(yes|no|skip|cancel)(?::(.+))?$/);
    if (checkMatch) {
      const habitId = checkMatch[1];
      const action = checkMatch[2];
      const targetDate = checkMatch[3] || undefined; // YYYY-MM-DD when from reminder
      if (action === 'skip') {
        await this.handleHabitSkipConfirmation(userId, chatId, habitId, query.message?.message_id, targetDate);
        return;
      }
      if (action === 'cancel') {
        const habits = await this.getUserHabitsUseCase.execute(userId);
        const habit = habits.find(h => h.id === habitId);
        if (habit) {
          const suffix = targetDate ? `:${targetDate}` : '';
          const keyboard = {
            inline_keyboard: [
              [
                { text: '✅ Yes', callback_data: `habit_check:${habit.id}:yes${suffix}` },
              ],
              [
                { text: '❌ No (drop streak)', callback_data: `habit_check:${habit.id}:no${suffix}` },
                { text: '⏭️ Skip (keep streak)', callback_data: `habit_check:${habit.id}:skip${suffix}` },
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
      // Drop/skip notes are entered from the MiniApp only; from chat the note is left empty.
      await this.handleHabitCheckCallback(userId, chatId, username, habitId, action === 'yes', query, targetDate);
      return;
    }

    // Handle habit skip confirmation; optional 2nd segment = targetDate
    const skipConfirmMatch = data.match(/^habit_skip_confirm:([^:]+)(?::(.+))?$/);
    if (skipConfirmMatch) {
      const targetDate = skipConfirmMatch[2] || undefined;
      await this.handleHabitSkipCallback(userId, chatId, username, skipConfirmMatch[1], query.message?.message_id, query.from, targetDate);
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
      await this.handleSetScheduleCallback(userId, chatId, setScheduleMatch[1], query.id, query.message?.message_id);
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

    // Handle back to the finish-first confirmation for new habits
    const scheduleBackNewMatch = data.match(/^schedule_back_new:(.+)$/);
    if (scheduleBackNewMatch) {
      await this.handleScheduleBackNew(userId, chatId, scheduleBackNewMatch[1], query.message?.message_id);
      return;
    }

    // Handle one-tap daily time picker for new habits
    const schedulePickTimeNewMatch = data.match(/^schedule_pick_time_new:(.+)$/);
    if (schedulePickTimeNewMatch) {
      await this.handleSchedulePickTimeNew(userId, chatId, schedulePickTimeNewMatch[1], query.message?.message_id);
      return;
    }

    // Handle a tapped preset time (HHMM) for new habits
    const scheduleSetTimeNewMatch = data.match(/^schedule_settime_new:(.+):(\d{4})$/);
    if (scheduleSetTimeNewMatch) {
      await this.handleScheduleSetTimeNew(userId, chatId, scheduleSetTimeNewMatch[1], scheduleSetTimeNewMatch[2], query.message?.message_id);
      return;
    }

    // Handle "Different schedule" advanced type picker for new habits
    const scheduleMoreNewMatch = data.match(/^schedule_more_new:(.+)$/);
    if (scheduleMoreNewMatch) {
      await this.handleScheduleMoreNew(userId, chatId, scheduleMoreNewMatch[1], query.message?.message_id);
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

    // Handle habit toggle disabled
    const toggleDisabledMatch = data.match(/^habit_toggle_disabled:(.+)$/);
    if (toggleDisabledMatch) {
      await this.handleHabitToggleDisabled(userId, chatId, toggleDisabledMatch[1], query.id, query.message?.message_id);
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
      Logger.debug('Habit list callback', { userId, username, chatId, data });
      await this.handleHabitListCallback(userId, chatId, query.message?.message_id);
      return;
    }

    // Handle language selection (onboarding and from settings)
    // Shape: language_select:{en|uk|ru} or language_select:{lang}:settings
    const languageMatch = data.match(/^language_select:([a-z]{2})(?::(settings))?$/);
    if (languageMatch) {
      const langChoice = languageMatch[1];
      const isFromSettings = languageMatch[2] === 'settings';
      await this.handleLanguageSelection(userId, chatId, langChoice, query.message?.message_id, query.from, isFromSettings);
      return;
    }

    // Handle settings menu actions
    if (data === 'settings_menu') {
      await this.handleSettingsCommand(userId, chatId, username, query.message?.message_id);
      return;
    }

    if (data === 'settings_timezone') {
      await this.showTimezoneSelectionFromSettings(userId, chatId, query.message?.message_id);
      return;
    }

    if (data === 'settings_language') {
      await this.showLanguageSelectionFromSettings(userId, chatId, query.message?.message_id);
      return;
    }

    // Handle timezone selection
    const timezoneMatch = data.match(/^timezone_select:(.+?)(?::(.+))?$/);
    if (timezoneMatch) {
      const timezone = timezoneMatch[1];
      const isFromSettings = timezoneMatch[2] === 'settings';
      await this.handleTimezoneSelection(userId, chatId, timezone, query.message?.message_id, query.from, isFromSettings);
      return;
    }

    // Handle quote actions
    const quoteDeleteMatch = data.match(/^quote_delete:(\d+)$/);
    if (quoteDeleteMatch) {
      await this.handleQuoteDelete(userId, chatId, parseInt(quoteDeleteMatch[1], 10), query.message?.message_id);
      return;
    }

    const quoteEditMatch = data.match(/^quote_edit:(\d+)$/);
    if (quoteEditMatch) {
      await this.handleQuoteEdit(userId, chatId, parseInt(quoteEditMatch[1], 10), query.message?.message_id);
      return;
    }

    const quoteGetImgMatch = data.match(/^quote_get_img:(\d+)$/);
    if (quoteGetImgMatch) {
      await this.handleQuoteGetImg(userId, chatId, parseInt(quoteGetImgMatch[1], 10), query.message?.message_id);
      return;
    }

    const quoteRegenerateMatch = data.match(/^quote_regenerate:(\d+)$/);
    if (quoteRegenerateMatch) {
      await this.handleQuoteRegenerate(userId, chatId, parseInt(quoteRegenerateMatch[1], 10), query.message?.message_id);
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
    query: TelegramBot.CallbackQuery,
    targetDate?: string
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId, query.from);
      const habitsBefore = await this.getUserHabitsUseCase.execute(userId);
      const habitBefore = habitsBefore.find(h => h.id === habitId);
      const badgesBefore = habitBefore?.badges || [];

      const updatedHabit = await this.recordHabitCheckUseCase.execute(userId, habitId, completed, username, targetDate);

      const emoji = completed ? '✅' : '❌';
      const { getBadgeInfo, BADGE_TREE_MESSAGES, getNextMilestone } = await import('../../domain/utils/HabitBadges');

      let message: string;
      if (!completed) {
        message = t(lang, 'check.reset');
      } else if (updatedHabit.streak === 1) {
        const next = getNextMilestone(1, updatedHabit.badges || []);
        message = t(lang, 'check.sprouted', { name: updatedHabit.name });
        if (next) {
          message += `\n\n${t(lang, 'check.first_badge', { days: next.daysLeft, emoji: next.emoji })}`;
        }
      } else {
        message = t(lang, 'check.great', { name: updatedHabit.name, streak: updatedHabit.streak });
      }

      // Check if new badges were earned
      const badgesAfter = updatedHabit.badges || [];
      const newBadges = badgesAfter.filter(b => !badgesBefore.some(before => before.type === b.type));
      if (newBadges.length > 0) {
        const highestNewBadge = newBadges[newBadges.length - 1];
        const next = getNextMilestone(updatedHabit.streak, updatedHabit.badges || []);

        if (newBadges.length === 1) {
          const badgeInfo = getBadgeInfo(newBadges[0].type);
          const treeMsg = BADGE_TREE_MESSAGES[newBadges[0].type as keyof typeof BADGE_TREE_MESSAGES];
          message += `\n\n🎉 ${badgeInfo.emoji} Badge earned: ${badgeInfo.name}! ${treeMsg}`;
        } else {
          const badgeEmojis = newBadges.map(b => getBadgeInfo(b.type).emoji).join(' ');
          const badgeNames = newBadges.map(b => getBadgeInfo(b.type).name).join(', ');
          const treeMsg = BADGE_TREE_MESSAGES[highestNewBadge.type as keyof typeof BADGE_TREE_MESSAGES];
          message += `\n\n🎉 Badges earned: ${badgeEmojis} (${badgeNames})! ${treeMsg}`;
        }

        if (next) {
          message += `\n${next.daysLeft} more days until your next badge ${next.emoji}`;
        }

        message += `\n\n[@habits_checking_bot](t.me/habits_checking_bot)`;
      }

      const fullMessage = `${emoji} ${message}`;

      let celebrationImageNumbers: number[] = [];
      if (completed) {
        const imgIndex = updatedHabit.imgIndex || 1;

        if (!habitBefore?.lastCheckedDate) {
          celebrationImageNumbers.push(1);
        }

        if (newBadges.length > 0) {
          const { BADGE_IMAGE_MAP } = await import('../../domain/utils/HabitBadges');
          for (const badge of newBadges) {
            celebrationImageNumbers.push(BADGE_IMAGE_MAP[badge.type]);
          }
        }

        if (celebrationImageNumbers.length > 0) {
          await this.safeEditMessage(`${emoji} ${t(lang, 'check.checked')}`, {
            chat_id: chatId,
            message_id: query.message?.message_id,
          });

          for (let i = 0; i < celebrationImageNumbers.length; i++) {
            try {
              const imagePath = path.join(process.cwd(), 'public', 'images', 'habits', String(imgIndex), `${celebrationImageNumbers[i]}.png`);
              await this.bot.sendPhoto(chatId, fs.createReadStream(imagePath), {
                ...(i === 0 ? { caption: fullMessage, parse_mode: 'Markdown' as const } : {}),
              });
            } catch (imgError) {
              Logger.error('Error sending celebration image', {
                userId,
                habitId,
                imgIndex,
                imageNum: celebrationImageNumbers[i],
                error: imgError instanceof Error ? imgError.message : 'Unknown error',
              });
              if (i === 0) {
                await this.bot.sendMessage(chatId, fullMessage, { parse_mode: 'Markdown' });
              }
            }
          }
        }
      }

      if (celebrationImageNumbers.length === 0) {
        await this.safeEditMessage(fullMessage, {
          chat_id: chatId,
          message_id: query.message?.message_id,
          parse_mode: 'Markdown',
        });
      }

      // Send notification to channel (async, don't block)
      this.sendHabitReactionNotification(
        userId,
        username,
        updatedHabit.name,
        completed ? 'completed' : 'dropped',
        updatedHabit.streak,
        query.from
      ).catch(error => {
        Logger.error('Error sending habit reaction notification', {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    } catch (error) {
      Logger.error('Error recording habit check', {
        userId,
        username,
        habitId,
        completed,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.safeAnswerCallbackQuery(query.id, {
        text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        show_alert: true,
      });
    }
  }

  private async handleHabitSkipConfirmation(
    userId: number,
    chatId: number,
    habitId: string,
    messageId?: number,
    targetDate?: string
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for skip confirmation', { userId, habitId, chatId });
        await this.safeAnswerCallbackQuery('', {
          text: t(lang, 'habits.not_found'),
          show_alert: true,
        });
        return;
      }

      const suffix = targetDate ? `:${targetDate}` : '';
      const keyboard = {
        inline_keyboard: [
          [
            { text: t(lang, 'skip.btn.yes'), callback_data: `habit_skip_confirm:${habitId}${suffix}` },
            { text: t(lang, 'btn.cancel'), callback_data: `habit_check:${habitId}:cancel${suffix}` },
          ],
        ],
      };

      await this.safeEditMessage(
        t(lang, 'skip.confirm', { name: habit.name }),
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
    messageId?: number,
    user?: TelegramBot.User,
    targetDate?: string
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId, user);
      // Skip notes are entered from the MiniApp only; from chat the note is left empty.
      const updatedHabit = await this.recordHabitCheckUseCase.skipHabit(userId, habitId, username, targetDate);

      await this.safeEditMessage(
        t(lang, 'skip.result', { name: updatedHabit.name, streak: updatedHabit.streak }),
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      // Send notification to channel (async, don't block)
      this.sendHabitReactionNotification(
        userId,
        username,
        updatedHabit.name,
        'skipped',
        updatedHabit.streak,
        user
      ).catch(error => {
        Logger.error('Error sending habit skip notification', {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });

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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      // Get habit details to show in confirmation
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        Logger.warn('Habit not found for deletion confirmation', { userId, username, habitId, chatId });
        await this.safeAnswerCallbackQuery('', {
          text: t(lang, 'habits.not_found'),
          show_alert: true,
        });
        return;
      }

      // Show confirmation message
      const confirmationMessage = t(lang, 'habits.delete.confirm', { name: habit.name });
      const keyboard = {
        inline_keyboard: [
          [
            { text: t(lang, 'btn.delete_yes'), callback_data: `habit_delete_confirm:${habitId}` },
            { text: t(lang, 'btn.cancel'), callback_data: `habit_view:${habitId}` },
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
    callbackQueryId: string,
    messageId?: number
  ): Promise<void> {
    try {
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit) {
        await this.safeAnswerCallbackQuery(callbackQueryId);
        await this.bot.sendMessage(chatId, t(lang, 'habits.not_found'));
        return;
      }

      // Premium disabled: scheduling paused habits is free for everyone
      // if (habit.disabled) {
      //   const prefs = await this.setUserPreferencesUseCase.getPreferences(userId);
      //   if (!userHasPremiumAccess(prefs)) {
      //     await this.safeAnswerCallbackQuery(callbackQueryId, {
      //       text: 'This habit is paused (free limit reached). Use /subscribe for Premium or disable an active habit to enable this one.',
      //       show_alert: true,
      //     });
      //     return;
      //   }
      // }

      if (!this.setHabitReminderScheduleUseCase) {
        await this.safeAnswerCallbackQuery(callbackQueryId);
        await this.bot.sendMessage(chatId, t(lang, 'schedule.not_available_support'));
        return;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: t(lang, 'btn.daily'), callback_data: `schedule_type:${habitId}:daily` },
            { text: t(lang, 'btn.weekly'), callback_data: `schedule_type:${habitId}:weekly` },
          ],
          [
            { text: t(lang, 'btn.monthly'), callback_data: `schedule_type:${habitId}:monthly` },
            { text: t(lang, 'btn.interval'), callback_data: `schedule_type:${habitId}:interval` },
          ],
          [
            { text: t(lang, 'btn.back'), callback_data: `habit_view:${habitId}` },
          ],
        ],
      };

      // Get user's timezone for default schedule display
      const userPreferences = await this.setUserPreferencesUseCase.getPreferences(userId);
      const userTimezone = userPreferences?.timezone || 'UTC';
      const currentDesc = this.checkReminderDue.getScheduleDescription(habit.reminderSchedule || { type: 'daily', hour: 22, minute: 0, timezone: userTimezone });

      await this.safeEditMessage(
        t(lang, 'schedule.set', { name: habit.name, current: currentDesc }),
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      const habits = await this.getUserHabitsUseCase.execute(userId);
      const habit = habits.find(h => h.id === habitId);

      if (!habit || !this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.habit_or_unavailable'));
        return;
      }

      let message: string;
      switch (scheduleType) {
        case 'daily':
          message = t(lang, 'schedule.type.daily');
          break;
        case 'weekly':
          message = t(lang, 'schedule.type.weekly');
          break;
        case 'monthly':
          message = t(lang, 'schedule.type.monthly');
          break;
        case 'interval':
          message = t(lang, 'schedule.type.interval');
          break;
        default:
          await this.bot.sendMessage(chatId, t(lang, 'schedule.unknown_type'));
          return;
      }

      const scheduleUrl = `https://habits-builder.com/schedule?habitId=${habitId}&type=${scheduleType}&chatId=${chatId}&msgId=${messageId}&isNew=${isNewHabit ? '1' : '0'}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: t(lang, 'btn.configure_miniapp'), web_app: { url: scheduleUrl } },
          ],
          [
            { text: t(lang, 'btn.back'), callback_data: isNewHabit ? `schedule_back_new:${habitId}` : `habit_set_schedule:${habitId}` },
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
      const lang = await this.setUserPreferencesUseCase.getLanguage(userId);
      if (!this.setHabitReminderScheduleUseCase) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.not_available'));
        return;
      }

      // Retrieve stored quick schedules from conversation state
      const conversationState = await this.getConversationState(userId);
      if (!conversationState || !conversationState.startsWith(`schedule_quick:${habitId}:`)) {
        await this.bot.sendMessage(chatId, t(lang, 'schedule.options_expired'));
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
      await this.showHabitDetails(userId, chatId, habitId);
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
      await this.showHabitDetails(userId, chatId, habitId);
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

  // Quote management handlers
  private async handleQuoteCommand(chatId: number, userId: number, username: string): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      Logger.debug('Non-admin user attempted to use /quote command', { userId, username, chatId });
      return; // Silently ignore
    }

    try {
      // Get current quote index from Redis
      let quoteIndex = await kv.get('quote_counter') as number | null;
      if (quoteIndex === null || quoteIndex === undefined) {
        quoteIndex = 0;
      }

      // Get total quotes count
      const totalQuotes = await this.quoteManager.getTotalQuotes();
      if (totalQuotes === 0) {
        await this.bot.sendMessage(chatId, 'No quotes available.');
        return;
      }

      // Wrap around if index exceeds total
      if (quoteIndex >= totalQuotes) {
        quoteIndex = 0;
      }

      // Get quote
      const quote = await this.quoteManager.getQuote(quoteIndex);
      if (!quote) {
        await this.bot.sendMessage(chatId, 'Quote not found.');
        return;
      }

      // Increment counter for next time
      await kv.set('quote_counter', quoteIndex + 1);

      // Display quote with buttons
      const message = `📝 Quote ${quoteIndex + 1}/${totalQuotes}\n\n"${quote.text}"\n\n— ${quote.author}`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🗑️ Delete', callback_data: `quote_delete:${quoteIndex}` },
            { text: '✏️ Edit', callback_data: `quote_edit:${quoteIndex}` },
          ],
          [
            { text: '🖼️ Get Img', callback_data: `quote_get_img:${quoteIndex}` },
          ],
        ],
      };

      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
      });

      Logger.info('Quote displayed', { userId, username, quoteIndex, totalQuotes });
    } catch (error) {
      Logger.error('Error handling quote command', {
        userId,
        username,
        chatId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleQuoteDelete(
    userId: number,
    chatId: number,
    quoteIndex: number,
    messageId?: number
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    try {
      const deleted = await this.quoteManager.deleteQuote(quoteIndex);
      if (!deleted) {
        await this.safeAnswerCallbackQuery('', {
          text: 'Quote not found',
          show_alert: true,
        });
        return;
      }

      // Adjust counter if needed (since quotes shift down after deletion)
      const currentCounter = await kv.get('quote_counter') as number | null;
      if (currentCounter !== null && currentCounter > quoteIndex) {
        await kv.set('quote_counter', currentCounter - 1);
      } else if (currentCounter !== null && currentCounter === quoteIndex) {
        // If we deleted the quote that counter points to, wrap around or reset
        const totalQuotes = await this.quoteManager.getTotalQuotes();
        await kv.set('quote_counter', totalQuotes > 0 ? 0 : 0);
      }

      const totalQuotes = await this.quoteManager.getTotalQuotes();
      await this.safeEditMessage(
        `✅ Quote deleted!\n\nTotal quotes remaining: ${totalQuotes}`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      Logger.info('Quote deleted', { userId, quoteIndex, totalQuotes });
    } catch (error) {
      Logger.error('Error deleting quote', {
        userId,
        quoteIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error deleting quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleQuoteEdit(
    userId: number,
    chatId: number,
    quoteIndex: number,
    messageId?: number
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    try {
      const quote = await this.quoteManager.getQuote(quoteIndex);
      if (!quote) {
        await this.safeAnswerCallbackQuery('', {
          text: 'Quote not found',
          show_alert: true,
        });
        return;
      }

      // Set conversation state for editing
      await this.setConversationState(userId, `quote_edit:${quoteIndex}`);

      await this.safeEditMessage(
        `✏️ Editing Quote ${quoteIndex + 1}\n\nCurrent quote:\n"${quote.text}"\n\n— ${quote.author}\n\n📝 Please send the new quote text. Format: "quote text" or "quote text|author"`,
        {
          chat_id: chatId,
          message_id: messageId,
        }
      );

      Logger.info('Quote edit started', { userId, quoteIndex });
    } catch (error) {
      Logger.error('Error starting quote edit', {
        userId,
        quoteIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleQuoteEditInput(
    chatId: number,
    userId: number,
    username: string,
    inputText: string,
    conversationState: string
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    try {
      const match = conversationState.match(/^quote_edit:(\d+)$/);
      if (!match) {
        await this.bot.sendMessage(chatId, 'Invalid conversation state. Please try again.');
        await this.clearConversationState(userId);
        return;
      }

      const quoteIndex = parseInt(match[1], 10);
      
      // Parse input: "quote text" or "quote text|author"
      let newText = inputText.trim();
      let newAuthor: string | undefined = undefined;

      if (newText.includes('|')) {
        const parts = newText.split('|');
        if (parts.length === 2) {
          newText = parts[0].trim();
          newAuthor = parts[1].trim();
        }
      }

      const edited = await this.quoteManager.editQuote(quoteIndex, newText, newAuthor);
      if (!edited) {
        await this.bot.sendMessage(chatId, 'Failed to edit quote. Quote may have been deleted.');
        await this.clearConversationState(userId);
        return;
      }

      const updatedQuote = await this.quoteManager.getQuote(quoteIndex);
      if (!updatedQuote) {
        await this.bot.sendMessage(chatId, 'Quote not found after edit.');
        await this.clearConversationState(userId);
        return;
      }

      const totalQuotes = await this.quoteManager.getTotalQuotes();
      const message = `✅ Quote edited!\n\n📝 Quote ${quoteIndex + 1}/${totalQuotes}\n\n"${updatedQuote.text}"\n\n— ${updatedQuote.author}`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: '🗑️ Delete', callback_data: `quote_delete:${quoteIndex}` },
            { text: '✏️ Edit', callback_data: `quote_edit:${quoteIndex}` },
          ],
          [
            { text: '🖼️ Get Img', callback_data: `quote_get_img:${quoteIndex}` },
          ],
        ],
      };

      await this.bot.sendMessage(chatId, message, {
        reply_markup: keyboard,
      });

      await this.clearConversationState(userId);
      Logger.info('Quote edited', { userId, username, quoteIndex });
    } catch (error) {
      Logger.error('Error editing quote', {
        userId,
        username,
        conversationState,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error editing quote: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await this.clearConversationState(userId);
    }
  }

  private async handleQuoteGetImg(
    userId: number,
    chatId: number,
    quoteIndex: number,
    messageId?: number
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    if (!this.openai) {
      await this.safeAnswerCallbackQuery('', {
        text: 'OpenAI API not configured',
        show_alert: true,
      });
      return;
    }

    try {
      const quote = await this.quoteManager.getQuote(quoteIndex);
      if (!quote) {
        await this.safeAnswerCallbackQuery('', {
          text: 'Quote not found',
          show_alert: true,
        });
        return;
      }

      // Show generating message
      await this.bot.sendMessage(chatId, 'Generating image...');

      // Generate image using OpenAI DALL-E
      const prompt = `Create a beautiful, inspiring image representing this quote: "${quote.text}" by ${quote.author}. The image should be artistic, meaningful, and visually appealing. Use the timeline where the author of quote used to live. Also try to use more real people and their live scenarios. Don't put any text on the image.`;
      
      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt: prompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL returned from OpenAI');
      }

      // Send image to user with regenerate button
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Regenerate with prompt', callback_data: `quote_regenerate:${quoteIndex}` },
          ],
        ],
      };

      await this.bot.sendPhoto(chatId, imageUrl, {
        caption: `"${quote.text}"\n\n— ${quote.author}`,
        reply_markup: keyboard,
      });

      Logger.info('Quote image generated', { userId, quoteIndex, imageUrl });
    } catch (error) {
      Logger.error('Error generating quote image', {
        userId,
        quoteIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleQuoteRegenerate(
    userId: number,
    chatId: number,
    quoteIndex: number,
    messageId?: number
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    try {
      const quote = await this.quoteManager.getQuote(quoteIndex);
      if (!quote) {
        await this.safeAnswerCallbackQuery('', {
          text: 'Quote not found',
          show_alert: true,
        });
        return;
      }

      // Set conversation state for custom prompt input
      await this.setConversationState(userId, `quote_regenerate:${quoteIndex}`);

      await this.bot.sendMessage(
        chatId,
        `🔄 Regenerating image for quote ${quoteIndex + 1}\n\n📝 Please send your custom prompt. It will be combined with the standard prompt.\n\nExample: "in a minimalist style" or "with vibrant colors"`,
      );

      Logger.info('Quote regenerate started', { userId, quoteIndex });
    } catch (error) {
      Logger.error('Error starting quote regenerate', {
        userId,
        quoteIndex,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  private async handleQuoteRegenerateInput(
    chatId: number,
    userId: number,
    username: string,
    customPrompt: string,
    conversationState: string
  ): Promise<void> {
    // Check admin access
    const adminId = process.env.ADMIN_ID;
    if (!adminId || userId.toString() !== adminId) {
      return; // Silently ignore
    }

    if (!this.openai) {
      await this.bot.sendMessage(chatId, 'OpenAI API not configured.');
      await this.clearConversationState(userId);
      return;
    }

    try {
      const match = conversationState.match(/^quote_regenerate:(\d+)$/);
      if (!match) {
        await this.bot.sendMessage(chatId, 'Invalid conversation state. Please try again.');
        await this.clearConversationState(userId);
        return;
      }

      const quoteIndex = parseInt(match[1], 10);
      const quote = await this.quoteManager.getQuote(quoteIndex);
      if (!quote) {
        await this.bot.sendMessage(chatId, 'Quote not found.');
        await this.clearConversationState(userId);
        return;
      }

      // Show generating message
      await this.bot.sendMessage(chatId, '🔄 Generating image with custom prompt...');

      // Combine standard prompt with custom prompt
      const standardPrompt = `Create a beautiful, inspiring image representing this quote: "${quote.text}" by ${quote.author}. The image should be artistic, meaningful, and visually appealing. Use the timeline where the author of quote used to live. Also try to use more real people and their live scenarios. Don't put any text on the image.`;
      const fullPrompt = `${standardPrompt} ${customPrompt.trim()}`;
      
      const response = await this.openai.images.generate({
        model: 'dall-e-3',
        prompt: fullPrompt,
        n: 1,
        size: '1024x1024',
        quality: 'standard',
      });

      const imageUrl = response.data?.[0]?.url;
      if (!imageUrl) {
        throw new Error('No image URL returned from OpenAI');
      }

      // Send image to user with regenerate button
      const keyboard = {
        inline_keyboard: [
          [
            { text: '🔄 Regenerate with prompt', callback_data: `quote_regenerate:${quoteIndex}` },
          ],
        ],
      };

      await this.bot.sendPhoto(chatId, imageUrl, {
        caption: `"${quote.text}"\n\n— ${quote.author}\n\n✨ Custom prompt: ${customPrompt.trim()}`,
        reply_markup: keyboard,
      });

      await this.clearConversationState(userId);
      Logger.info('Quote image regenerated with custom prompt', { userId, username, quoteIndex, customPrompt });
    } catch (error) {
      Logger.error('Error regenerating quote image', {
        userId,
        username,
        conversationState,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      await this.bot.sendMessage(chatId, `Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await this.clearConversationState(userId);
    }
  }

  // Add this helper method to the TelegramBotService class
  private async safeAnswerCallbackQuery(
    callbackQueryId: string,
    options?: Partial<TelegramBot.AnswerCallbackQueryOptions>
  ): Promise<void> {
    try {
      await this.bot.answerCallbackQuery(callbackQueryId, options);
    } catch (error: any) {
      const description: string =
        error?.response?.body?.description ||
        (error instanceof Error ? error.message : '');
      // Stale/duplicate answers are expected (already answered, or the query
      // expired). Never let answering a callback query throw — that would turn
      // into a webhook 500 and trigger Telegram retries.
      if (
        typeof description === 'string' &&
        (description.includes('query is too old') ||
          description.includes('query ID is invalid') ||
          description.includes('QUERY_ID_INVALID'))
      ) {
        Logger.debug('Ignoring stale callback query answer', { description });
        return;
      }
      Logger.warn('Failed to answer callback query', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

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
