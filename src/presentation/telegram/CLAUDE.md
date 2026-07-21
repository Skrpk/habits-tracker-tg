# Telegram presentation layer

`TelegramBot.ts` is the main bot service; `DailyReminderService.ts` holds reminder-sending logic. This file covers what's specific to editing them — read the root `CLAUDE.md` first for the cross-cutting rules (targetDate, timezone storage, premium disabled, serverless await).

## Routing

Everything flows through `TelegramBotService.processUpdate()`, which manually dispatches messages, commands, and callback queries — there is no framework router. Callback queries are matched with a long series of `data === '…'` and `data.match(/^prefix:(.+)$/)` branches (~24 of them). When you add a callback, add its branch here and **await** the handler so the serverless invocation doesn't return early.

`timezone_select` callback shape: `timezone_select:{iana}` (onboarding) or `timezone_select:{iana}:settings` (from Settings), parsed by `/^timezone_select:(.+?)(?::(.+))?$/`. Handlers must validate the id against `ALLOWED_TIMEZONE_IDS` before persisting, and guard `Intl` formatting — some allowlisted legacy ids (e.g. `Pacific/Baker_Island`) throw `RangeError`.

Reminder answer callbacks all carry the reminder's day: `habit_check:{id}:{yes|no|skip|cancel}:{YYYY-MM-DD}` and `habit_postpone:{id}:{YYYY-MM-DD}` ("Check later"). `handleHabitPostpone` stores `Habit.postponedUntil` and strips the message's buttons; the re-ask is driven by the reminder cron via `GetHabitsDueForReminderUseCase` (see root gotcha #11), **not** an in-process timer. `habit_postpone` and `habit_check` have distinct prefixes (order-independent) — keep both branches awaited.

`resume_reminders:{id}` (`handleResumeReminders` → `ResumeRemindersUseCase`) clears an auto-pause (root gotcha #12); the button rides the one-time notice sent by `sendPauseNotice`.

## Conversation state

Multi-step flows store state in Redis under `conversation_state:{userId}` (never in-memory — serverless). Known prefixes:

- `creating_habit` — awaiting habit name
- `setting_schedule_new:{habitId}` — schedule for a just-created habit
- `set_schedule:{habitId}:{scheduleType}` — schedule for an existing habit
- `quote_edit:…`, `quote_regenerate:…`, `schedule_quick:…` — quote/schedule helpers

Drop/skip from chat records an **empty note** — there is no note prompt in chat mode. Notes are entered only from the MiniApp (`api/check.ts` / `reminders-server.ts`, which accept `note` in the POST body).

Clear or advance state explicitly at the end of each step. Unhandled free text (after consent + timezone are set) falls through silently to the user and is forwarded to the ops channel via `sendUnhandledMessageNotification`.

## Commands menu

`setMyCommands()` registers: `/newhabit`, `/myhabits`, `/analytics`, `/settings`, `/subscribe`. Deliberately **not** in the menu: `/start` (primary onboarding entry, still handled) and `/quote` (admin-only tooling). There is **no `/admin` command** — the Admin Panel is a `web_app` button shown only in Settings when `isAdminUser` is true. Don't add an `/admin` command or menu entry.

## Editing notes

- **Schedule setup during creation is finish-first, not a gate.** A new habit is created already carrying a working default (`daily 22:00` in the user's tz, set in `VercelKVHabitRepository.createHabit`). `askForScheduleDuringCreation` therefore shows a *confirmation* — `👍 Sounds good` (`schedule_skip_new`, finish), `🕐 Change time` (`schedule_pick_time_new` → one-tap preset times `PRESET_REMINDER_TIMES`, each `schedule_settime_new:{habitId}:{HHMM}`), `📅 Different schedule` (`schedule_more_new` → Weekly/Monthly/Interval type picker). Advanced types (and `⌨️ Custom time`) still land on the typed mini-DSL below. `← Back` (`schedule_back_new`) returns to the confirmation, not a type gate. Keep the default reachable in one tap — don't turn the picker back into the first screen.
- Typed schedule mini-DSL (custom time / advanced types, and the edit-existing flow): user picks a type, then types e.g. `20:30` (daily), `monday 15:48` (weekly), `15,30 22:00` (monthly), `2 15:30` (interval), parsed by `SetHabitReminderScheduleUseCase.parseSchedule`.
- Use `safeEditMessage()` for edits that may be no-ops — it swallows Telegram's "message is not modified" error.
- Keep business rules in `src/domain/use-cases/`; this service should orchestrate, not compute streaks/history itself.
- Habit checks in the reminder path must pass `targetDate` through to the use case (see root gotcha #1) — never record against `new Date()`.
- `sendSingleHabitReminder` takes the user's timezone and adds the `🕐 Check later` row only when `computePostponeTarget(now, tz)` is non-null (postpone stays within today). It also clears any `postponedUntil` on send. Whether-to-offer (send-time) and whether-still-valid (click-time, in `handleHabitPostpone`) both go through `src/domain/utils/postpone.ts` — keep that the single source of truth. Postpone state (`Habit.postponedUntil`) is set/cleared via `PostponeHabitReminderUseCase`, not by poking the repo inline.
- `sendHabitReminders` returns the habit IDs it **successfully sent** (per-habit try/catch — one failure no longer aborts the batch). The reminder cron (`api/reminders.ts` + `reminders-server.ts`) uses this for auto-pause's persist-after-send: `EvaluateReminderPauseUseCase.filterDueHabits` decides purely, the cron persists a `toSend` update only for returned IDs, and `pausedNow` persists immediately + `sendPauseNotice`. See root gotcha #12; keep the two cron files in parity.
