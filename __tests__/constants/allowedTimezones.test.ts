import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  TIMEZONE_REPRESENTATIVES,
  LEGACY_TIMEZONE_IDS,
  ALLOWED_TIMEZONE_IDS,
  buildTimezonePickerOptions,
  formatUtcOffset,
  formatLocalTime,
  getUtcOffsetMinutes,
} from '../../src/constants/allowedTimezones';

/** Canonical offsets (minutes) a user must always be able to pick, in either
 * season. Excludes half-hour offsets that only exist during one hemisphere's
 * DST (−2:30/−3:30, +10:30, +13). */
const REQUIRED_OFFSETS_MINUTES = [
  -720, -660, -600, -540, -480, -420, -360, -300, -240, -180, -120, -60,
  0, 60, 120, 180, 240, 300, 330, 360, 420, 480, 540, 570, 600, 660, 720,
];

/** Pull the ALLOWED_TIMEZONE_IDS array out of an admin.html copy for parity checks. */
function readAdminAllowlist(relPath: string): string[] {
  const html = readFileSync(resolve(__dirname, '../../', relPath), 'utf8');
  const block = html.match(/ALLOWED_TIMEZONE_IDS\s*=\s*\[([\s\S]*?)\]/);
  if (!block) throw new Error(`ALLOWED_TIMEZONE_IDS not found in ${relPath}`);
  return Array.from(block[1].matchAll(/'([^']+)'/g)).map(m => m[1]);
}

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

  // Regression: DST zones springing forward used to leave their base offset
  // (e.g. +0 in July when London → +1, −9 when Anchorage → −8) with no row.
  // No-DST fillers must keep every canonical offset present year-round.
  it.each([
    ['northern winter', '2026-01-15T12:00:00Z'],
    ['northern summer', '2026-07-15T12:00:00Z'],
  ])('offers every canonical UTC offset with no gaps (%s)', (_label, iso) => {
    const options = buildTimezonePickerOptions(new Date(iso));
    const offered = new Set(options.map(o => o.offsetMinutes));
    const missing = REQUIRED_OFFSETS_MINUTES.filter(m => !offered.has(m));
    expect(missing.map(formatUtcOffset)).toEqual([]);

    // Still exactly one row per current offset.
    expect(offered.size).toBe(options.length);

    // Rows are sorted west → east so offsets (and clock times) read monotonically,
    // even when a DST zone and its no-DST filler are adjacent in the source list.
    const shown = options.map(o => o.offsetMinutes);
    expect(shown).toEqual([...shown].sort((a, b) => a - b));
  });

  it('keeps admin.html allowlists in parity with ALLOWED_TIMEZONE_IDS', () => {
    const expected = [...ALLOWED_TIMEZONE_IDS].sort();
    for (const copy of ['public/admin.html', 'src/public/admin.html']) {
      const actual = [...new Set(readAdminAllowlist(copy))].sort();
      expect(actual, `${copy} is out of sync`).toEqual(expected);
    }
  });
});
