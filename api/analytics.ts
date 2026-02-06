import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { Logger } from '../src/infrastructure/logger/Logger';
import { computeCheckHistory } from '../src/domain/utils/HabitAnalytics';
import { ChannelNotifications } from '../src/infrastructure/notifications/ChannelNotifications';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const userId = req.query.userId as string;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const userIdNum = parseInt(userId, 10);
    if (isNaN(userIdNum)) {
      return res.status(400).json({ error: 'Invalid userId' });
    }

    const habitRepository = new VercelKVHabitRepository();
    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
    
    const habits = await getUserHabitsUseCase.execute(userIdNum);
    
    // Return habits with analytics data (compute checkHistory on demand)
    const analyticsData = habits.map(habit => ({
      id: habit.id,
      name: habit.name,
      streak: habit.streak,
      createdAt: habit.createdAt,
      lastCheckedDate: habit.lastCheckedDate,
      skipped: habit.skipped || [],
      dropped: habit.dropped || [],
      badges: habit.badges || [], // Include badges
      checkHistory: computeCheckHistory(habit), // Compute from streak, creation date, skips, and drops
      disabled: habit.disabled || false,
      reminderSchedule: habit.reminderSchedule,
      reminderEnabled: habit.reminderEnabled,
    }));

    Logger.info('Analytics data retrieved', {
      userId: userIdNum,
      habitCount: analyticsData.length,
    });

    // Send notification to channel (async, don't block response)
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (botToken) {
      const notifications = new ChannelNotifications(botToken);
      notifications.sendAnalyticsPageVisitNotification(userIdNum).catch(error => {
        Logger.error('Error sending analytics page visit notification', {
          userId: userIdNum,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }

    // Set CORS headers to allow access from the web page
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
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
