import TelegramBot from 'node-telegram-bot-api';

export interface UserPreferences {
  userId: number;
  user?: TelegramBot.User; // Full Telegram user object with all user information
  timezone?: string; // IANA timezone (e.g., "America/New_York", "Europe/London")
  consentAccepted?: boolean; // Whether user has accepted the privacy policy and terms
  consentDate?: string; // ISO date string when consent was given (YYYY-MM-DD)
}
