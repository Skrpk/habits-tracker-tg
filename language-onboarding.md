# Plan: Replace consent step with a language step + introduce i18n

**Status:** IMPLEMENTED (bot-side). Decisions locked (see below). MiniApp localization intentionally out of scope.
**Author:** planning doc — implemented per the phases below.

### What shipped
- `src/i18n/` — `t(lang, key, params)`, `en/uk/ru` dictionaries, `mapTelegramLangCode`, `SUPPORTED_LANGUAGES`, `isSupportedLanguage`, `languageNativeName`. Parity + behavior tests in `__tests__/i18n/i18n.test.ts`.
- `UserPreferences.language`; `SetUserPreferencesUseCase.setLanguage` (records consent) + `getLanguage` (resolver). Tests in `__tests__/domain/use-cases/SetUserPreferencesUseCase.test.ts`.
- Onboarding: `showLanguageSelection` replaces the consent step; `handleLanguageSelection`; `language_select:{lang}[:settings]` callback; `/start` gated on `!consentAccepted`; consent handlers/branches removed; onboarding-callback allowlist updated.
- Settings: `🌐 Language` option (`settings_language` → `showLanguageSelectionFromSettings`), current language shown.
- Localized: language picker, timezone picker (onboarding + settings), welcome, reminders (ask + buttons + MiniApp button + postpone/too-late/already-recorded + auto-pause notice + resume), setup guards, unhandled reply, per-language command menu, **habits list, habit details + buttons, enable/disable toast, delete (+confirm), skip (+confirm/result), check results (reset/sprouted/great/checked), new-habit name errors + creation confirmations, the whole finish-first schedule flow (change time / different schedule / presets / type picker / DSL instructions + completion), and the `/analytics` intro.**
- Docs: root `CLAUDE.md` (model, tree, gotcha #13), `src/presentation/telegram/CLAUDE.md`, `.cursorrules`.

### Deferred (not done, by decision / bounded scope)
- MiniApp pages (`check/schedule/analytics`) — English only (§8, out of scope).
- **Badge names + `BADGE_TREE_MESSAGES`** (in `src/domain/utils/HabitBadges.ts`) — the badge-earned block after a check stays English; localizing needs that util translated too.
- **Admin/ops-only** text: quote-management tooling, channel notifications, premium/subscribe (disabled) — intentionally English (D5).
- Raw `Error: ${e.message}` catch-fallbacks — left English (embed technical exception text); the clean UI messages around them are localized.
- `setConsent` use case left in place (now unused by the flow) for a later cleanup.

### Locked decisions (from user)
1. **Consent = language choice** (D1 as recommended): drop explicit Accept/Decline; keep a consent line + Privacy/Terms links on the language screen.
2. **Existing users**: silently default (Telegram code → `en`); no re-onboarding prompt. They change language in **Settings** — so the Settings language option (§7) is **in scope**, not optional.
3. **MiniApp localization (§8, Phase D): OUT OF SCOPE.** Bot-side only.

## Goal

1. Remove the standalone **Privacy Policy & Terms** consent step from onboarding.
2. Replace it with a **language picker** — one of **English (`en`)**, **Ukrainian (`uk`)**, **Russian (`ru`)** — as the **first** onboarding step.
3. Persist the chosen language on the user, **and** record consent exactly as before (`consentAccepted = true`, `consentDate = today`) for backward compatibility — choosing a language *is* the consent action.
4. Move user-facing bot text out of hardcoded literals into a lightweight **i18n** layer so every string can be rendered in the user's language.

New onboarding flow:

```
/start
  → (new user) Language picker  ── pick en/uk/ru ──►  sets language + consentAccepted=true + consentDate
      → Timezone picker (unchanged)
          → Welcome (localized)
  → (returning user, consent already accepted) straight to Welcome / normal use
```

---

## 1. Design decisions (resolve before/while building)

- **D1 — Consent is now implicit in language choice.** There is no more "❌ Decline". The language screen must still show a short consent line with links to the Privacy Policy and Terms (`https://habits-builder.com/privacy-policy`, `/terms`) so acceptance stays meaningful, e.g. *"By choosing a language you agree to our Privacy Policy and Terms."* **Recommended:** keep the links, drop the explicit accept/decline buttons. Flag for product/legal sign-off since this changes the consent UX.
- **D2 — Language type is a closed union** `type Language = 'en' | 'uk' | 'ru'`. English is the **fallback** for any missing key or unknown stored value.
- **D3 — Language resolution for existing users.** Existing users have `consentAccepted = true` but **no** `language`. Resolve at read time as: `preferences.language ?? mapTelegramLangCode(user?.language_code) ?? 'en'`. They are **not** re-onboarded (they already consented). Optionally offer language change in Settings (see §7).
- **D4 — i18n scope is phased.** Phase A/B ship the language step + infra with onboarding/reminders/core-command strings localized. The full sweep of all ~140 bot strings + the static MiniApp pages is Phase C/D and can land incrementally — untouched handlers keep English literals until migrated. **Recommended:** don't block the language step on 100% string coverage.
- **D5 — Ops/admin text stays English.** `ChannelNotifications`, new-user/unhandled-message forwards, and the Admin Panel are internal — do **not** localize them.

---

## 2. Data model

`src/domain/entities/UserPreferences.ts` — add:

```ts
/** UI language chosen at onboarding. Undefined for legacy users (resolve to 'en'). */
language?: 'en' | 'uk' | 'ru';
```

Export a shared `Language` type (either from the entity or the i18n module — see §4) and reuse it everywhere instead of re-declaring the union.

- Redis key `user:{userId}:preferences` is unchanged; the new optional field just rides along.
- `saveUserPreferences` already merges with existing and **drops `undefined`** (`VercelKVHabitRepository.saveUserPreferences`), so adding `language` needs **no repo change** and can't clobber other fields.

---

## 3. Use-case changes — `SetUserPreferencesUseCase`

Add one method that sets language **and** consent together (backward-compatible), mirroring the existing `setConsent`:

```ts
async setLanguage(userId: number, language: Language, user?: TelegramBot.User): Promise<UserPreferences> {
  const existing = await this.habitRepository.getUserPreferences(userId);
  const preferences: UserPreferences = {
    userId,
    user: user || existing?.user,
    language,
    // Selecting a language IS the consent action — preserve prior consent semantics.
    consentAccepted: true,
    consentDate: existing?.consentDate ?? new Date().toISOString().split('T')[0],
  };
  await this.habitRepository.saveUserPreferences(preferences);
  Logger.info('User language set', { userId, language });
  return preferences;
}
```

Notes:
- Reuse existing `consentDate` if present (idempotent language changes shouldn't reset the consent date); only stamp a new date on first accept.
- Keep `setConsent` for now (still referenced by admin/legacy paths and tests); it can be removed in a later cleanup once nothing calls it.
- **Add a `getLanguage(userId, user?)` resolver** (or a pure helper `resolveLanguage(prefs, user)`) implementing D3's fallback chain, so every caller resolves language the same way.

---

## 4. i18n infrastructure (new)

Dependency-free, pure, serverless-safe. No `i18next` needed for 3 languages.

**Location:** `src/i18n/` (cross-cutting; pure data + function — no IO, no framework).

```
src/i18n/
├── index.ts        // Language type, t(), SUPPORTED_LANGUAGES, mapTelegramLangCode()
├── en.ts           // dictionary (source of truth for keys)
├── uk.ts
└── ru.ts
```

- **`Language`** = `'en' | 'uk' | 'ru'`; `SUPPORTED_LANGUAGES` with display labels (`🇬🇧 English`, `🇺🇦 Українська`, `Русский`) for the picker.
- **Dictionaries** are flat keyed maps, e.g. `{ 'onboarding.language.title': '…', 'welcome.body': '…', 'reminder.ask': 'Did you "{name}" today?' }`. English is the canonical key set.
- **`t(lang, key, params?)`**: looks up `dict[lang][key]`, falls back to `dict.en[key]`, then to the raw `key` (so a missing translation is visible, never a crash). Interpolates `{param}` placeholders. Keep it synchronous and pure.
- **`mapTelegramLangCode(code?)`**: `uk`→`uk`, `ru`→`ru`, everything else→`en` (used for D3 default and to pre-highlight a suggested button).
- **Markdown safety:** many strings use `parse_mode: 'Markdown'` with `*bold*`/`_italic_`. Translators must preserve markup and escape user-injected values (habit names) as today. Add a lint/test that every key exists in all three dictionaries (parity), and that placeholder sets match across languages.

**Plumbing into handlers (recommended, low-churn):**
- Resolve the language **once per update** and thread a `lang: Language` argument into handlers as they're migrated.
  - Message path: the guard already loads `preferences` at `TelegramBot.ts:905` — reuse it to resolve `lang` and pass down. For onboarding (no prefs yet) resolve from `msg.from?.language_code`.
  - Callback path: prefs are loaded at `:1003` for the non-onboarding guard — reuse similarly.
- Add a private helper `private async langFor(userId?, user?): Promise<Language>` (one `getPreferences` read) for handlers not on the pre-loaded path. Accept the extra Redis read for a pet-project; optimize by threading later if needed.
- Do **not** store language on a shared instance field (`this.lang`) — a serverless instance can be reused; pass it explicitly.

---

## 5. Telegram flow changes — `TelegramBot.ts`

**Add (new language step):**
- `showLanguageSelection(chatId, userId, user?)` — sends the picker: 3 buttons `language_select:en|uk|ru` (one per row for clarity), plus the consent line + policy links (D1). Text itself can start localized-by-default in English since the user hasn't chosen yet; optionally pre-order/highlight the button matching `mapTelegramLangCode(user?.language_code)`.
- `handleLanguageSelection(userId, chatId, messageId, langChoice, user?)` — validates `langChoice ∈ {en,uk,ru}`, calls `setLanguage(...)`, edits the message to a localized confirmation, then calls `showTimezoneSelection(chatId, userId)` (**awaited** — gotcha #6). Mirrors `handleConsentAcceptance`.
- Callback branch: `data.match(/^language_select:(en|uk|ru)$/)` → `handleLanguageSelection(...)`. Add near the current `consent_accept` branch (`:2701`).

**Change (routing / guards):**
- `handleStartCommand` (`:1082`): replace
  `if (!preferences || !preferences.consentAccepted) { showConsentMessage(...) }`
  with
  `if (!preferences || !preferences.language) { showLanguageSelection(...) }`.
  Keep the subsequent `!preferences.timezone → showTimezoneSelection` branch. (Use `language` as the "onboarded step 1" flag; `consentAccepted` remains true underneath for back-compat and admin filtering.)
- Onboarding-callback allowlist (`:998`): add `cbData.startsWith('language_')` so the pre-consent guard doesn't block the language pick.
- Guards at `:906` and `:1004` currently gate on `consentAccepted` — these **keep working** because `setLanguage` sets `consentAccepted = true`. No functional change needed, but consider also gating on `language` presence for new users mid-flow (a user who somehow has consent but no language shouldn't be stuck — the `/start` branch handles re-entry).

**Remove / retire:**
- `showConsentMessage`, `handleConsentAcceptance`, `handleConsentDecline` and their callback branches `consent_accept` / `consent_decline` (`:2701`–`:2708`). **Recommended:** delete them in the same PR once the language step replaces them (grep for stragglers). If you want a softer landing, leave `consent_*` branches as no-op/redirect-to-language for one release so any in-flight buttons don't dead-end.

**Localize (Phase B, first strings to migrate):**
- Language picker + confirmation, timezone picker header (`showTimezoneSelection` `:1573`), welcome message (`:1097`), reminder text (`sendSingleHabitReminder` `:622` / `:495`), "Please complete setup first…" guards, the unhandled-message reply (`sendUnhandledMessageReply`), and the core command replies (`/newhabit`, `/myhabits`, `/settings`, `/analytics`). Replace literals with `t(lang, 'key', params)`.

---

## 6. Localized command menu (optional, nice-to-have)

`setMyCommands()` (`:129`) accepts a per-language variant via the `language_code` scope option. Register the command list once per language (`en`, `uk`, `ru`) so the Telegram command menu itself is localized. Low effort, high polish. Can be Phase C.

---

## 7. Settings: change language (optional)

Mirror "🌍 Change Timezone" in `handleSettingsCommand` (`:1798`):
- Add `{ text: '🌐 Language', callback_data: 'settings_language' }`.
- `settings_language` → reuse `showLanguageSelection` in a "from settings" mode (like `showTimezoneSelectionFromSettings`) that calls `setLanguage` **without** re-stamping consent and returns to Settings. Reuse the `language_select:{lang}:settings` suffix pattern already used by `timezone_select:{iana}:settings`.
- Show current language in the Settings summary.

---

## 8. MiniApp / static pages (Phase D — separate, larger)

`check.html`, `schedule.html`, `analytics.html` (in **both** `public/` and `src/public/` — keep in sync, gotcha #8) contain hardcoded English. Options:
- **Client-side i18n:** small JS dictionary in each page; resolve language from `Telegram.WebApp.initDataUnsafe.user?.language_code` **or** have the check/schedule APIs return the stored `preferences.language` in their JSON so the page renders in the user's chosen language (preferred — matches the picked language, not the device language).
- Treat as a follow-up; the bot-side flow (Phases A–C) delivers the requested feature without blocking on the MiniApp.

---

## 9. Backward compatibility & edge cases

- **Existing users** (`consentAccepted = true`, no `language`): never see the language step; text resolves to `en` (or their Telegram `language_code`) via D3. Nothing breaks.
- **Admin consent-date filter** (`api/users`, `consentDateFrom/To`): unchanged — `consentDate` is still written by `setLanguage`.
- **Guards** (`:906`, `:1004`): still satisfied because `consentAccepted` stays true.
- **In-flight consent buttons:** a user who received the old consent message before deploy might tap `consent_accept`. Either keep a redirect shim for one release (D-safe) or accept the dead-tap (they can re-`/start`).
- **Unknown/legacy stored language value:** `t()` falls back to `en`.
- **Markdown injection:** keep escaping habit names in localized strings exactly as today.
- **Serverless await discipline** (gotcha #6): every new send/edit and the `setLanguage → showTimezoneSelection` chain must be awaited.

---

## 10. Testing

- `SetUserPreferencesUseCase.setLanguage`: sets `language`, `consentAccepted=true`, stamps `consentDate` on first call, preserves existing `consentDate` on repeat, preserves other fields (blocked/premium) via merge.
- `resolveLanguage`/`getLanguage`: precedence `stored → telegram code → 'en'`; unknown code → `en`.
- i18n `t()`: key hit; missing-key fallback to `en`; missing-in-`en` fallback to raw key; `{param}` interpolation.
- **Dictionary parity test:** every key present in `en` exists in `uk` and `ru`, and placeholder tokens match across languages (analogous to the existing timezone-parity test).
- Onboarding routing: new user with no `language` → language picker; `language_select:uk` → sets prefs + advances to timezone; returning user with consent but no language → resolves to `en`, not re-onboarded.
- Callback guard: `language_*` is treated as an onboarding callback (not blocked by the consent guard).
- Update/adjust any existing consent tests that assert the removed `consent_*` flow.

---

## 11. Documentation to update

- **Root `CLAUDE.md`:** onboarding description ("How it runs" / gotchas), `UserPreferences` model (add `language`), and the consent gotcha (now: language pick implies consent). Add an i18n note (where strings live, `t()`, parity test).
- **`src/presentation/telegram/CLAUDE.md`:** routing (new `language_select` callback + onboarding allowlist), conversation/onboarding flow, and that user-facing strings go through `t(lang, …)`.
- **`.cursorrules`:** mirror the above (keep in sync — the file says so).
- If localized command menus (§6) land, note it near the `setMyCommands` docs.

---

## 12. Suggested phasing / PR breakdown

- **Phase A — data + use case:** `UserPreferences.language`, `setLanguage`, `resolveLanguage`, tests. No UI change yet.
- **Phase B — flow swap + i18n core:** i18n module (`en/uk/ru` with onboarding+reminder+core keys), language picker replaces consent, remove consent handlers, localize the first batch of strings, docs. **This delivers the feature.**
- **Phase C — coverage:** migrate remaining bot strings to `t()`, localized command menu, Settings language change.
- **Phase D — MiniApp:** localize `check/schedule/analytics` pages (both `public/` trees).

---

## Open questions for the user

1. Confirm consent-by-language-choice (D1) is acceptable, or do you want to keep an explicit "I agree" tap on the language screen?
2. Should existing users be offered a one-time language prompt, or silently default to English/Telegram-code until they change it in Settings?
3. Is localizing the MiniApp pages (Phase D) in scope now, or a later follow-up?
