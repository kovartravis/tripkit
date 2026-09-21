/**
 * Small, dependency-free date/time helpers. Tripkit stores everything as
 * strings the agent can read back verbatim:
 *
 * - calendar dates:   `YYYY-MM-DD`
 * - clock times:      `HH:MM` (24h), local to the day they belong to
 * - instants:         ISO 8601 `YYYY-MM-DDTHH:MM[:SS][Z|±HH:MM]`; when the
 *                     offset is omitted the value is "floating" local time
 *                     (e.g. an airport's wall clock) and is exported as such.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)?$/;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function isHHMM(value: string): boolean {
  return HHMM_RE.test(value);
}

export function isIsoDateTime(value: string): boolean {
  const m = DATETIME_RE.exec(value);
  if (!m) return false;
  return isIsoDate(`${m[1]}-${m[2]}-${m[3]}`);
}

export function hasUtcOffset(value: string): boolean {
  const m = DATETIME_RE.exec(value);
  return Boolean(m && m[7]);
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** `HH:MM` → minutes since midnight. */
export function toMinutes(hhmm: string): number {
  const m = HHMM_RE.exec(hhmm);
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`);
  return Number(m[1]) * 60 + Number(m[2]);
}

/** minutes since midnight → `HH:MM`; values ≥ 1440 wrap and are clamped to 23:59. */
export function fromMinutes(minutes: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of calendar dates between `start` and `end`. */
export function dateRange(start: string, end: string): string[] {
  if (!isIsoDate(start) || !isIsoDate(end)) {
    throw new Error(`Invalid date range ${start}..${end}`);
  }
  const out: string[] = [];
  let cursor = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const endMs = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  while (cursor <= endMs) {
    out.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += 86_400_000;
  }
  return out;
}

/** Whole days from `start` to `end` (exclusive), e.g. nights in a stay. */
export function daysBetween(start: string, end: string): number {
  const a = Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10)));
  const b = Date.UTC(Number(end.slice(0, 4)), Number(end.slice(5, 7)) - 1, Number(end.slice(8, 10)));
  return Math.round((b - a) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  const ms = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)));
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Calendar date portion of an ISO datetime string (as written, no tz shift). */
export function datePart(isoDateTime: string): string {
  return isoDateTime.slice(0, 10);
}

/** `HH:MM` portion of an ISO datetime string (as written, no tz shift). */
export function timePart(isoDateTime: string): string {
  return isoDateTime.slice(11, 16);
}

/**
 * Convert a wall-clock time in an IANA zone to a UTC instant. Handles DST
 * by computing the zone offset at the guessed instant and correcting once.
 */
export function zonedToUtc(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number) as [number, number, number];
  const [h, mi] = hhmm.split(':').map(Number) as [number, number];
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset1 = tzOffsetMs(guess, timeZone);
  const corrected = guess - offset1;
  const offset2 = tzOffsetMs(corrected, timeZone);
  return new Date(offset1 === offset2 ? corrected : guess - offset2);
}

function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(utcMs)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts['year']),
    Number(parts['month']) - 1,
    Number(parts['day']),
    Number(parts['hour']) % 24,
    Number(parts['minute']),
    Number(parts['second'])
  );
  return asUtc - utcMs;
}

/** `20261003T161500Z` form used by iCalendar for UTC instants. */
export function toIcsUtc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** `20261003T091500` floating form (no zone) from an ISO datetime without offset. */
export function toIcsFloating(isoDateTime: string): string {
  const m = DATETIME_RE.exec(isoDateTime);
  if (!m) throw new Error(`Invalid datetime "${isoDateTime}"`);
  return `${m[1]}${m[2]}${m[3]}T${m[4]}${m[5]}${m[6] ?? '00'}`;
}

/** `20261003` form for all-day values. */
export function toIcsDate(date: string): string {
  return date.replace(/-/g, '');
}

export function nowIso(): string {
  return new Date().toISOString();
}
