# Implementation doc — "Check later (in 1 hour)" (postpone a habit reminder)

> **Status: implemented.** Helpers in `src/domain/utils/postpone.ts`, `PostponeHabitReminderUseCase`, the due-predicate in `GetHabitsDueForReminderUseCase`, and the button + `handleHabitPostpone` in `TelegramBot.ts`. Tests: `__tests__/domain/utils/postpone.test.ts`, `__tests__/domain/use-cases/{GetHabitsDueForReminderUseCase,PostponeHabitReminderUseCase}.test.ts`. Docs updated (root + presentation `CLAUDE.md`, `.cursorrules`). The optional clear-on-answer (§6.5) was left out — the same-day/`lastCheckedDate` guards + clear-on-send make a leftover flag harmless.

## 1. Goal

Add a third option to every habit reminder: **🕐 Check later (in 1 hour)**.

- When tapped, the current reminder message is edited to a short acknowledgement **with all buttons removed**, and the same reminder is re-sent ~1 hour later (same target day).
- The user can postpone repeatedly, walking the reminder forward hour by hour **until the end of their local day**.
- The button is **hidden when +1 hour would cross into the next local day** (e.g. a habit configured for `23:00` never shows it; a `22:00` habit shows it once, and the `23:00` re-ask no longer does).

Chat-only. The MiniApp flow is out of scope (see §11).

---

## 2. How reminders work today (the constraints that shape this)

Trace the existing path so the new mechanism fits it rather than fighting it:

1. **Cron → endpoint.** An external scheduler hits `POST /api/reminders` ([api/reminders.ts](api/reminders.ts)); locally the docker cron (`CRON_SCHEDULE`, default `* * * * *` — every minute, see [docker-compose.yml](docker-compose.yml)) hits the mirrored handler in [src/api/reminders-server.ts](src/api/reminders-server.ts). Both are near-identical.
2. **Due computation.** Both call `GetHabitsDueForReminderUseCase.execute(now, hour, minute, 'UTC')` ([src/domain/use-cases/GetHabitsDueForReminderUseCase.ts](src/domain/use-cases/GetHabitsDueForReminderUseCase.ts)), which iterates `active_users`, converts `now` into each user's timezone, and asks `CheckHabitReminderDueUseCase.isDue(...)`.
3. **`isDue`** ([src/domain/use-cases/CheckHabitReminderDueUseCase.ts:8](src/domain/use-cases/CheckHabitReminderDueUseCase.ts)) returns false unless `effectiveHour === schedule.hour && effectiveMinute === schedule.minute` — **exact hour + minute match**, in the schedule's timezone. It also skips `reminderEnabled === false`. The caller (`GetHabitsDueForReminderUseCase`) additionally skips `disabled === true` and `lastCheckedDate === today`.
4. **Send.** The endpoint groups due habits by user, computes `targetDate` = user's "today" (`YYYY-MM-DD` in their tz) from `now`, and calls `botService.sendHabitReminders(userId, habits, targetDate)` → `sendSingleHabitReminder` ([TelegramBot.ts:578](src/presentation/telegram/TelegramBot.ts)).
5. **Buttons** encode the target day: `habit_check:{id}:{yes|no|skip}:{YYYY-MM-DD}` plus a `📱 Reply in MiniApp` web_app button. Answers are recorded against that `targetDate`, never `new Date()` (root CLAUDE.md gotcha #1).
6. **Callbacks** are hand-routed in `handleCallbackQuery` via a long list of `data.match(/^prefix:.../)` branches; each handler must be **awaited** (serverless returns as soon as the handler resolves).

### Constraints this imposes on postpone

| Constraint | Consequence for design |
|---|---|
| **Serverless** — no process survives between requests; in-process `setTimeout`/`setInterval` are useless (`DailyReminderService.checkAndSendReminders` is an inert placeholder, [DailyReminderService.ts:32](src/presentation/telegram/DailyReminderService.ts)). | The re-ask **must be poll-driven** by the existing cron, not a scheduled job. Store state; let the cron find it. |
| **Two cron entrypoints** share one use case + one send method. | Put the "postpone is due" logic **inside `GetHabitsDueForReminderUseCase`** so both entrypoints inherit it with zero duplication. |
| **`isDue` is exact-minute**; re-ask granularity can be no finer than the cron cadence (per-minute locally; potentially hourly-at-:00 in prod per root CLAUDE.md). | Match the snooze with a **`>=` due window**, not exact equality, so an hourly cron still catches it at the next tick (at worst slightly late, never skipped). Strictly more robust than piggybacking exact-minute `isDue`. |
| **`targetDate` discipline.** | The postponed reminder keeps the **original `targetDate`**; only the *delivery time* moves. A check answered at 16:00 for a 15:00 reminder still records for the same day. |

---

## 3. Design overview

**Snooze-on-habit + poll re-ask + clear-on-send.**

1. Add one optional field to `Habit`: `postponedUntil?: string` (ISO-8601 UTC instant). Absent = not postponed.
2. When the user taps **Check later**, edit the message (strip buttons) and set `postponedUntil = now + 1h` (subject to the end-of-day guard, §5).
3. `GetHabitsDueForReminderUseCase` returns a habit when **either** it is normally `isDue` **or** it has a due postpone (`postponedUntil` present, `<= now`, still the user's same local day, not checked today, reminders on, not disabled).
4. `sendSingleHabitReminder` **clears `postponedUntil`** after a successful send. Because every re-ask flows through this method, a postponed reminder is sent exactly once per postpone; tapping Check later again sets a fresh `postponedUntil`.

This reuses the entire existing pipeline (grouping, `targetDate`, keyboard, MiniApp button, blocked-user skip). The only genuinely new surface is the button, the callback handler, and the "postpone is due" predicate.

```
tap "Check later"  ──►  edit msg (no buttons) + set postponedUntil = now+1h
                                        │
       next cron tick where now >= postponedUntil (same local day, unchecked)
                                        │
            GetHabitsDueForReminderUseCase includes the habit
                                        │
     sendSingleHabitReminder → new reminder (fresh Check-later if still allowed)
                        └─ clears postponedUntil on send
```

---

## 4. Data model change

[src/domain/entities/Habit.ts](src/domain/entities/Habit.ts) — add to `Habit`:

```ts
/** ISO-8601 UTC instant the reminder was postponed to ("Check later").
 *  Absent when not postponed. Cleared when the reminder is (re)sent or the
 *  habit is checked. One-shot: each tap sets it afresh. */
postponedUntil?: string;
```

No migration needed — it's optional and read defensively. `updateHabit` merges partials ([VercelKVHabitRepository.ts:117](src/infrastructure/repositories/VercelKVHabitRepository.ts)); setting `{ postponedUntil: undefined }` drops it on JSON serialize, which is how we clear it. (The `getUserHabits` field-defaulting map at [VercelKVHabitRepository.ts:25](src/infrastructure/repositories/VercelKVHabitRepository.ts) needs no default for an optional string; add `postponedUntil: habit.postponedUntil` there only if you want it explicit.)

---

## 5. UX spec — button, target time, and the end-of-day rule

### Where the button goes
In `sendSingleHabitReminder` ([TelegramBot.ts:582](src/presentation/telegram/TelegramBot.ts)), append a row **only when allowed**:

```
[ ✅ Yes ]
[ ❌ No (drop streak) ]  [ ⏭️ Skip (keep streak) ]
[ 🕐 Check later (in 1 hour) ]      ← conditional
[ 📱 Reply in MiniApp ]
```

Callback data: `habit_postpone:{habitId}:{targetDate}` (≈49 bytes, well under Telegram's 64). `targetDate` is carried so a stale button tapped on a later day can be rejected.

### "Allowed?" predicate (single source of truth — put it in a helper)
Let `localNow` = `now` in the user's timezone. Postpone is allowed iff **`localNow + 60min` is still the same local calendar day**, i.e. the local hour is `<= 22`. Equivalent to the user's rule: a reminder whose current local hour is `23` shows no button.

- **At send time** this is a pre-filter (best-effort — decides whether to render the button).
- **At click time** it is re-evaluated authoritatively against server `now` (see §6), because the user may tap late (button rendered at 22:30, tapped at 23:05).

Implement one pure helper so both sides agree (e.g. in `src/constants` or a small util):

```ts
/** Target instant for a 1-hour postpone, or null if it would cross into the
 *  next local day. `now` defaults to new Date(). */
export function computePostponeTarget(now: Date, timezone: string): Date | null {
  const target = new Date(now.getTime() + 60 * 60 * 1000);
  const day = (d: Date) => new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  return day(target) === day(now) ? target : null;
}
```

Rationale for `now + 60min` (vs `scheduleHour + 1`): it keeps the "in 1 hour" label honest even after stacked postpones and late taps, and the same-local-day comparison is DST-safe (it compares formatted calendar days in the user's zone, not raw hour arithmetic). Around a DST spring-forward the wall clock may read +2h; that is acceptable and still lands the same day.

### Acknowledgement message (buttons removed)
On tap, edit the original reminder via `safeEditMessage` with **no `reply_markup`** (omitting it removes the inline keyboard):

```
🕐 Okay — I'll ask about "<name>" again around 16:00.
```
(Show the target time formatted in the user's tz.)

If postpone is no longer possible at click time (crossed midnight), edit to:
```
It's too late to postpone "<name>" today — tap ✅/⏭️/❌ when you can.
```
…and **re-render the ✅/⏭️/❌ keyboard** (without the Check-later row) so the user can still answer.

---

## 6. Detailed changes, file by file

### 6.1 `Habit` entity
Add `postponedUntil?: string` (§4).

### 6.2 `sendSingleHabitReminder` — [TelegramBot.ts:578](src/presentation/telegram/TelegramBot.ts)
- Compute the user's timezone (fetch prefs, or thread it in from `sendHabitReminders`, which already loads `preferences`).
- If `computePostponeTarget(new Date(), tz) !== null`, add the `habit_postpone:{id}:{targetDate}` row to **both** `keyboardWithoutMiniApp` and `keyboardWithMiniApp`.
- **After a successful send**, if the habit carried a `postponedUntil`, clear it: `updateHabit(userId, habit.id, { postponedUntil: undefined })` (via §6.6). Clearing on *every* send (normal or snooze) is safe and also cleans up stale flags.

> Keep `sendSingleHabitReminder` a pure sender; the postpone predicate lives in the shared helper, and the clear is a single repo call.

### 6.3 Callback route + handler — `handleCallbackQuery` ([near TelegramBot.ts:2342](src/presentation/telegram/TelegramBot.ts))
Add a branch next to the `habit_check` branch (distinct prefix, no regex collision):

```ts
const postponeMatch = data.match(/^habit_postpone:(.+):(\d{4}-\d{2}-\d{2})$/);
if (postponeMatch) {
  await this.handleHabitPostpone(userId, chatId, postponeMatch[1], postponeMatch[2], query.message?.message_id);
  return;
}
```

New `handleHabitPostpone(userId, chatId, habitId, targetDate, messageId)`:
1. Load the habit; if missing, edit to "Habit not found." and return.
2. Guard **already answered**: if `lastCheckedDate === targetDate`, edit to "Already recorded ✅" (no buttons) and return.
3. Guard **stale day**: compute the user's current local day; if it `!== targetDate`, take the "too late" path (edit + ✅/⏭️/❌ keyboard, no Check-later).
4. `const target = computePostponeTarget(new Date(), tz)`. If `null` → "too late" path (§5).
5. `await updateHabit(userId, habitId, { postponedUntil: target.toISOString() })`.
6. `safeEditMessage(ack, { chat_id, message_id, /* no reply_markup */ })` with the target time formatted in `tz`.
7. Log `{ userId, habitId, targetDate, postponedUntil }`.

All awaited (serverless discipline). Note the callback query is already `answerCallbackQuery`'d in `processUpdate` before dispatch.

### 6.4 "Postpone is due" in the shared use case — [GetHabitsDueForReminderUseCase.ts](src/domain/use-cases/GetHabitsDueForReminderUseCase.ts)
Inside the per-habit loop, **besides** the `isDue` check, also include the habit when its postpone is due:

```ts
const isPostponeDue =
  !!habit.postponedUntil &&
  habit.reminderEnabled !== false &&
  habit.disabled !== true &&
  habit.lastCheckedDate !== today &&
  new Date(habit.postponedUntil).getTime() <= currentDate.getTime() &&
  // guard against a stale flag leaking into a later day:
  postponedUntilIsSameLocalDay(habit.postponedUntil, userDate, userTimezone);

if (isPostponeDue || this.checkReminderDue.isDue(habit, userDate, userHour, userMinute, userTimezone)) {
  habitsDueForReminder.push(habit);
}
```

- Use `<=` (window), not exact match, so any cron cadence catches it.
- `today` / `userDate` are already computed in this loop.
- De-dup: a habit can't be double-pushed since it's one `push` per habit per tick.
- `postponedUntilIsSameLocalDay` prevents an unfired postpone from a previous day (e.g. missed ticks) from re-asking on the wrong day; combined with `lastCheckedDate !== today` this keeps stale flags harmless. Optionally, clear a stale (past-day) `postponedUntil` when encountered.

Because both `api/reminders.ts` and `reminders-server.ts` already consume this use case and then call `sendHabitReminders`, **no changes are needed in either endpoint** — the postponed habit rides the normal grouping/`targetDate`/send path, and the send clears the flag (§6.2).

### 6.5 Clear on answer (tidy-up)
When a habit is checked/skipped/dropped for `targetDate`, clear any lingering `postponedUntil`. The `lastCheckedDate === today` guards already make a leftover flag a no-op, so this is cleanliness, not correctness. Easiest: add `postponedUntil: undefined` to the update in `RecordHabitCheckUseCase` / skip / drop, or clear in the chat `habit_check` handler. Mark optional.

### 6.6 Clearing helper
Clearing is a plain `habitRepository.updateHabit(userId, habitId, { postponedUntil: undefined })`. `TelegramBotService` already holds a repository via its use cases; expose a tiny private `clearPostpone(userId, habitId)` (or reuse an existing use case) rather than instantiating a new repo inline.

---

## 7. Edge cases

| Case | Expected behaviour |
|---|---|
| Habit configured `23:00` (or `23:30`) | No Check-later button ever (`localNow+1h` crosses midnight). |
| `22:00` habit | Button shown; the `23:00` re-ask shows no button. |
| Stacked postpones `15:00 → 16 → 17 …` | Allowed each hour until the `<= 22` local-hour rule blocks it. Each tap sets a fresh `postponedUntil`. |
| Tap Check later at 23:05 (button rendered 22:30) | Click-time recompute returns `null` → "too late" message + ✅/⏭️/❌ keyboard, no snooze created. |
| User answers ✅ before the re-ask fires | `lastCheckedDate === today` → postpone skipped by the due predicate; flag cleared on next send or on answer (§6.5). |
| User blocks the bot after postponing | Send fails → `blocked=true` set (existing behaviour), user skipped by cron; `postponedUntil` remains harmlessly and is cleared on next successful send after `/start`. |
| Cron misses ticks (outage) and `postponedUntil` slips into next day | `postponedUntilIsSameLocalDay` + `lastCheckedDate` guards suppress a wrong-day re-ask; optionally clear the stale flag. |
| DST spring-forward within the postpone hour | Same-local-day comparison is calendar-day based, so it stays correct; wall-clock gap of ~2h is acceptable. |
| Reminders disabled / habit disabled after postpone | Due predicate excludes them; no re-ask. |
| Prod cron actually hourly-at-:00 vs per-minute local | `>=` window means the re-ask lands at the next tick regardless; granularity matches normal reminders (pre-existing, not a regression). |

---

## 8. Testing plan

Vitest, mirroring `src` layout (`__tests__/`).

**Pure helper (`computePostponeTarget`)** — new `__tests__/constants/postpone.test.ts` (or util location):
- Returns non-null at 15:00 and 22:00 local; returns `null` at 23:00 and 23:30 local.
- Same-day check across timezones (e.g. `Pacific/Kiritimati` +14, `Etc/GMT+12`).
- DST spring-forward day: still same local day.

**Due predicate (`GetHabitsDueForReminderUseCase`)** — extend `__tests__/domain/use-cases/`:
- Habit with `postponedUntil <= now`, unchecked, enabled → included even though `isDue` is false.
- `postponedUntil` in the future → not included.
- `lastCheckedDate === today` with a leftover `postponedUntil` → not included.
- Stale past-day `postponedUntil` → not included (wrong local day).
- Normal `isDue` habit still included (no regression).

**Callback handler (`handleHabitPostpone`)** — with a fake bot/repo:
- Sets `postponedUntil ≈ now+1h`, edits message, sends no `reply_markup`.
- Late tap (target crosses midnight) → no flag set, keyboard re-rendered without Check-later.
- Stale `targetDate` (prior day) → "too late" path.
- Already-checked habit → no-op ack.

**Send (`sendSingleHabitReminder`)**:
- Adds the Check-later row when allowed, omits it at 23:00.
- Clears `postponedUntil` after a successful send.

**Parity**: the due-predicate change is exercised through both `__tests__/api/` (reminders) and `__tests__/reminders-server/` if those suites assert due selection — since the logic lives in the shared use case, one location may suffice; add a thin reminders-server assertion if that suite already covers due selection.

---

## 9. Telemetry / rollout

- Log on postpone set (`habit_postpone_set`) and on snooze fire (`habit_postpone_fired`) with `{ userId, habitId, targetDate }`. Gives an easy funnel: how often people postpone, how many stack, how many end in a check.
- No env flags required. If a kill-switch is wanted, gate the button render on an env var (`POSTPONE_ENABLED`), defaulting on.
- Backward compatible: old stored habits simply lack `postponedUntil`.

---

## 10. Risks / open questions

1. **Cron cadence in prod.** Root CLAUDE.md says hourly-at-:00, but `isDue` matches exact minutes and the docker default is per-minute — a pre-existing inconsistency. The `>=` window makes postpone robust either way, but confirm the real prod scheduler so "in 1 hour" lands promptly. *Decision needed:* is ~top-of-hour precision acceptable? For a 15:00 reminder postponed once, an hourly cron re-asks at 16:00 — exactly right. For a 15:30 reminder on an hourly-:00 cron, the re-ask lands 16:00 ("in ~30 min"). Acceptable for v1; note it.
2. **Fixed 1 hour** only, per spec. If variable snooze ("tonight", "tomorrow") is wanted later, `postponedUntil` already generalizes; only the button set changes.
3. **MiniApp** reminders don't get a postpone control in v1 (§11).
4. **Race**: two overlapping cron ticks before the clear persists could double-send. Low likelihood (per-user work is quick, single Redis write); acceptable. A short per-habit "last sent" guard could be added if observed.

---

## 11. Out of scope (v1)

- Postpone from the MiniApp (`api/check.ts` / `reminders-server.ts` POST). The button is chat-only.
- Arbitrary/variable snooze durations or a snooze picker.
- Persisting postpone history/analytics beyond the transient `postponedUntil`.
- Touching `DailyReminderService` (inert placeholder).

---

## 12. Change checklist

- [ ] `Habit.postponedUntil?: string` ([Habit.ts](src/domain/entities/Habit.ts))
- [ ] `computePostponeTarget(now, tz)` pure helper + tests
- [ ] Conditional Check-later row + clear-on-send in `sendSingleHabitReminder` ([TelegramBot.ts:578](src/presentation/telegram/TelegramBot.ts))
- [ ] `habit_postpone:` route + `handleHabitPostpone` (awaited) ([TelegramBot.ts:2342](src/presentation/telegram/TelegramBot.ts))
- [ ] Postpone-due predicate in `GetHabitsDueForReminderUseCase` ([here](src/domain/use-cases/GetHabitsDueForReminderUseCase.ts))
- [ ] (Optional) clear `postponedUntil` on check/skip/drop
- [ ] Tests: helper, due predicate, callback handler, send keyboard
- [ ] No change to `api/reminders.ts` / `reminders-server.ts` (verify they inherit the behaviour)
