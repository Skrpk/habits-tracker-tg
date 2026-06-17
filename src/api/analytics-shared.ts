import type { IHabitRepository } from '../domain/repositories/IHabitRepository';
import type { Habit } from '../domain/entities/Habit';
import { GetUserHabitsUseCase } from '../domain/use-cases/GetUserHabitsUseCase';
import { SubscriptionUseCase } from '../domain/use-cases/SubscriptionUseCase';
import { computeCheckHistory } from '../domain/utils/HabitAnalytics';
import { kv } from '../infrastructure/config/kv';
import { Logger } from '../infrastructure/logger/Logger';
import OpenAI from 'openai';

const INSIGHTS_CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

function getInsightsCacheKey(userId: number): string {
  return `insights:${userId}`;
}

function isValidInsightsCache(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  for (const v of Object.values(value)) {
    if (typeof v !== 'string') return false;
  }
  return true;
}

const INSIGHTS_SYSTEM_PROMPT = `You are a habits analytics expert. You will receive JSON data for a user's habits and must produce short, actionable insights for each habit.

## Product context (do not recommend these—they already exist)

This data comes from a Telegram habit-tracking bot. The bot already sends reminders automatically at each habit's configured time (daily, weekly, monthly, or interval). If reminderSchedule is present, the user has reminders set up—do not suggest setting up or enabling reminders. Users respond to reminder messages with Yes (complete), No (drop streak), or Skip (keep streak); streaks, skips, and drops are tracked automatically. Users can add optional notes when skipping or dropping. Badges (5, 10, 30, 90 days) are awarded automatically. Focus insights on patterns, consistency, and behavioral tips—not on enabling features the bot already provides.

## Data model

**Daily habits** (reminderSchedule.type === "daily"):
- Completions are inferred from current streak and from skipped/dropped days; there is no explicit "checked" list.
- checkHistory is an array of events in chronological order: each entry has date (YYYY-MM-DD), type ("completed" | "skipped" | "dropped"), streak (after this event), and optionally streakBefore (for drops) and note (for skip/drop).
- A "completed" day increments the streak; "skipped" keeps the streak; "dropped" resets streak to 0.

**Non-daily habits** (weekly, monthly, or interval):
- reminderSchedule can be: weekly (daysOfWeek: 0-6), monthly (daysOfMonth: 1-31), or interval (intervalDays, startDate).
- The "checked" array holds explicit completion dates (YYYY-MM-DD). checkHistory merges checked, skipped, and dropped events.

**Common fields:**
- skipped[]: { streakDay, date, note? }
- dropped[]: { streakBeforeDrop, date, note? }
- badges[]: { type: 5|10|30|90, earnedAt }
- reminderSchedule: { type, hour, minute, timezone?, daysOfWeek?|daysOfMonth?|intervalDays?, startDate? }
- reminderEnabled, disabled

## Output format

Respond with a single JSON object only (no markdown, no code fences): { "<habitId>": "<html string>", ... }. One key per habit id; value is an HTML fragment for that habit's insights.

## HTML rules

Use ONLY these CSS classes so the page can style the content: insights-section, insights-title, insights-paragraph, insights-highlight, insights-list, insights-item, insights-tip.
Use only safe tags: p, ul, li, strong, span, div. Do not use script, style, or event attributes.`;

export interface AnalyticsHabitItem {
  id: string;
  name: string;
  streak: number;
  createdAt: Date;
  lastCheckedDate: string;
  skipped: Habit['skipped'];
  dropped: Habit['dropped'];
  badges: Habit['badges'];
  checkHistory: ReturnType<typeof computeCheckHistory>;
  disabled: boolean;
  reminderSchedule: Habit['reminderSchedule'];
  reminderEnabled: Habit['reminderEnabled'];
}

/**
 * Shared analytics data (habits + premium). Used by both Vercel api/analytics and local reminders-server.
 */
export async function getAnalyticsData(
  habitRepository: IHabitRepository,
  userId: number
): Promise<{ habits: AnalyticsHabitItem[]; premium: boolean }> {
  const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
  const subscriptionUseCase = new SubscriptionUseCase(habitRepository);

  const [habits, premium] = await Promise.all([
    getUserHabitsUseCase.execute(userId),
    subscriptionUseCase.isSubscribed(userId),
  ]);

  const analyticsData: AnalyticsHabitItem[] = habits.map(habit => ({
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

  return { habits: analyticsData, premium };
}

/**
 * Shared analytics insights (premium check, cache, OpenAI). Used by both Vercel api/analytics-insights and local reminders-server.
 */
export async function getAnalyticsInsights(
  habitRepository: IHabitRepository,
  userId: number,
  options: { openaiApiKey?: string } = {}
): Promise<Record<string, string>> {
  // AI insights temporarily disabled: do not call OpenAI. Always return no insights.
  Logger.info('Analytics insights: disabled, returning empty', { userId });
  return {};

  /* eslint-disable no-unreachable */
  /*
  const subscriptionUseCase = new SubscriptionUseCase(habitRepository);
  const isPremium = await subscriptionUseCase.isSubscribed(userId);

  if (!isPremium) {
    Logger.info('Analytics insights: user not premium, returning empty', { userId });
    return {};
  }

  const cacheKey = getInsightsCacheKey(userId);
  Logger.info('Analytics insights: checking cache', { userId, cacheKey });
  const cached = await kv.get(cacheKey);
  if (isValidInsightsCache(cached)) {
    Logger.info('Analytics insights: cache hit, returning cached insights', {
      userId,
      habitCount: Object.keys(cached).length,
    });
    return cached;
  }

  Logger.info('Analytics insights: cache miss, calling OpenAI', { userId });

  const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    Logger.warn('OPENAI_API_KEY not set; returning empty insights');
    return {};
  }

  const getUserHabitsUseCase = new GetUserHabitsUseCase(habitRepository);
  const habits = await getUserHabitsUseCase.execute(userId);
  Logger.info('Analytics insights: habits loaded', { userId, habitCount: habits.length });

  const habitsPayload = habits.map(habit => ({
    id: habit.id,
    name: habit.name,
    streak: habit.streak,
    createdAt: habit.createdAt,
    lastCheckedDate: habit.lastCheckedDate,
    skipped: habit.skipped || [],
    dropped: habit.dropped || [],
    checked: habit.checked || [],
    badges: habit.badges || [],
    checkHistory: computeCheckHistory(habit),
    disabled: habit.disabled || false,
    reminderSchedule: habit.reminderSchedule,
    reminderEnabled: habit.reminderEnabled,
  }));

  const openai = new OpenAI({ apiKey });
  Logger.info('Analytics insights: calling OpenAI chat completion', { userId });
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: INSIGHTS_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(habitsPayload) },
    ],
    response_format: { type: 'json_object' },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    Logger.warn('Empty or invalid OpenAI response for analytics insights');
    return {};
  }

  Logger.info('Analytics insights: OpenAI response received', { userId });

  let parsed: Record<string, string>;
  try {
    parsed = JSON.parse(content) as Record<string, string>;
  } catch (parseError) {
    Logger.error('Failed to parse OpenAI insights JSON', {
      error: parseError instanceof Error ? parseError.message : 'Unknown error',
    });
    return {};
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    Logger.warn('Analytics insights: parsed result is not an object');
    return {};
  }

  const insights: Record<string, string> = {};
  for (const [habitId, html] of Object.entries(parsed)) {
    if (typeof html === 'string' && habitId) {
      insights[habitId] = html;
    }
  }

  Logger.info('Analytics insights: writing cache', {
    userId,
    habitCount: Object.keys(insights).length,
    ttlSeconds: INSIGHTS_CACHE_TTL_SECONDS,
  });
  await kv.setWithExpiry(cacheKey, insights, INSIGHTS_CACHE_TTL_SECONDS);

  Logger.info('Analytics insights: returning insights', {
    userId,
    habitCount: Object.keys(insights).length,
  });
  return insights;
  */
  /* eslint-enable no-unreachable */
}
