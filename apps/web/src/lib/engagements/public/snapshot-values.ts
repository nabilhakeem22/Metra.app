// Single values read off an UNTRUSTED delivery snapshot: an instant, a calendar
// day, a scale-4 amount, a bounded text. PURE and client-safe. Each answers null
// for anything that is not exactly the documented shape, so a caller drops the
// field (or the row) rather than rendering junk or throwing.

/** An ISO instant with a zone, as Postgres writes a timestamptz into jsonb. */
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** A calendar day, as Postgres writes a `date` into jsonb. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** numeric(18,4) as text: up to 14 whole digits, up to 4 decimals, no sign. */
const SCALE4_AMOUNT = /^\d{1,14}(\.\d{1,4})?$/;

/** The instant, normalised to `toISOString()`, or null when it is not one. */
export function isoInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !ISO_INSTANT.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** The day as written (YYYY-MM-DD), or null when it is not a real calendar day. */
export function calendarDay(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const parts = CALENDAR_DAY.exec(value);
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? value : null;
}

/** A positive scale-4 amount string, or null. Zero is not money anybody paid. */
export function positiveAmount(value: unknown): string | null {
  if (typeof value !== 'string' || !SCALE4_AMOUNT.test(value)) return null;
  return /[1-9]/.test(value) ? value : null;
}

/** Trimmed text of 1 to `max` characters, or null. */
export function boundedText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length > 0 && text.length <= max ? text : null;
}

/** The newest of some ISO instants (unparseable ones ignored), or null. */
export function newestInstant(instants: ReadonlyArray<string | null>): string | null {
  let newest: number | null = null;
  for (const instant of instants) {
    const time = instant === null ? Number.NaN : Date.parse(instant);
    if (Number.isFinite(time) && (newest === null || time > newest)) newest = time;
  }
  return newest === null ? null : new Date(newest).toISOString();
}
