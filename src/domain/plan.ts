import type { DayBlockInput } from './schemas.js';
import { PlanConflictError } from './errors.js';
import { toMinutes } from './time.js';

export interface PlanOverlap {
  a: { index: number; title: string; window: string };
  b: { index: number; title: string; window: string };
}

/**
 * The one hard constraint on a day plan: blocks occupy disjoint time
 * windows. Adjacent blocks (one ends 10:00, next starts 10:00) are fine.
 * Returns the blocks sorted by start time with `position` assigned.
 */
export function normalizeDayPlan(blocks: DayBlockInput[]): Array<DayBlockInput & { position: number }> {
  const indexed = blocks.map((b, index) => ({ ...b, index, start: toMinutes(b.start_time), end: toMinutes(b.end_time) }));
  indexed.sort((x, y) => x.start - y.start || x.end - y.end || x.index - y.index);

  const overlaps: PlanOverlap[] = [];
  for (let i = 1; i < indexed.length; i++) {
    const prev = indexed[i - 1]!;
    const cur = indexed[i]!;
    if (cur.start < prev.end) {
      overlaps.push({
        a: { index: prev.index, title: prev.title, window: `${prev.start_time}-${prev.end_time}` },
        b: { index: cur.index, title: cur.title, window: `${cur.start_time}-${cur.end_time}` },
      });
    }
  }

  if (overlaps.length > 0) {
    const first = overlaps[0]!;
    throw new PlanConflictError(
      `Day plan rejected: ${overlaps.length} overlapping block${overlaps.length === 1 ? '' : 's'}. ` +
        `"${first.a.title}" (${first.a.window}) overlaps "${first.b.title}" (${first.b.window}). ` +
        'Adjust the time windows so no two blocks share a minute, then call tripkit_day_plan_set again.',
      { overlaps }
    );
  }

  return indexed.map(({ index: _index, start: _s, end: _e, ...rest }, position) => ({ ...rest, position }));
}

/** Free windows in a day between the given blocks (already validated). */
export function freeWindows(
  blocks: Array<{ start_time: string; end_time: string }>,
  dayStart = '06:00',
  dayEnd = '23:00'
): Array<{ start_time: string; end_time: string; minutes: number }> {
  const sorted = [...blocks].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  const out: Array<{ start_time: string; end_time: string; minutes: number }> = [];
  let cursor = toMinutes(dayStart);
  const end = toMinutes(dayEnd);
  for (const b of sorted) {
    const s = toMinutes(b.start_time);
    const e = toMinutes(b.end_time);
    if (s > cursor) out.push({ start_time: minutesToClock(cursor), end_time: b.start_time, minutes: s - cursor });
    cursor = Math.max(cursor, e);
  }
  if (cursor < end) out.push({ start_time: minutesToClock(cursor), end_time: dayEnd, minutes: end - cursor });
  return out;
}

function minutesToClock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
