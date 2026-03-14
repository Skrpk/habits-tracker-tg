import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { SetHabitReminderScheduleUseCase } from '../src/domain/use-cases/SetHabitReminderScheduleUseCase';
import { SetUserPreferencesUseCase } from '../src/domain/use-cases/SetUserPreferencesUseCase';
import { CheckHabitReminderDueUseCase } from '../src/domain/use-cases/CheckHabitReminderDueUseCase';
import { Logger } from '../src/infrastructure/logger/Logger';
import { kv } from '../src/infrastructure/config/kv';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../src/infrastructure/auth/validateTelegramInitData';
import { ReminderSchedule } from '../src/domain/entities/Habit';

function authenticateRequest(initData: string, botToken: string): { userId: number } {
  if (!validateTelegramInitData(initData, botToken)) {
    throw { status: 401, message: 'Invalid authentication' };
  }

  const { user, authDate } = parseTelegramInitData(initData);

  if (!isAuthDateValid(authDate)) {
    throw { status: 401, message: 'Authentication expired' };
  }

  if (!user || !user.id) {
    throw { status: 401, message: 'Invalid authentication: no user data' };
  }

  return { userId: user.id };
}

async function editTelegramMessage(
  botToken: string,
  chatId: number,
  messageId: number,
  text: string
): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    Logger.warn('Failed to edit Telegram message', { chatId, messageId, error });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData, habitId, schedule, chatId, msgId, isNew } = req.body || {};

    if (!initData || typeof initData !== 'string') {
      return res.status(400).json({ error: 'initData is required' });
    }

    if (!habitId || typeof habitId !== 'string') {
      return res.status(400).json({ error: 'habitId is required' });
    }

    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      Logger.error('TELEGRAM_BOT_TOKEN not configured');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    let userId: number;
    try {
      ({ userId } = authenticateRequest(initData, botToken));
    } catch (authError: any) {
      return res.status(authError.status || 401).json({ error: authError.message });
    }

    const habitRepository = new VercelKVHabitRepository();
    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);

    const habits = await getUserHabitsUseCase.execute(userId);
    const habit = habits.find(h => h.id === habitId);

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Mode 1: Load habit info and user timezone
    if (!schedule) {
      const preferencesUseCase = new SetUserPreferencesUseCase(habitRepository);
      const preferences = await preferencesUseCase.getPreferences(userId);
      const timezone = preferences?.timezone || 'UTC';

      return res.status(200).json({
        timezone,
        habitName: habit.name,
        currentSchedule: habit.reminderSchedule || null,
      });
    }

    // Mode 2: Save schedule
    const reminderSchedule = schedule as ReminderSchedule;

    const setScheduleUseCase = new SetHabitReminderScheduleUseCase(habitRepository);
    const updatedHabit = await setScheduleUseCase.execute(userId, habitId, reminderSchedule);

    const checkReminderDue = new CheckHabitReminderDueUseCase();
    const scheduleDesc = checkReminderDue.getScheduleDescription(reminderSchedule);

    Logger.info('Schedule set via MiniApp', {
      userId,
      habitId,
      habitName: updatedHabit.name,
      schedule: reminderSchedule,
    });

    // Edit the Telegram message with confirmation
    if (chatId && msgId) {
      const confirmationText = isNew === '1'
        ? `✅ Habit "${updatedHabit.name}" is ready!\n\nSchedule: ${scheduleDesc}\n\nView all your habits with /myhabits`
        : `✅ Reminder schedule updated!\n\nHabit: ${updatedHabit.name}\nSchedule: ${scheduleDesc}`;

      await editTelegramMessage(botToken, Number(chatId), Number(msgId), confirmationText);
    }

    // Clear conversation state
    await kv.del(`conversation_state:${userId}`);

    return res.status(200).json({ ok: true, scheduleDesc });
  } catch (error) {
    Logger.error('Error in schedule endpoint', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
