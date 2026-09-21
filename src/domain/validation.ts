import type { DayBlockInput } from "./types.js";

export class OverlappingBlocksError extends Error {
  constructor(
    public readonly a: DayBlockInput,
    public readonly b: DayBlockInput,
  ) {
    super(
      `day plan blocks overlap: "${a.title}" (${a.startTime}-${a.endTime}) and "${b.title}" (${b.startTime}-${b.endTime})`,
    );
    this.name = "OverlappingBlocksError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Throws OverlappingBlocksError if any two blocks share time, comparing
 * HH:MM strings lexicographically (safe since they're zero-padded 24h).
 */
export function assertNoOverlaps(blocks: readonly DayBlockInput[]): void {
  const sorted = sortBlocks(blocks);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.startTime < prev.endTime) {
      throw new OverlappingBlocksError(prev, cur);
    }
  }
}

/** Stable sort by startTime, then endTime, then title. */
export function sortBlocks<T extends { startTime: string; endTime: string; title: string }>(
  blocks: readonly T[],
): T[] {
  return [...blocks].sort(
    (x, y) =>
      x.startTime.localeCompare(y.startTime) ||
      x.endTime.localeCompare(y.endTime) ||
      x.title.localeCompare(y.title),
  );
}

export function assertEndOnOrAfterStart(startDate: string, endDate: string): void {
  if (endDate < startDate) {
    throw new ValidationError("endDate must be on or after startDate");
  }
}

export function assertEndAfterStart(
  start: string,
  end: string,
  startName: string,
  endName: string,
): void {
  if (new Date(end).getTime() <= new Date(start).getTime()) {
    throw new ValidationError(`${endName} must be after ${startName}`);
  }
}

export function isIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}
