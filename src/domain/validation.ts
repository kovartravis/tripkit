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

/**
 * Throws OverlappingBlocksError if any two blocks share time, comparing
 * HH:MM strings lexicographically (safe since they're zero-padded 24h).
 */
export function assertNoOverlaps(blocks: readonly DayBlockInput[]): void {
  const sorted = [...blocks].sort((x, y) =>
    x.startTime.localeCompare(y.startTime),
  );
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.startTime < prev.endTime) {
      throw new OverlappingBlocksError(prev, cur);
    }
  }
}
