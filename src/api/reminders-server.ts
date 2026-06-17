import http from 'http';
import { readFileSync, existsSync, statSync } from 'fs';
import { join, extname, resolve } from 'path';
import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { TelegramBotService } from '../presentation/telegram/TelegramBot';
import { GetHabitsDueForReminderUseCase } from '../domain/use-cases/GetHabitsDueForReminderUseCase';
import { CreateHabitUseCase } from '../domain/use-cases/CreateHabitUseCase';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { RecordHabitCheckUseCase } from '../domain/use-cases/RecordHabitCheckUseCase';
import { DeleteHabitUseCase } from '../domain/use-cases/DeleteHabitUseCase';
import { GetHabitsToCheckUseCase } from '../domain/use-cases/GetHabitsToCheckUseCase';
import { SetHabitReminderScheduleUseCase } from '../domain/use-cases/SetHabitReminderScheduleUseCase';
import { SetUserPreferencesUseCase } from '../domain/use-cases/SetUserPreferencesUseCase';
import { SubscriptionUseCase } from '../domain/use-cases/SubscriptionUseCase';
import { Habit } from '../domain/entities/Habit';
import { Logger } from '../infrastructure/logger/Logger';
import { ChannelNotifications } from '../infrastructure/notifications/ChannelNotifications';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../infrastructure/auth/validateTelegramInitData';
import { getAnalyticsData, getAnalyticsInsights } from './analytics-shared';
import {
  runAdminUsersList,
  logAdminUsersError,
  runAdminSendMessage,
  logAdminSendMessageError,
  runGrantLifetimePremium,
  logGrantLifetimePremiumError,
} from './admin-users-shared';

// Helper functions defined before createRemindersServer (exported for unit tests)
export async function handleRemindersEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  botService: TelegramBotService,
  habitRepository: VercelKVHabitRepository,
  port: number
): Promise<void> {
  // Optional: Check for cron secret
  const url = req.url || '';
  const cronSecret = req.headers['x-cron-secret'] || new URL(url, `http://localhost:${port}`).searchParams.get('secret');
  const expectedSecret = process.env.CRON_SECRET;
  
  // if (expectedSecret && cronSecret !== expectedSecret) {
  //   res.writeHead(401, { 'Content-Type': 'application/json' });
  //   res.end(JSON.stringify({ error: 'Unauthorized' }));
  //   return;
  // }

  try {
    Logger.info('Starting hourly reminders request');

    // Check and revoke expired premium subscriptions
    const subscriptionUseCase = new SubscriptionUseCase(habitRepository);
    const allUserIds = await habitRepository.getAllActiveUserIds();
    console.log('ALL USER IDS', allUserIds);
    const expired = await subscriptionUseCase.checkAndRevokeExpired(allUserIds);
    console.log('EXPIRED', expired);
    const starsPrice = parseInt(process.env.PREMIUM_STARS_PRICE || '1', 10);
    const starsAnnual = process.env.PREMIUM_STARS_ANNUAL ? parseInt(process.env.PREMIUM_STARS_ANNUAL, 10) : starsPrice * 12;
    const maxFree = parseInt(process.env.MAX_FREE_HABITS || '3', 10);
    const bot = botService.getBot();

    for (const { userId, premiumType } of expired) {
      try {
        if (premiumType === 'annual') {
          const annualLink = await bot.createInvoiceLink(
            'Premium Subscription (Annual)',
            'Unlimited habits for 1 year. One payment; no auto-renewal.',
            `sub_annual_${userId}`,
            '',
            'XTR',
            [{ label: 'Annual Premium', amount: starsAnnual }],
            {}
          );
          await bot.sendMessage(userId,
            `⚠️ Your annual Premium subscription has expired. Habits beyond the free limit of ${maxFree} have been paused.\n\nPay below to renew for another year.`,
            {
              reply_markup: {
                inline_keyboard: [[{ text: `Renew — ${starsAnnual} ⭐/year`, url: annualLink }]],
              },
            }
          );
        } else {
          await bot.sendMessage(userId,
            `⚠️ Your Premium subscription has expired. Habits beyond the free limit of ${maxFree} have been paused.\n\nUse /subscribe to renew and re-enable them.`
          );
        }
      } catch {
        Logger.error('Error sending expired subscription reminder', { userId });
        continue;
      }
    }
    
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

    // Skip users who have blocked the bot (they won't receive messages until they /start again)
    const usersToNotify: Array<[number, Habit[]]> = [];
    let skippedBlockedCount = 0;
    for (const [userId, habits] of habitsByUser.entries()) {
      const prefs = await habitRepository.getUserPreferences(userId);
      if (prefs?.blocked) {
        Logger.info('Skipping reminder for blocked user', { userId, habitCount: habits.length });
        skippedBlockedCount++;
        continue;
      }
      usersToNotify.push([userId, habits]);
    }

    let successCount = 0;
    let errorCount = 0;
    const errors: Array<{ userId: number; error: string }> = [];

    // Send reminders grouped by user (targetDate = user's "today" in their timezone)
    for (const [userId, habits] of usersToNotify) {
      try {
        const prefs = await habitRepository.getUserPreferences(userId);
        const userTimezone = prefs?.timezone || 'UTC';
        const targetDate = new Intl.DateTimeFormat('en-CA', {
          timeZone: userTimezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(now);
        Logger.info('Sending reminder to user', { userId, habitCount: habits.length, targetDate });
        await botService.sendHabitReminders(userId, habits, targetDate);
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
      skippedBlocked: skippedBlockedCount,
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
      skippedBlocked: skippedBlockedCount,
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
}

/** Read and parse JSON body from an HTTP request (for POST). */
function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve((raw ? JSON.parse(raw) : {}) as Record<string, unknown>);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function handleAnalyticsEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    // const initData = body.initData;

    // if (!initData || typeof initData !== 'string') {
    //   setJson(400, { error: 'initData is required' });
    //   return;
    // }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    // if (!validateTelegramInitData(initData, botToken)) {
    //   Logger.warn('Invalid Telegram initData signature');
    //   setJson(401, { error: 'Invalid authentication' });
    //   return;
    // }

    // const { user, authDate } = parseTelegramInitData(initData);

    // if (!isAuthDateValid(authDate)) {
    //   Logger.warn('Expired Telegram initData', { authDate });
    //   setJson(401, { error: 'Authentication expired' });
    //   return;
    // }

    // if (!user || !user.id) {
    //   Logger.warn('No user in Telegram initData');
    //   setJson(401, { error: 'Invalid authentication: no user data' });
    //   return;
    // }

    // const userIdNum = user.id;
    const userIdNum = parseInt('148654904', 10);

    const { habits: analyticsData, premium } = await getAnalyticsData(habitRepository, userIdNum);

    Logger.info('Analytics data retrieved', {
      userId: userIdNum,
      habitCount: analyticsData.length,
    });

    const notifications = new ChannelNotifications(botToken);
    notifications.sendAnalyticsPageVisitNotification(userIdNum).catch(error => {
      Logger.error('Error sending analytics page visit notification', {
        userId: userIdNum,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    });

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ habits: analyticsData, premium }));
  } catch (error) {
    Logger.error('Error fetching analytics data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    setJson(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleAnalyticsInsightsEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    // const initData = body.initData;

    // if (!initData || typeof initData !== 'string') {
    //   setJson(400, { error: 'initData is required' });
    //   return;
    // }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    // if (!validateTelegramInitData(initData, botToken)) {
    //   Logger.warn('Invalid Telegram initData signature');
    //   setJson(401, { error: 'Invalid authentication' });
    //   return;
    // }

    // const { user, authDate } = parseTelegramInitData(initData);

    // if (!isAuthDateValid(authDate)) {
    //   Logger.warn('Expired Telegram initData', { authDate });
    //   setJson(401, { error: 'Authentication expired' });
    //   return;
    // }

    // if (!user || !user.id) {
    //   Logger.warn('No user in Telegram initData');
    //   setJson(401, { error: 'Invalid authentication: no user data' });
    //   return;
    // }

    // const userIdNum = user.id;
    const userIdNum = parseInt('148654904', 10);
    Logger.info('Analytics insights: auth ok', { userId: userIdNum });

    const insights = await getAnalyticsInsights(habitRepository, userIdNum);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ insights }));
  } catch (error) {
    Logger.error('Error generating analytics insights', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    setJson(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleCheckEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    const initData = body.initData;
    const habitId = body.habitId;
    const action = body.action;
    const note = body.note;
    const targetDate = body.targetDate;
    const chatId = body.chatId;
    const msgId = body.msgId;

    if (!initData || typeof initData !== 'string') {
      setJson(400, { error: 'initData is required' });
      return;
    }

    if (!habitId || typeof habitId !== 'string') {
      setJson(400, { error: 'habitId is required' });
      return;
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    if (!validateTelegramInitData(initData, botToken)) {
      Logger.warn('Invalid Telegram initData signature');
      setJson(401, { error: 'Invalid authentication' });
      return;
    }

    const { user, authDate } = parseTelegramInitData(initData);

    if (!isAuthDateValid(authDate)) {
      Logger.warn('Expired Telegram initData', { authDate });
      setJson(401, { error: 'Authentication expired' });
      return;
    }

    if (!user || !user.id) {
      Logger.warn('No user in Telegram initData');
      setJson(401, { error: 'Invalid authentication: no user data' });
      return;
    }

    const userId = user.id;
    const username = user.username || [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || undefined;

    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
    const habits = await getUserHabitsUseCase.execute(userId);
    const habit = habits.find(h => h.id === habitId);

    if (!habit) {
      setJson(404, { error: 'Habit not found' });
      return;
    }

    // Load mode: no action
    if (!action) {
      const preferencesUseCase = new SetUserPreferencesUseCase(habitRepository);
      const preferences = await preferencesUseCase.getPreferences(userId);
      const timezone = preferences?.timezone || 'UTC';

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        habitName: habit.name,
        lastCheckedDate: habit.lastCheckedDate || null,
        timezone,
      }));
      return;
    }

    // Save mode
    if (typeof action !== 'string' || !['complete', 'skip', 'drop'].includes(action)) {
      setJson(400, { error: 'Invalid action. Use complete, skip, or drop.' });
      return;
    }

    const checkDate = typeof targetDate === 'string' && targetDate.trim()
      ? targetDate.trim()
      : new Date().toISOString().split('T')[0];

    const recordHabitCheckUseCase = new RecordHabitCheckUseCase(habitRepository);
    const noteStr = typeof note === 'string' && note.trim().length > 0 ? note.trim().slice(0, 500) : undefined;

    let updatedHabit;
    if (action === 'complete') {
      updatedHabit = await recordHabitCheckUseCase.execute(userId, habitId, true, username, checkDate);
    } else if (action === 'drop') {
      updatedHabit = await recordHabitCheckUseCase.execute(userId, habitId, false, username, checkDate, noteStr);
    } else {
      updatedHabit = await recordHabitCheckUseCase.skipHabit(userId, habitId, username, checkDate, noteStr);
    }

    Logger.info('Habit check via MiniApp', {
      userId,
      habitId,
      habitName: habit.name,
      action,
      checkDate,
    });

    const chatIdNum = chatId != null && msgId != null ? Number(chatId) : undefined;
    const msgIdNum = chatId != null && msgId != null ? Number(msgId) : undefined;
    if (botToken && chatIdNum != null && msgIdNum != null && !Number.isNaN(chatIdNum) && !Number.isNaN(msgIdNum)) {
      const editUrl = `https://api.telegram.org/bot${botToken}/editMessageText`;
      const editRes = await fetch(editUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatIdNum,
          message_id: msgIdNum,
          text: `✅ Checked: Did you "${habit.name}" today?`,
          reply_markup: { inline_keyboard: [] },
        }),
      });
      if (!editRes.ok) {
        const err = await editRes.json().catch(() => ({}));
        Logger.warn('Failed to edit reminder message after MiniApp check', { chatId: chatIdNum, messageId: msgIdNum, error: err });
      }
    }

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      streak: updatedHabit.streak,
      lastCheckedDate: updatedHabit.lastCheckedDate,
    }));
  } catch (error) {
    Logger.error('Error in check endpoint', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    setJson(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export async function handleUsersEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    const initData = body.initData;

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    const fullUrl = req.url || '/';
    const urlObj = new URL(fullUrl, 'http://localhost');
    const query: Record<string, string | string[] | undefined> = {};
    urlObj.searchParams.forEach((value, key) => {
      const existing = query[key];
      if (existing === undefined) {
        query[key] = value;
      } else if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        query[key] = [existing, value];
      }
    });

    const result = await runAdminUsersList(
      typeof initData === 'string' ? initData : '',
      botToken,
      query,
      habitRepository
    );
    setJson(result.status, result.body);
  } catch (error) {
    logAdminUsersError(error);
    setJson(500, { error: 'Internal server error' });
  }
}

export async function handleSendMessageEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    const initData = typeof body.initData === 'string' ? body.initData : '';
    const result = await runAdminSendMessage(initData, botToken, body as Record<string, unknown>, habitRepository);
    setJson(result.status, result.body);
  } catch (error) {
    logAdminSendMessageError(error);
    setJson(500, { error: 'Internal server error' });
  }
}

export async function handleGrantLifetimePremiumEndpoint(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  habitRepository: VercelKVHabitRepository
): Promise<void> {
  const setJson = (code: number, body: object) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  try {
    if (req.method !== 'POST') {
      setJson(405, { error: 'Method not allowed' });
      return;
    }

    const body = await readJsonBody(req);
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      setJson(500, { error: 'Server configuration error' });
      return;
    }

    const initData = typeof body.initData === 'string' ? body.initData : '';
    const result = await runGrantLifetimePremium(initData, botToken, body as Record<string, unknown>, habitRepository);
    setJson(result.status, result.body);
  } catch (error) {
    logGrantLifetimePremiumError(error);
    setJson(500, { error: 'Internal server error' });
  }
}

async function serveStaticFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: string
): Promise<void> {
  console.log({__dirname});
  const publicDir = resolve(process.cwd(), 'public');
  
  console.log('publicDir', publicDir);
  // Handle analytics route: /analytics/{userId} or /analytics/mock
  const analyticsMatch = url.match(/^\/analytics\/(\d+|mock)$/);
  if (analyticsMatch) {
    const userId = analyticsMatch[1];
    const analyticsPath = join(publicDir, 'analytics.html');
    console.log('analyticsPath', analyticsPath);
    console.log('existsSync(analyticsPath)', existsSync(analyticsPath));
    if (existsSync(analyticsPath)) {
      let content = readFileSync(analyticsPath, 'utf-8');
      // Inject userId into the page (the JS will also read from URL, but this ensures it's available)
      content = content.replace(
        /const userId = .*?;/,
        `const userId = '${userId}';`
      );
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
  }
  
  // Remove query parameters
  let filePath = url.split('?')[0];
  
  // Handle root path
  if (filePath === '/') {
    filePath = '/index.html';
  }
  
  // Remove leading slash
  filePath = filePath.startsWith('/') ? filePath.slice(1) : filePath;
  
  let fullPath = resolve(publicDir, filePath);
  
  // Security: prevent directory traversal
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  
  // Check if file exists as-is
  if (existsSync(fullPath) && statSync(fullPath).isFile()) {
    // File exists, serve it
    const content = readFileSync(fullPath);
    const ext = extname(fullPath).toLowerCase();
    const contentTypeMap: Record<string, string> = {
      '.html': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.woff': 'font/woff',
      '.woff2': 'font/woff2',
      '.ttf': 'font/ttf',
    };
    const contentType = contentTypeMap[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return;
  }
  
  // If it's a directory, try serving index.html from that directory
  if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
    const indexPath = join(fullPath, 'index.html');
    if (existsSync(indexPath)) {
      const content = readFileSync(indexPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
  }
  
  // If file doesn't exist, try adding .html extension
  if (!filePath.endsWith('.html')) {
    const htmlPath = filePath + '.html';
    const htmlFullPath = resolve(publicDir, htmlPath);
    
    // Security check again
    if (htmlFullPath.startsWith(publicDir) && existsSync(htmlFullPath) && statSync(htmlFullPath).isFile()) {
      const content = readFileSync(htmlFullPath);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(content);
      return;
    }
  }
  
  // If still not found, try serving root index.html for SPA routing
  const indexPath = join(publicDir, 'index.html');
  if (existsSync(indexPath)) {
    const content = readFileSync(indexPath);
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(content);
    return;
  }
  
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found!');
}

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
    const url = req.url || '/';
    const pathname = url.split('?')[0];

    // Handle API routes
    if (pathname.startsWith('/api/')) {
      // Handle /api/reminders POST request
      if (req.method === 'POST' && pathname === '/api/reminders') {
        await handleRemindersEndpoint(req, res, botService, habitRepository, port);
        return;
      }

      // Handle /api/analytics POST (habits + premium; same as production)
      if (req.method === 'POST' && pathname === '/api/analytics') {
        await handleAnalyticsEndpoint(req, res, habitRepository);
        return;
      }

      // Handle /api/analytics-insights POST (AI insights; same as production)
      if (req.method === 'POST' && pathname === '/api/analytics-insights') {
        await handleAnalyticsInsightsEndpoint(req, res, habitRepository);
        return;
      }

      // Handle /api/check POST (habit check MiniApp; same as production)
      if (req.method === 'POST' && pathname === '/api/check') {
        await handleCheckEndpoint(req, res, habitRepository);
        return;
      }

      // Admin panel: list users (same as production api/users)
      if (req.method === 'POST' && pathname === '/api/users') {
        await handleUsersEndpoint(req, res, habitRepository);
        return;
      }

      // Admin: send message (same as production api/send-message)
      if (req.method === 'POST' && pathname === '/api/send-message') {
        await handleSendMessageEndpoint(req, res, habitRepository);
        return;
      }

      // Admin: grant/revoke lifetime premium
      if (req.method === 'POST' && pathname === '/api/grant-lifetime-premium') {
        await handleGrantLifetimePremiumEndpoint(req, res, habitRepository);
        return;
      }

      // Other API routes return 404
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found.' }));
      return;
    }
    
    // Serve static files from public directory
    try {
      await serveStaticFile(req, res, url);
    } catch (error) {
      console.error('Error serving static file:', error);
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal server error');
    }
  });

  server.listen(port, () => {
    console.log(`Reminders API server running on port ${port}`);
    console.log(`Static files served from public/ directory`);
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
