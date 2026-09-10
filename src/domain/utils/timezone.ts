/**
 * Timezone helpers for reminder scheduling.
 *
 * `toZonedDate` returns a *shifted* Date whose server-local wall clock reads the
 * wall clock of `timeZone` — so `getHours()`/`getDay()`/`getDate()` on it yield
 * that zone's local values. It is NOT a real instant, which is the whole trap:
 * converting an already-converted date applies the offset twice. Always pass the
 * true instant (`new Date()` / the cron's `now`), never the result of a previous
 * conversion.
 */
export function toZonedDate(date: Date, timeZone: string): Date {
  return new Date(date.toLocaleString('en-US', { timeZone }));
}
