import type { TransitMode, TransitSketch } from "./types.js";

/**
 * Placeholder duration estimates by mode, in minutes, for a "typical"
 * cross-town leg. v1 has no live routing/booking API; this exists so
 * agents get a plausible number to slot into a day plan rather than
 * nothing. Callers should treat it as a rough sketch, not a quote.
 */
const DEFAULT_DURATION_MINUTES: Record<TransitMode, number> = {
  walk: 20,
  bike: 15,
  drive: 15,
  taxi: 15,
  rideshare: 15,
  transit: 30,
  train: 40,
  unknown: 25,
};

function inferMode(fromPlace: string, toPlace: string): TransitMode {
  const text = `${fromPlace} ${toPlace}`.toLowerCase();
  if (text.includes("airport")) return "taxi";
  if (text.includes("station")) return "train";
  return "unknown";
}

function addMinutes(time: string, minutes: number): string {
  const [hStr, mStr] = time.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  const total = (h * 60 + m + minutes) % (24 * 60);
  const nh = Math.floor(total / 60);
  const nm = total % 60;
  return `${String(nh).padStart(2, "0")}:${String(nm).padStart(2, "0")}`;
}

export function sketchTransit(input: {
  fromPlace: string;
  toPlace: string;
  departTime?: string;
  modeHint?: TransitMode;
}): TransitSketch {
  const mode = input.modeHint ?? inferMode(input.fromPlace, input.toPlace);
  const estimatedDurationMinutes = DEFAULT_DURATION_MINUTES[mode];
  const arriveTime = input.departTime
    ? addMinutes(input.departTime, estimatedDurationMinutes)
    : undefined;

  return {
    fromPlace: input.fromPlace,
    toPlace: input.toPlace,
    mode,
    departTime: input.departTime,
    estimatedDurationMinutes,
    arriveTime,
    notes:
      "Placeholder estimate only — no live routing/booking API in v1. Confirm timing before relying on it.",
  };
}
