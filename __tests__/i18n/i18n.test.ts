import { describe, it, expect } from 'vitest';
import {
  t,
  mapTelegramLangCode,
  isSupportedLanguage,
  languageNativeName,
  SUPPORTED_LANGUAGES,
  DICTIONARIES,
  Language,
} from '../../src/i18n';

const LANGS: Language[] = ['en', 'uk', 'ru'];

// Extract {placeholder} tokens from a translation string.
function placeholders(str: string): Set<string> {
  return new Set((str.match(/\{(\w+)\}/g) || []).sort());
}

describe('i18n t()', () => {
  it('returns the translation for a known key', () => {
    expect(t('en', 'reminder.btn.yes')).toBe('✅ Yes');
    expect(t('ru', 'reminder.btn.yes')).toBe('✅ Да');
    expect(t('uk', 'reminder.btn.yes')).toBe('✅ Так');
  });

  it('interpolates {placeholders}', () => {
    expect(t('en', 'reminder.ask', { name: 'Run' })).toBe('⏰ Reminder: Did you "Run" today?');
  });

  it('does not regex-escape the interpolated value', () => {
    // A habit name with regex-special chars must be inserted verbatim.
    expect(t('en', 'reminder.ask', { name: 'a$1.*b' })).toContain('"a$1.*b"');
  });

  it('returns the raw key when missing everywhere (never throws)', () => {
    expect(t('en', 'totally.unknown.key')).toBe('totally.unknown.key');
    expect(t('ru', 'totally.unknown.key')).toBe('totally.unknown.key');
  });

  it('treats an unknown language as English', () => {
    expect(t('xx' as Language, 'reminder.btn.yes')).toBe('✅ Yes');
  });
});

describe('mapTelegramLangCode', () => {
  it('maps supported base codes', () => {
    expect(mapTelegramLangCode('uk')).toBe('uk');
    expect(mapTelegramLangCode('ru')).toBe('ru');
    expect(mapTelegramLangCode('en')).toBe('en');
  });

  it('strips region suffixes', () => {
    expect(mapTelegramLangCode('ru-RU')).toBe('ru');
    expect(mapTelegramLangCode('en-US')).toBe('en');
    expect(mapTelegramLangCode('uk-UA')).toBe('uk');
  });

  it('defaults unknown / missing codes to English', () => {
    expect(mapTelegramLangCode('de')).toBe('en');
    expect(mapTelegramLangCode('')).toBe('en');
    expect(mapTelegramLangCode(undefined)).toBe('en');
  });
});

describe('isSupportedLanguage', () => {
  it('accepts only en/uk/ru', () => {
    expect(isSupportedLanguage('en')).toBe(true);
    expect(isSupportedLanguage('uk')).toBe(true);
    expect(isSupportedLanguage('ru')).toBe(true);
    expect(isSupportedLanguage('de')).toBe(false);
    expect(isSupportedLanguage(undefined)).toBe(false);
    expect(isSupportedLanguage('')).toBe(false);
  });
});

describe('languageNativeName', () => {
  it('returns native names', () => {
    expect(languageNativeName('en')).toBe('English');
    expect(languageNativeName('uk')).toBe('Українська');
    expect(languageNativeName('ru')).toBe('Русский');
  });
});

describe('dictionary parity', () => {
  const enKeys = Object.keys(DICTIONARIES.en).sort();

  it('SUPPORTED_LANGUAGES lists exactly en/uk/ru', () => {
    expect(SUPPORTED_LANGUAGES.map(l => l.code).sort()).toEqual(['en', 'ru', 'uk']);
  });

  for (const lang of LANGS) {
    it(`${lang} has exactly the same keys as en`, () => {
      expect(Object.keys(DICTIONARIES[lang]).sort()).toEqual(enKeys);
    });
  }

  for (const lang of LANGS) {
    it(`${lang} preserves the same {placeholders} as en for every key`, () => {
      for (const key of enKeys) {
        expect(placeholders(DICTIONARIES[lang][key])).toEqual(placeholders(DICTIONARIES.en[key]));
      }
    });
  }
});
