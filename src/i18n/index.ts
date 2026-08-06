import { en } from './en';
import { uk } from './uk';
import { ru } from './ru';

/** UI languages the bot supports. English is the fallback for everything. */
export type Language = 'en' | 'uk' | 'ru';

export const DEFAULT_LANGUAGE: Language = 'en';

const DICTS: Record<Language, Record<string, string>> = { en, uk, ru };

/** Picker metadata: button label (with flag) + native name for confirmations. */
export const SUPPORTED_LANGUAGES: { code: Language; label: string; nativeName: string }[] = [
  { code: 'en', label: '🇬🇧 English', nativeName: 'English' },
  { code: 'uk', label: '🇺🇦 Українська', nativeName: 'Українська' },
  { code: 'ru', label: 'Русский', nativeName: 'Русский' },
];

export function isSupportedLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'uk' || value === 'ru';
}

/** Native name for a language code (used in "Language set to {lang}" messages). */
export function languageNativeName(lang: Language): string {
  return SUPPORTED_LANGUAGES.find(l => l.code === lang)?.nativeName ?? lang;
}

/**
 * Maps a Telegram `language_code` (e.g. "ru", "uk", "en-US") to a supported
 * language, defaulting to English for anything we don't translate.
 */
export function mapTelegramLangCode(code?: string): Language {
  const base = (code || '').toLowerCase().split('-')[0];
  if (base === 'uk') return 'uk';
  if (base === 'ru') return 'ru';
  return DEFAULT_LANGUAGE;
}

/**
 * Translate a key for a language. Falls back to English, then to the raw key
 * (so a missing translation is visible, never a crash). Interpolates
 * `{placeholder}` tokens from `params`. Pure and synchronous.
 */
export function t(
  lang: Language,
  key: string,
  params?: Record<string, string | number>
): string {
  const dict = DICTS[lang] || DICTS[DEFAULT_LANGUAGE];
  let str = dict[key] ?? DICTS[DEFAULT_LANGUAGE][key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      // split/join avoids regex-escaping the replacement value (habit names, etc.)
      str = str.split(`{${k}}`).join(String(v));
    }
  }
  return str;
}

// Exposed for the parity test.
export const DICTIONARIES = DICTS;
