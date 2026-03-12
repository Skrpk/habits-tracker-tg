import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { Logger } from '../src/infrastructure/logger/Logger';
import { computeCheckHistory } from '../src/domain/utils/HabitAnalytics';
import { ChannelNotifications } from '../src/infrastructure/notifications/ChannelNotifications';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../src/infrastructure/auth/validateTelegramInitData';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData } = req.body || {};

    if (!initData || typeof initData !== 'string') {
      return res.status(400).json({ error: 'initData is required' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    if (!validateTelegramInitData(initData, botToken)) {
      Logger.warn('Invalid Telegram initData signature');
      return res.status(401).json({ error: 'Invalid authentication' });
    }

    const { user, authDate } = parseTelegramInitData(initData);

    if (!isAuthDateValid(authDate)) {
      Logger.warn('Expired Telegram initData', { authDate });
      return res.status(401).json({ error: 'Authentication expired' });
    }

    if (!user || !user.id) {
      Logger.warn('No user in Telegram initData');
      return res.status(401).json({ error: 'Invalid authentication: no user data' });
    }

    const userIdNum = user.id;

    const habitRepository = new VercelKVHabitRepository();
    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);

    const habits = await getUserHabitsUseCase.execute(userIdNum);

    const analyticsData = habits.map(habit => ({
      id: habit.id,
      name: habit.name,
      streak: habit.streak,
      createdAt: habit.createdAt,
      lastCheckedDate: habit.lastCheckedDate,
      skipped: habit.skipped || [],
      dropped: habit.dropped || [],
      badges: habit.badges || [],
      checkHistory: computeCheckHistory(habit),
      disabled: habit.disabled || false,
      reminderSchedule: habit.reminderSchedule,
      reminderEnabled: habit.reminderEnabled,
    }));

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

    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json({ habits: analyticsData });
  } catch (error) {
    Logger.error('Error fetching analytics data', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
