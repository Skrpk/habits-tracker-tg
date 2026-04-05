import type { VercelRequest, VercelResponse } from '@vercel/node';
import { VercelKVHabitRepository } from '../src/infrastructure/repositories/VercelKVHabitRepository';
import { GetUserHabitsUseCase } from '../src/domain/use-cases/GetUserHabitsUseCase';
import { SetUserPreferencesUseCase } from '../src/domain/use-cases/SetUserPreferencesUseCase';
import { RecordHabitCheckUseCase } from '../src/domain/use-cases/RecordHabitCheckUseCase';
import { Logger } from '../src/infrastructure/logger/Logger';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../src/infrastructure/auth/validateTelegramInitData';

function authenticateRequest(initData: string, botToken: string): { userId: number; username?: string } {
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

  const username = user.username || [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || undefined;
  return { userId: user.id, username };
}

async function editTelegramReminderMessage(
  botToken: string,
  chatId: number,
  messageId: number,
  habitName: string
): Promise<void> {
  const text = `✅ Checked: Did you "${habitName}" today?`;
  const url = `https://api.telegram.org/bot${botToken}/editMessageText`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      message_id: messageId,
      text,
      reply_markup: { inline_keyboard: [] },
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    Logger.warn('Failed to edit reminder message after MiniApp check', { chatId, messageId, error });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { initData, habitId, action, note, targetDate, chatId, msgId } = req.body || {};

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
    let username: string | undefined;
    try {
      ({ userId, username } = authenticateRequest(initData, botToken));
    } catch (authError: unknown) {
      const err = authError as { status?: number; message?: string };
      return res.status(err.status || 401).json({ error: err.message });
    }

    const habitRepository = new VercelKVHabitRepository();
    const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);

    const habits = await getUserHabitsUseCase.execute(userId);
    const habit = habits.find(h => h.id === habitId);

    if (!habit) {
      return res.status(404).json({ error: 'Habit not found' });
    }

    // Load mode: no action -> return habit info for MiniApp
    if (!action) {
      const preferencesUseCase = new SetUserPreferencesUseCase(habitRepository);
      const preferences = await preferencesUseCase.getPreferences(userId);
      const timezone = preferences?.timezone || 'UTC';

      return res.status(200).json({
        habitName: habit.name,
        lastCheckedDate: habit.lastCheckedDate || null,
        timezone,
      });
    }

    // Save mode: action must be complete | skip | drop
    if (!['complete', 'skip', 'drop'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use complete, skip, or drop.' });
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

    const chatIdNum = chatId != null && msgId != null
      ? Number(chatId)
      : undefined;
    const msgIdNum = chatId != null && msgId != null
      ? Number(msgId)
      : undefined;
    if (chatIdNum != null && msgIdNum != null && !Number.isNaN(chatIdNum) && !Number.isNaN(msgIdNum)) {
      await editTelegramReminderMessage(botToken, chatIdNum, msgIdNum, habit.name);
    }

    return res.status(200).json({
      ok: true,
      streak: updatedHabit.streak,
      lastCheckedDate: updatedHabit.lastCheckedDate,
    });
  } catch (error) {
    Logger.error('Error in check endpoint', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
