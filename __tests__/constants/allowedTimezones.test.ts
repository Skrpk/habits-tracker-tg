import { describe, it, expect } from 'vitest';
import {
  TIMEZONE_REPRESENTATIVES,
  LEGACY_TIMEZONE_IDS,
  ALLOWED_TIMEZONE_IDS,
  buildTimezonePickerOptions,
  formatUtcOffset,
  formatLocalTime,
  getUtcOffsetMinutes,
} from '../../src/constants/allowedTimezones';

describe('allowedTimezones', () => {
  it('includes legacy ids in ALLOWED_TIMEZONE_IDS for backward compatibility', () => {
    expect(ALLOWED_TIMEZONE_IDS).toContain('Europe/Paris');
    expect(ALLOWED_TIMEZONE_IDS).toContain('Pacific/Baker_Island');
    for (const tz of LEGACY_TIMEZONE_IDS) {
      expect(ALLOWED_TIMEZONE_IDS).toContain(tz);
    }
    for (const tz of TIMEZONE_REPRESENTATIVES) {
      expect(ALLOWED_TIMEZONE_IDS).toContain(tz);
    }
  });

  it('formats integer and half-hour UTC offsets', () => {
    expect(formatUtcOffset(60)).toBe('UTC+1');
    expect(formatUtcOffset(-300)).toBe('UTC-5');
    expect(formatUtcOffset(330)).toBe('UTC+5:30');
    expect(formatUtcOffset(-210)).toBe('UTC-3:30');
    expect(formatUtcOffset(0)).toBe('UTC+0');
  });

  it('reports Kolkata as UTC+5:30', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(getUtcOffsetMinutes('Asia/Kolkata', now)).toBe(330);
    expect(formatUtcOffset(getUtcOffsetMinutes('Asia/Kolkata', now))).toBe('UTC+5:30');
  });

  it('formats local time as HH:MM', () => {
    const now = new Date('2026-01-15T12:00:00Z');
    expect(formatLocalTime('UTC', now)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatLocalTime('Asia/Kolkata', now)).toBe('17:30');
  });

  it('buildTimezonePickerOptions dedupes by current offset and uses representatives', () => {
    const now = new Date('2026-01-15T12:00:00Z'); // winter: Rome = UTC+1
    const options = buildTimezonePickerOptions(now);

    const offsets = options.map(o => o.offsetMinutes);
    expect(new Set(offsets).size).toBe(offsets.length);

    for (const opt of options) {
      expect(TIMEZONE_REPRESENTATIVES).toContain(opt.tz);
      expect(opt.text).toMatch(/^\d{2}:\d{2} · UTC[+-]\d{1,2}(:\d{2})?$/);
    }

    const rome = options.find(o => o.tz === 'Europe/Rome');
    expect(rome).toBeDefined();
    expect(rome!.text).toContain('UTC+1');
  });

  it('does not offer Europe/Paris in picker (Rome is the CET representative)', () => {
    const options = buildTimezonePickerOptions(new Date('2026-07-15T12:00:00Z'));
    expect(options.some(o => o.tz === 'Europe/Paris')).toBe(false);
    expect(options.some(o => o.tz === 'Europe/Rome')).toBe(true);
  });
});
