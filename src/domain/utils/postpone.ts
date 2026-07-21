/**
 * Helpers for the "Check later (in 1 hour)" reminder postpone feature.
 *
 * A postpone is only allowed while the re-ask stays within the user's current
 * local calendar day — a habit whose local time is already 23:xx can't be
 * pushed an hour without crossing midnight, so no option is offered.
 *
 * Day comparison is done on formatted `YYYY-MM-DD` strings in the user's
 * timezone (not raw hour arithmetic) so it stays correct across DST changes.
 */

/** One hour, in milliseconds. */
export const POSTPONE_STEP_MS = 60 * 60 * 1000;

/** Local calendar day (`YYYY-MM-DD`) of `date` in `timezone`. */
export function localDay(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/** True when `a` and `b` fall on the same local calendar day in `timezone`. */
export function isSameLocalDay(a: Date, b: Date, timezone: string): boolean {
  return localDay(a, timezone) === localDay(b, timezone);
}

/**
 * Target instant for a one-hour postpone, or `null` if `now + 1h` would cross
 * into the next local day (i.e. postpone is not allowed right now).
 */
export function computePostponeTarget(now: Date, timezone: string): Date | null {
  const target = new Date(now.getTime() + POSTPONE_STEP_MS);
  return isSameLocalDay(now, target, timezone) ? target : null;
}

/**
 * Whether a stored `postponedUntil` is due to be re-asked at `now`: it must be
 * in the past (or now) and still belong to `now`'s local day (a postpone that
 * slipped past midnight — e.g. after missed cron ticks — is not re-asked).
 */
export function isPostponeDue(
  postponedUntil: string | undefined,
  now: Date,
  timezone: string
): boolean {
  if (!postponedUntil) return false;
  const target = new Date(postponedUntil);
  if (Number.isNaN(target.getTime())) return false;
  return target.getTime() <= now.getTime() && isSameLocalDay(target, now, timezone);
}
