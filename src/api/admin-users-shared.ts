import { VercelKVHabitRepository } from '../infrastructure/repositories/VercelKVHabitRepository';
import { Logger } from '../infrastructure/logger/Logger';
import { validateTelegramInitData, parseTelegramInitData, isAuthDateValid } from '../infrastructure/auth/validateTelegramInitData';
import { parseAdminUsers } from '../infrastructure/admin/parseAdminUsers';
import { ALLOWED_TIMEZONE_IDS } from '../constants/allowedTimezones';
import type { Habit } from '../domain/entities/Habit';
import type { UserPreferences } from '../domain/entities/UserPreferences';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;
const SEND_MESSAGE_BATCH_SIZE = 1000;
const MAX_FAILURES_IN_RESPONSE = 50;

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

function firstQueryString(value: string | string[] | undefined): string | undefined {
  if (value === undefined || value === '') return undefined;
  const s = Array.isArray(value) ? value[0] : value;
  if (s === '') return undefined;
  return s;
}

function parseBoolQuery(value: string | string[] | undefined): boolean | undefined {
  if (value === undefined || value === '') return undefined;
  const s = Array.isArray(value) ? value[0] : value;
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isValidIsoDateOnly(s: string): boolean {
  const m = ISO_DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseOptionalFilterUserIdString(raw: string | undefined): { error?: string; id?: number } {
  if (raw === undefined) return {};
  const t = raw.trim();
  if (t === '') return {};
  if (!/^\d+$/.test(t)) return { error: 'Invalid userId filter' };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n <= 0) return { error: 'Invalid userId filter' };
  return { id: n };
}

function parseConsentDateRange(
  fromRaw: string | undefined,
  toRaw: string | undefined
): { error?: string; consentDateFrom?: string; consentDateTo?: string } {
  const from = fromRaw?.trim() ? fromRaw.trim() : undefined;
  const to = toRaw?.trim() ? toRaw.trim() : undefined;
  if (!from && !to) return {};
  if (from && !isValidIsoDateOnly(from)) return { error: 'Invalid consentDateFrom' };
  if (to && !isValidIsoDateOnly(to)) return { error: 'Invalid consentDateTo' };
  if (from && to && from > to) return { error: 'consentDateFrom must be <= consentDateTo' };
  const out: { consentDateFrom?: string; consentDateTo?: string } = {};
  if (from) out.consentDateFrom = from;
  if (to) out.consentDateTo = to;
  return out;
}

function parseOptionalFilterUserIdBody(body: Record<string, unknown>): { error?: string; id?: number } {
  const v = body.userId;
  if (v === undefined || v === null || v === '') return {};
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (!Number.isInteger(v) || v <= 0) return { error: 'Invalid userId filter' };
    return { id: v };
  }
  if (typeof v === 'string') return parseOptionalFilterUserIdString(v);
  return { error: 'Invalid userId filter' };
}

/** Same semantics as query string: `isAdmin` = premium filter. */
function parseBoolBody(value: unknown): boolean | undefined {
  if (value === true) return true;
  if (value === false) return false;
  if (typeof value === 'string') {
    if (value === 'true') return true;
    if (value === 'false') return false;
  }
  return undefined;
}

export type AdminFilterOptions = {
  /** true = premium only, false = non-premium only */
  isAdminFilter?: boolean;
  isBlockedFilter?: boolean;
  timezoneFilter?: string;
  /** Exact Telegram user id (query/body key `userId`) */
  filterUserId?: number;
  /** Inclusive YYYY-MM-DD on `UserPreferences.consentDate` */
  consentDateFrom?: string;
  consentDateTo?: string;
};

export function parseAdminFiltersFromQuery(
  query: Record<string, string | string[] | undefined>
): { error?: string; filters: AdminFilterOptions } {
  const isAdminFilter = parseBoolQuery(query.isAdmin);
  const isBlockedFilter = parseBoolQuery(query.isBlocked);
  const timezoneParam = query.Timezone ?? query.timezone;
  const timezoneFilter =
    typeof timezoneParam === 'string'
      ? timezoneParam
      : Array.isArray(timezoneParam)
        ? timezoneParam[0]
        : undefined;

  if (timezoneFilter && !ALLOWED_TIMEZONE_IDS.includes(timezoneFilter)) {
    return { error: 'Invalid Timezone filter', filters: {} };
  }

  const uidParsed = parseOptionalFilterUserIdString(firstQueryString(query.userId));
  if (uidParsed.error) return { error: uidParsed.error, filters: {} };

  const consentParsed = parseConsentDateRange(
    firstQueryString(query.consentDateFrom),
    firstQueryString(query.consentDateTo)
  );
  if (consentParsed.error) return { error: consentParsed.error, filters: {} };

  return {
    filters: {
      isAdminFilter,
      isBlockedFilter,
      timezoneFilter,
      filterUserId: uidParsed.id,
      consentDateFrom: consentParsed.consentDateFrom,
      consentDateTo: consentParsed.consentDateTo,
    },
  };
}

export function parseAdminFiltersFromBody(body: Record<string, unknown>): { error?: string; filters: AdminFilterOptions } {
  const isAdminFilter = parseBoolBody(body.isAdmin);
  const isBlockedFilter = parseBoolBody(body.isBlocked);
  const tz = body.Timezone ?? body.timezone;
  const timezoneFilter = typeof tz === 'string' ? tz : undefined;

  if (timezoneFilter && !ALLOWED_TIMEZONE_IDS.includes(timezoneFilter)) {
    return { error: 'Invalid Timezone filter', filters: {} };
  }

  const uidParsed = parseOptionalFilterUserIdBody(body);
  if (uidParsed.error) return { error: uidParsed.error, filters: {} };

  const cf = typeof body.consentDateFrom === 'string' ? body.consentDateFrom : undefined;
  const ct = typeof body.consentDateTo === 'string' ? body.consentDateTo : undefined;
  const consentParsed = parseConsentDateRange(cf, ct);
  if (consentParsed.error) return { error: consentParsed.error, filters: {} };

  return {
    filters: {
      isAdminFilter,
      isBlockedFilter,
      timezoneFilter,
      filterUserId: uidParsed.id,
      consentDateFrom: consentParsed.consentDateFrom,
      consentDateTo: consentParsed.consentDateTo,
    },
  };
}

/**
 * Active users whose preferences match the same filters as the admin users list.
 */
export async function getFilteredUserIdsForAdmin(
  habitRepository: VercelKVHabitRepository,
  filters: AdminFilterOptions
): Promise<number[]> {
  const allIds = await habitRepository.getAllActiveUserIds();
  const result: number[] = [];

  for (const uid of allIds) {
    const prefs = await habitRepository.getUserPreferences(uid);

    if (filters.filterUserId !== undefined && uid !== filters.filterUserId) continue;

    if (filters.isAdminFilter === true && !prefs?.premium) continue;
    if (filters.isAdminFilter === false && prefs?.premium === true) continue;

    if (filters.isBlockedFilter === true && prefs?.blocked !== true) continue;
    if (filters.isBlockedFilter === false && prefs?.blocked === true) continue;

    if (filters.timezoneFilter && prefs?.timezone !== filters.timezoneFilter) continue;

    const consentRangeActive =
      filters.consentDateFrom !== undefined || filters.consentDateTo !== undefined;
    if (consentRangeActive) {
      if (!prefs?.consentAccepted || !prefs.consentDate) continue;
      const cd = prefs.consentDate;
      if (filters.consentDateFrom !== undefined && cd < filters.consentDateFrom) continue;
      if (filters.consentDateTo !== undefined && cd > filters.consentDateTo) continue;
    }

    result.push(uid);
  }

  return result;
}

function serializeHabit(h: Habit) {
  return {
    id: h.id,
    name: h.name,
    streak: h.streak,
    createdAt: h.createdAt instanceof Date ? h.createdAt.toISOString() : String(h.createdAt),
    lastCheckedDate: h.lastCheckedDate,
    disabled: h.disabled === true,
    reminderEnabled: h.reminderEnabled !== false,
  };
}

function serializePreferences(p: UserPreferences | null, userId: number) {
  if (!p) {
    return { userId, timezone: undefined as string | undefined, blocked: undefined, premium: undefined };
  }
  return {
    userId: p.userId,
    timezone: p.timezone,
    blocked: p.blocked === true,
    premium: p.premium === true,
    premiumDate: p.premiumDate,
    premiumType: p.premiumType,
    consentAccepted: p.consentAccepted,
    consentDate: p.consentDate,
    telegram: p.user
      ? {
          id: p.user.id,
          username: p.user.username,
          first_name: p.user.first_name,
          last_name: p.user.last_name,
        }
      : undefined,
  };
}

/**
 * Shared admin users list (POST + initData + query filters). Used by api/users and reminders-server.
 */
export async function runAdminUsersList(
  initData: string,
  botToken: string,
  query: Record<string, string | string[] | undefined>,
  habitRepository: VercelKVHabitRepository
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!initData || typeof initData !== 'string') {
    return { status: 400, body: { error: 'initData is required' } };
  }

  let userId: number;
  try {
    ({ userId } = authenticateRequest(initData, botToken));
  } catch (authError: unknown) {
    const err = authError as { status?: number; message?: string };
    return { status: err.status || 401, body: { error: err.message } };
  }

  const adminIds = parseAdminUsers();
  if (!adminIds.includes(userId)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }

  const parsed = parseAdminFiltersFromQuery(query);
  if (parsed.error) {
    return { status: 400, body: { error: parsed.error } };
  }

  const filteredIds = await getFilteredUserIdsForAdmin(habitRepository, parsed.filters);

  const rows: Array<{
    userId: number;
    preferences: ReturnType<typeof serializePreferences>;
    habits: ReturnType<typeof serializeHabit>[];
  }> = [];

  for (const uid of filteredIds) {
    const prefs = await habitRepository.getUserPreferences(uid);
    const userHabits = await habitRepository.getUserHabits(uid);
    const habits = userHabits?.habits || [];

    rows.push({
      userId: uid,
      preferences: serializePreferences(prefs, uid),
      habits: habits.map(serializeHabit),
    });
  }

  return { status: 200, body: { users: rows } };
}

function parseOptionalTargetUserId(body: Record<string, unknown>): number | undefined {
  const v = body.id;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
  return undefined;
}

async function telegramSendMessage(botToken: string, chatId: number, text: string): Promise<void> {
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(typeof errBody === 'object' && errBody !== null ? JSON.stringify(errBody) : res.statusText);
  }
}

/**
 * Admin broadcast / direct message via Telegram Bot API.
 */
export async function runAdminSendMessage(
  initData: string,
  botToken: string,
  body: Record<string, unknown>,
  habitRepository: VercelKVHabitRepository
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!initData || typeof initData !== 'string') {
    return { status: 400, body: { error: 'initData is required' } };
  }

  let adminUserId: number;
  try {
    ({ userId: adminUserId } = authenticateRequest(initData, botToken));
  } catch (authError: unknown) {
    const err = authError as { status?: number; message?: string };
    return { status: err.status || 401, body: { error: err.message } };
  }

  const adminIds = parseAdminUsers();
  if (!adminIds.includes(adminUserId)) {
    return { status: 403, body: { error: 'Forbidden' } };
  }

  const rawMessage = typeof body.message === 'string' ? body.message.trim() : '';
  if (!rawMessage) {
    return { status: 400, body: { error: 'message is required' } };
  }
  if (rawMessage.length > TELEGRAM_MAX_MESSAGE_LENGTH) {
    return { status: 400, body: { error: 'message too long' } };
  }

  const targetId = parseOptionalTargetUserId(body);
  let recipientIds: number[];

  if (targetId !== undefined) {
    const active = await habitRepository.getAllActiveUserIds();
    if (!active.includes(targetId)) {
      return { status: 404, body: { error: 'User not found' } };
    }
    recipientIds = [targetId];
  } else {
    const parsed = parseAdminFiltersFromBody(body);
    if (parsed.error) {
      return { status: 400, body: { error: parsed.error } };
    }
    recipientIds = await getFilteredUserIdsForAdmin(habitRepository, parsed.filters);
  }

  let sent = 0;
  let failed = 0;
  const failures: Array<{ userId: number; error: string }> = [];

  for (let i = 0; i < recipientIds.length; i += SEND_MESSAGE_BATCH_SIZE) {
    const chunk = recipientIds.slice(i, i + SEND_MESSAGE_BATCH_SIZE);
    const results = await Promise.allSettled(
      chunk.map(uid => telegramSendMessage(botToken, uid, rawMessage))
    );

    results.forEach((r, idx) => {
      const uid = chunk[idx];
      if (r.status === 'fulfilled') {
        sent++;
      } else {
        failed++;
        if (failures.length < MAX_FAILURES_IN_RESPONSE) {
          const reason = r.reason;
          failures.push({
            userId: uid,
            error: reason instanceof Error ? reason.message : String(reason),
          });
        }
      }
    });
  }

  const responseBody: Record<string, unknown> = { sent, failed };
  if (failures.length > 0) {
    responseBody.failures = failures;
  }

  return { status: 200, body: responseBody };
}

export function logAdminUsersError(error: unknown): void {
  Logger.error('Error in users endpoint', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}

export function logAdminSendMessageError(error: unknown): void {
  Logger.error('Error in send-message endpoint', {
    error: error instanceof Error ? error.message : 'Unknown error',
  });
}
