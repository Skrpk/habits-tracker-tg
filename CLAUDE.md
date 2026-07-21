# Habits Tracker — Telegram Bot

TypeScript Telegram bot for habit tracking, deployed on Vercel (serverless). Users create habits, track daily completion, maintain streaks, and skip days without breaking streaks. Reminders are sent by an hourly cron based on each habit's schedule and timezone. Data lives in Redis.

> A `.cursorrules` file mirrors much of this for the Cursor editor. When you change architecture, commands, or the conventions below, update **both** so they don't drift.

## Commands

```bash
npm run dev            # bot in polling mode (local), src/index.ts via tsx watch
npm run dev:reminders  # local reminders/static/MiniApp server (src/api/reminders-server.ts)
npm run build          # tsc → strip dist/index.{js,d.ts,js.map} → copy public/* into dist/
npm test               # vitest run (unit tests in __tests__/)
npm run test:watch     # vitest watch
npm run setup-webhook  # register Telegram webhook (production)
docker-compose up      # redis + bot (hot reload) + cron daemon
```

There is **no `engines` field** in package.json — the runtime Node/ICU version is unpinned. Code that depends on modern `Intl` behavior (e.g. `timeZoneName: 'shortOffset'` in `src/constants/allowedTimezones.ts`) can misbehave on older/small-ICU runtimes; don't assume a floor without checking the deploy target.

## Architecture — Clean Architecture, four layers

```
api/                      Vercel serverless entrypoints (webhook, reminders cron, admin APIs, MiniApp APIs)
src/
├── domain/               Business logic — no framework/IO deps
│   ├── entities/         Habit.ts, UserPreferences.ts
│   ├── repositories/     IHabitRepository.ts (interface/contract)
│   ├── use-cases/        One class per operation (Create/Delete/Record/GetHabits… + SubscriptionUseCase)
│   └── utils/            HabitAnalytics.ts (history inference), HabitBadges.ts
├── infrastructure/       External services
│   ├── config/           kv.ts — Redis client (plain redis://, NOT Vercel KV SDK)
│   ├── repositories/     VercelKVHabitRepository (Redis impl)
│   ├── auth/             validateTelegramInitData (WebApp initData verification)
│   ├── admin/            parseAdminUsers() — reads ADMIN_USERS env
│   ├── notifications/    ChannelNotifications — ops-channel messages
│   ├── logger/           Structured Logger
│   └── quotes/           QuoteManager
├── constants/            allowedTimezones.ts (see gotchas)
├── presentation/telegram/ TelegramBot.ts (main service), DailyReminderService.ts  → see src/presentation/telegram/CLAUDE.md
├── api/                  Shared API logic + local dev server → see src/api/CLAUDE.md
├── public/               Static site + MiniApp HTML (NEAR-DUPLICATE of root public/, see gotchas)
└── index.ts              Local dev entry (polling)
public/                   Static files served at root in production
__tests__/                Vitest tests, mirroring src/api layout
```

Dependency rule: `domain` depends on nothing outward. `infrastructure` implements `domain` interfaces. `presentation` and `api` wire use cases to Telegram / HTTP. Keep business rules in use cases, not in `TelegramBot.ts`.

## Data models (see `src/domain/entities/`)

- **Habit**: `id, userId, name, streak, createdAt, lastCheckedDate (YYYY-MM-DD)`, plus arrays `skipped[]`, `dropped[]`, optional `checked[]` (explicit dates for non-daily), `badges[]` (5/10/30/90-day), `reminderSchedule?`, `reminderEnabled?` (default true), `disabled?`, `postponedUntil?` (ISO UTC — transient "Check later" snooze, see gotcha #11), `missedReminderCount?` / `lastReminderDate?` / `remindersPausedUntil?` (auto-pause state, daily-only, see gotcha #12).
- **ReminderSchedule** (discriminated union on `type`): `daily | weekly | monthly | interval`, each with `hour`, `minute`, optional `timezone`; `weekly.daysOfWeek`, `monthly.daysOfMonth`, `interval.intervalDays` + optional `startDate`.
- **UserPreferences**: `userId, user? (full Telegram user), timezone? (IANA), consentAccepted?, consentDate?, blocked?, premium?, premiumDate?, premiumType?, isLifetimePremium?`.

### Redis keys
- `user:habits:{userId}` — user's habits
- `user:{userId}:preferences` — preferences (timezone, consent, blocked, premium)
- `active_users` — set of users with habits
- `conversation_state:{userId}` — multi-step conversation state (NOT in-memory — serverless)

## Conventions & gotchas (the things that actually bite)

1. **`targetDate` on every reminder.** A reminder is for a specific day. Buttons encode it in callback_data (`habit_check:{id}:yes:{YYYY-MM-DD}`). When the user answers — even the next day — the check is recorded for that target date, not server "today". `RecordHabitCheckUseCase.execute(..., targetDate)` and `skipHabit(..., targetDate)` honor it; streak continuity uses `dayBefore(checkDate)`. Never record checks against `new Date()` in the reminder path.

2. **Timezone: store IANA, display live clock.** `UserPreferences.timezone` is an IANA id (e.g. `Europe/Rome`) so DST keeps working. Onboarding/settings render buttons with `buildTimezonePickerOptions()` showing `HH:MM · UTC±N` ("match your phone"). Validation/admin-filter allowlist is `ALLOWED_TIMEZONE_IDS = TIMEZONE_REPRESENTATIVES ∪ LEGACY_TIMEZONE_IDS` (legacy ids like `Europe/Paris` and the invalid `Pacific/Baker_Island` remain accepted so old stored values keep filtering). Note: `LEGACY_TIMEZONE_IDS` contains ids that `Intl` cannot resolve — formatting one throws `RangeError`, so guard timezone formatting.

3. **Premium gating is DISABLED — app is free for everyone.** Habit caps and paused-habit scheduling are unrestricted; the checks are commented out in `CreateHabitUseCase` and `TelegramBot` (`handleHabitToggleDisabled`, schedule-for-disabled). `SubscriptionUseCase` / `userHasPremiumAccess` / `/subscribe` / admin lifetime-premium grant still exist but are **not enforced**. Don't "fix" premium behavior unless re-enabling is the explicit task.

3a. **Skip/drop notes are MiniApp-only.** Dropping or skipping from the chat UI records an **empty note** with no prompt (users tap and leave). Notes are entered only from the MiniApp (`api/check.ts` / `reminders-server.ts` accept `note` in the POST body). Don't reintroduce a chat note prompt.

4. **AI analytics insights are DISABLED.** `getAnalyticsInsights` (`src/api/analytics-shared.ts`) early-returns `{}` (OpenAI call commented out); the analytics page doesn't fetch `/api/analytics-insights` or render the panel. `OPENAI_API_KEY` is currently unused.

5. **Blocked users.** A send failing with "bot was blocked by the user" sets `preferences.blocked = true`; reminder cron and the local reminders-server skip blocked users. Sending `/start` clears the flag.

6. **Serverless await discipline.** All Telegram updates are hand-routed in `TelegramBotService.processUpdate()`; every async op must be awaited so the serverless function doesn't return before work completes.

7. **Admin surface is gated + hidden.** Admin APIs (`/api/users`, `/api/send-message`, `/api/grant-lifetime-premium`) require valid Telegram `initData` **and** caller id in `ADMIN_USERS`. The Admin Panel is a `web_app` button shown only in Settings for admins. There is deliberately **no `/admin` chat command** and no `/admin` in `setMyCommands` — don't add one.

8. **Duplicated files that must stay in sync.** `public/` and `src/public/` are near-duplicate trees (prod static vs local-served). The timezone allowlist is hand-maintained in **three** places: `src/constants/allowedTimezones.ts` and the `ALLOWED_TIMEZONE_IDS` array inside **both** `admin.html` copies. Nothing enforces parity — edit all copies together, and prefer a parity test over another hand-copy.

9. **`safeEditMessage()`** swallows Telegram "message is not modified" errors — use it for edits that may be no-ops.

10. **Unhandled text is forwarded to ops.** After consent + timezone are set, any message not consumed by conversation state or a known command falls through silently to the user and is forwarded (truncated, no `parse_mode`) to `NOTIFICATION_CHANNEL_ID` via `sendUnhandledMessageNotification`.

11. **"Check later" postpone is poll-driven, not scheduled.** The reminder keyboard offers `🕐 Check later (in 1 hour)` (callback `habit_postpone:{id}:{targetDate}`) only while a 1-hour bump stays within the user's local day (helpers in `src/domain/utils/postpone.ts`; a 23:xx reminder shows nothing). Tapping it stores `Habit.postponedUntil` (ISO UTC) and strips the message's buttons — there is **no in-process timer** (serverless). `GetHabitsDueForReminderUseCase` re-includes a habit when `isPostponeDue()` (window match on the true instant, `<= now`, same local day, unchecked, reminders on) — so **both** cron entrypoints re-ask with no endpoint changes, at whatever cadence the cron runs. `sendSingleHabitReminder` **clears** `postponedUntil` on every send (re-ask is one-shot; the `lastCheckedDate`/same-day guards make any stale flag harmless). The postponed re-ask keeps the **original `targetDate`** (gotcha #1). Chat-only — no MiniApp postpone.

12. **Auto-pause after 2 ignored reminders — DAILY habits only.** `EvaluateReminderPauseUseCase.filterDueHabits(habits, targetDate)` is **pure** (returns `{toSend, pausedNow}` with `Partial<Habit>` updates, no writes). Non-daily schedules short-circuit to `toSend` untouched — never miss-tracked or paused. A "miss" = the previous sent reminder (`lastReminderDate`) went unanswered (`lastCheckedDate < lastReminderDate` — `<`, not `!=`, so a proactive check isn't a false miss); `lastReminderDate === targetDate` short-circuits same-day re-asks (postpone) so they never count. 2 consecutive misses → `remindersPausedUntil = targetDate + REMINDER_PAUSE_DAYS` (default 7) + a one-time "Resume now" notice (`sendPauseNotice`, callback `resume_reminders:{id}`); the `GetHabitsDueForReminderUseCase` gate skips paused habits (pause wins over postpone) and the resume branch clears it once expired. **Persist-after-send:** the cron persists a `toSend` update only for IDs `sendHabitReminders` reports as sent (`pausedNow` persists immediately) — a failed send never advances miss state. Any response resets it (`RecordHabitCheckUseCase` complete/drop/skip clear `missedReminderCount`/`remindersPausedUntil`). Env: `REMINDER_MISS_THRESHOLD` (2), `REMINDER_PAUSE_DAYS` (7).

## How it runs

**Production (Vercel):** Telegram → `/api/webhook` (verified via `WEBHOOK_SECRET_TOKEN` header, singleton bot service). Cron hits `/api/reminders` hourly at minute 0 (`0 * * * *`, verified via `x-vercel-cron` + `Authorization`): loads active users, skips `blocked`, computes each user's `targetDate` in their timezone, sends due reminders. `public/` served at root; `vercel.json` rewrites `/admin`, `/check`, `/schedule`, analytics routes and sets per-route `maxDuration` (`send-message` 300s, `reminders` 60s, `users` 30s).

**Local:** `docker-compose` runs redis + bot (polling via `src/index.ts`) + cron. `src/api/reminders-server.ts` serves static files and mirrors the production POST routes (matching on `pathname` so query strings work) for parity.

## Environment variables

Required: `TELEGRAM_BOT_TOKEN`, `REDIS_URL` (`redis://` or `rediss://`).
Common optional: `WEBHOOK_URL`, `WEBHOOK_SECRET_TOKEN`, `USE_LOCAL_REDIS`, `NODE_ENV`, `CRON_SECRET`, `CRON_SCHEDULE`, `NOTIFICATION_CHANNEL_ID`, `ADMIN_USERS` (JSON array of numeric Telegram ids), `REMINDER_MISS_THRESHOLD` (auto-pause after N ignored daily reminders, default 2), `REMINDER_PAUSE_DAYS` (auto-pause length, default 7).
Currently inert: `OPENAI_API_KEY` (AI insights disabled), `PREMIUM_STARS_PRICE`, `PREMIUM_STARS_ANNUAL`, `MAX_FREE_HABITS` (premium disabled).

## Testing

Vitest, tests in `__tests__/` mirroring source layout. `__tests__/api/` covers reminders/analytics/webhook/users/send-message (mock repository, `fetch`, auth helpers, `ADMIN_USERS`). `__tests__/reminders-server/` covers the local server handlers. `__tests__/domain/use-cases/` covers use cases. When editing shared allowlists or timezone helpers, add tests that assert cross-file parity and DST/offset correctness rather than internal self-consistency.

Tests for currently-disabled features are marked `it.skip` with a `// DISABLED:` comment saying why and when to restore — habit-cap enforcement (premium off), AI analytics insights (OpenAI off), and the local reminders-server CRON/initData checks (commented out for dev). Re-enable the test when you re-enable the feature.

## Security

Webhook verified by `WEBHOOK_SECRET_TOKEN`; cron by `x-vercel-cron` + `Authorization`. Commands can't be used as habit names (injection guard). Admin endpoints require `initData` + `ADMIN_USERS` membership. Don't expose admin functionality as discoverable chat commands.
