/**
 * Curated IANA representatives for the timezone picker (west → east).
 * Covers integer UTC−12…+12 plus common half-hour offsets.
 * Button labels are built at render time from the user's current clock.
 */
export const TIMEZONE_REPRESENTATIVES: readonly string[] = [
  'Etc/GMT+12',           // UTC−12
  'Pacific/Niue',         // UTC−11
  'Pacific/Honolulu',     // UTC−10
  'Pacific/Gambier',      // UTC−9 (no DST — keeps −9 present while Anchorage is on DST)
  'America/Anchorage',    // UTC−9 / −8 DST
  'America/Los_Angeles',  // UTC−8 / −7 DST
  'America/Denver',       // UTC−7 / −6 DST
  'America/Chicago',      // UTC−6 / −5 DST
  'America/New_York',     // UTC−5 / −4 DST
  'America/Halifax',      // UTC−4 / −3 DST
  'America/St_Johns',     // UTC−3:30 / −2:30 DST
  'America/Sao_Paulo',    // UTC−3
  'Atlantic/South_Georgia', // UTC−2
  'Atlantic/Cape_Verde',  // UTC−1
  'Europe/London',        // UTC+0 / +1 DST
  'Europe/Rome',          // UTC+1 / +2 DST (Italy, France, Germany, Spain, …)
  'Europe/Kyiv',          // UTC+2 / +3 DST
  'Europe/Moscow',        // UTC+3
  'Asia/Dubai',           // UTC+4
  'Asia/Karachi',         // UTC+5
  'Asia/Kolkata',         // UTC+5:30
  'Asia/Dhaka',           // UTC+6
  'Asia/Bangkok',         // UTC+7
  'Asia/Shanghai',        // UTC+8
  'Asia/Tokyo',           // UTC+9
  'Australia/Adelaide',   // UTC+9:30 / +10:30 DST
  'Australia/Sydney',     // UTC+10 / +11 DST
  'Pacific/Guadalcanal',  // UTC+11
  'Pacific/Auckland',     // UTC+12 / +13 DST
];

/** IANA ids previously offered in the UI — still valid in stored preferences / admin filters. */
export const LEGACY_TIMEZONE_IDS: readonly string[] = [
  'Pacific/Baker_Island',
  'Pacific/Niue',
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Halifax',
  'America/Sao_Paulo',
  'Atlantic/South_Georgia',
  'Atlantic/Cape_Verde',
  'Europe/London',
  'Europe/Paris',
  'Europe/Kyiv',
  'Europe/Moscow',
  'Asia/Dubai',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Guadalcanal',
  'Pacific/Auckland',
];

/** Admin filter + bot validation allowlist: new representatives ∪ legacy stored values. */
export const ALLOWED_TIMEZONE_IDS: readonly string[] = Array.from(
  new Set([...TIMEZONE_REPRESENTATIVES, ...LEGACY_TIMEZONE_IDS])
);

export interface TimezonePickerOption {
  tz: string;
  text: string;
  offsetMinutes: number;
}

/** UTC offset of `timeZone` at `date`, in minutes east of UTC (e.g. CET winter = 60). */
export function getUtcOffsetMinutes(timeZone: string, date: Date = new Date()): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
  });
  const parts = formatter.formatToParts(date);
  const tzName = parts.find(p => p.type === 'timeZoneName')?.value ?? 'GMT';
  // Examples: "GMT", "GMT+1", "GMT+5:30", "GMT-3", "UTC+01:00"
  const match = tzName.match(/(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?/i);
  if (!match) {
    return 0;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const hours = parseInt(match[2], 10);
  const minutes = match[3] ? parseInt(match[3], 10) : 0;
  return sign * (hours * 60 + minutes);
}

/** Format offset minutes as `UTC+1` or `UTC+5:30`. */
export function formatUtcOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '-' : '+';
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  if (minutes === 0) {
    return `UTC${sign}${hours}`;
  }
  return `UTC${sign}${hours}:${String(minutes).padStart(2, '0')}`;
}

/** Local wall-clock time in `timeZone` as `HH:MM` (24h). */
export function formatLocalTime(timeZone: string, date: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  // en-GB can still use narrow no-break space in some runtimes; normalize to HH:MM
  return formatter.format(date).replace(/\u202f/g, ' ').trim();
}

/**
 * Build picker rows: one per distinct current UTC offset, label `HH:MM · UTC±N`.
 * First representative in TIMEZONE_REPRESENTATIVES wins for a given offset.
 */
export function buildTimezonePickerOptions(now: Date = new Date()): TimezonePickerOption[] {
  const seen = new Set<number>();
  const options: TimezonePickerOption[] = [];

  for (const tz of TIMEZONE_REPRESENTATIVES) {
    let offsetMinutes: number;
    try {
      offsetMinutes = getUtcOffsetMinutes(tz, now);
    } catch {
      continue;
    }
    if (seen.has(offsetMinutes)) {
      continue;
    }
    seen.add(offsetMinutes);
    const time = formatLocalTime(tz, now);
    const offset = formatUtcOffset(offsetMinutes);
    options.push({
      tz,
      text: `${time} · ${offset}`,
      offsetMinutes,
    });
  }

  return options;
}

/** @deprecated Use buildTimezonePickerOptions() for UI; kept for any static imports. */
export const TIMEZONE_OPTIONS = TIMEZONE_REPRESENTATIVES.map(tz => ({
  text: tz,
  tz,
}));
