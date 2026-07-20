# Shared API logic + local server

This directory holds code shared by the Vercel serverless entrypoints in the top-level `api/` and the local dev server — not the entrypoints themselves. Read the root `CLAUDE.md` first.

- `admin-users-shared.ts` — auth + filtering behind the admin `POST /api/users` and `POST /api/send-message`.
- `analytics-shared.ts` — analytics computation; `getAnalyticsInsights` currently **early-returns `{}`** (OpenAI disabled).
- `reminders-server.ts` — local HTTP server: serves `public/` static files and mirrors the production POST routes.
- `webhook.ts` — shared webhook handling.

## Prod ↔ local parity (important)

Each production route in the top-level `api/*.ts` has a counterpart the local `reminders-server.ts` must mirror: `/api/reminders`, `/api/analytics`, `/api/analytics-insights`, `/api/check`, `/api/users`, `/api/send-message`, `/api/grant-lifetime-premium`. When you add or change a route's contract, update **both** the serverless entrypoint and the local server, or local dev silently diverges from production.

The local server matches routes on URL `pathname` (ignoring the query string) so `?filter=…` requests work. Keep that pattern.

## Admin auth & filters

`authenticateRequest(initData, botToken)` validates Telegram `initData` and returns `{ userId }`; admin routes then require that id ∈ `ADMIN_USERS`. Do both — `initData` validity alone is not admin authorization.

Filter semantics (query string and JSON body share them):
- `isAdmin` → maps to the **premium** flag (not admin membership — historical naming).
- `isBlocked` → `preferences.blocked`.
- `Timezone` → must be in `ALLOWED_TIMEZONE_IDS` (imported from `../constants/allowedTimezones`); reject otherwise.
- `userId` → exact numeric Telegram id (validated `> 0`, safe integer).
- `consentDateFrom` / `consentDateTo` → inclusive `YYYY-MM-DD` range on `UserPreferences.consentDate` (from ≤ to enforced).

`send-message`: with `id`, DMs one active user; without `id`, broadcasts to all users matching the filters via Telegram `sendMessage` (`fetch`), batched 1000 at a time with `Promise.allSettled`. Its serverless `maxDuration` is 300s in `vercel.json` — keep long-running broadcast work within that budget.

## Testing

Mock the repository, `fetch`, the auth helper, and `ADMIN_USERS`. Tests live in `__tests__/api/` and `__tests__/reminders-server/`; when you touch a shared handler, exercise it through both the serverless and local-server paths if their wiring differs.
