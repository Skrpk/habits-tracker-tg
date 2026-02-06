import TelegramBot from 'node-telegram-bot-api';
import { Logger } from '../logger/Logger';
import { SetUserPreferencesUseCase } from '../../domain/use-cases/SetUserPreferencesUseCase';
import { VercelKVHabitRepository } from '../repositories/VercelKVHabitRepository';

/**
 * Helper class for sending notifications to Telegram channel
 * Can be used from both bot service and API endpoints
 */
export class ChannelNotifications {
  private bot: TelegramBot;
  private setUserPreferencesUseCase: SetUserPreferencesUseCase;

  constructor(botToken: string) {
    this.bot = new TelegramBot(botToken);
    const habitRepository = new VercelKVHabitRepository();
    this.setUserPreferencesUseCase = new SetUserPreferencesUseCase(habitRepository);
  }

  async sendAnalyticsPageVisitNotification(userId: number): Promise<void> {
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
}
