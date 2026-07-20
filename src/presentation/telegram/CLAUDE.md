# Telegram presentation layer

`TelegramBot.ts` is the main bot service; `DailyReminderService.ts` holds reminder-sending logic. This file covers what's specific to editing them — read the root `CLAUDE.md` first for the cross-cutting rules (targetDate, timezone storage, premium disabled, serverless await).

## Routing

Everything flows through `TelegramBotService.processUpdate()`, which manually dispatches messages, commands, and callback queries — there is no framework router. Callback queries are matched with a long series of `data === '…'` and `data.match(/^prefix:(.+)$/)` branches (~24 of them). When you add a callback, add its branch here and **await** the handler so the serverless invocation doesn't return early.

`timezone_select` callback shape: `timezone_select:{iana}` (onboarding) or `timezone_select:{iana}:settings` (from Settings), parsed by `/^timezone_select:(.+?)(?::(.+))?$/`. Handlers must validate the id against `ALLOWED_TIMEZONE_IDS` before persisting, and guard `Intl` formatting — some allowlisted legacy ids (e.g. `Pacific/Baker_Island`) throw `RangeError`.

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

- Schedule input is simplified: user picks a type via button, then types e.g. `20:30` (daily), `monday 15:48` (weekly), `15,30 22:00` (monthly), `2 15:30` (interval). Default when skipped: daily 22:00 in the user's timezone.
- Use `safeEditMessage()` for edits that may be no-ops — it swallows Telegram's "message is not modified" error.
- Keep business rules in `src/domain/use-cases/`; this service should orchestrate, not compute streaks/history itself.
- Habit checks in the reminder path must pass `targetDate` through to the use case (see root gotcha #1) — never record against `new Date()`.
