import { describe, it, expect } from "vitest";
import { tripCreateInputSchema, dayBlockInputSchema, flightAddInputSchema } from "../src/domain/types.js";
import { assertNoOverlaps, OverlappingBlocksError } from "../src/domain/validation.js";
import { generatePackingItems } from "../src/domain/packing.js";
import { sketchTransit } from "../src/domain/transit.js";

describe("schema validation", () => {
  it("accepts a well-formed trip create input", () => {
    const result = tripCreateInputSchema.safeParse({
      name: "Iceland Ring Road",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      homeTimezone: "America/New_York",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a trip whose end date precedes its start date", () => {
    const result = tripCreateInputSchema.safeParse({
      name: "Backwards",
      startDate: "2026-06-10",
      endDate: "2026-06-01",
      homeTimezone: "America/New_York",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a non-IANA home timezone", () => {
    const result = tripCreateInputSchema.safeParse({
      name: "Wherever",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      homeTimezone: "Not/AZone",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a day block whose end time precedes its start time", () => {
    const result = dayBlockInputSchema.safeParse({
      startTime: "12:00",
      endTime: "11:00",
      type: "activity",
      title: "Time travel",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a flight with a malformed departure airport code", () => {
    const result = flightAddInputSchema.safeParse({
      tripId: "trip_1",
      airline: "United",
      flightNumber: "UA1",
      departureAirport: "S",
      arrivalAirport: "HND",
      departureTime: "2026-04-10T13:15:00-07:00",
      arrivalTime: "2026-04-11T16:50:00+09:00",
    });
    expect(result.success).toBe(false);
  });
});

describe("assertNoOverlaps", () => {
  it("allows back-to-back, non-overlapping blocks", () => {
    expect(() =>
      assertNoOverlaps([
        { startTime: "09:00", endTime: "10:00", type: "activity", title: "A" },
        { startTime: "10:00", endTime: "11:00", type: "activity", title: "B" },
      ]),
    ).not.toThrow();
  });

  it("throws OverlappingBlocksError for overlapping blocks regardless of input order", () => {
    expect(() =>
      assertNoOverlaps([
        { startTime: "10:30", endTime: "11:30", type: "activity", title: "B" },
        { startTime: "09:00", endTime: "11:00", type: "activity", title: "A" },
      ]),
    ).toThrow(OverlappingBlocksError);
  });
});

describe("generatePackingItems", () => {
  it("scales base and climate items by traveler count", () => {
    const items = generatePackingItems({
      nights: 5,
      travelerCount: 2,
      climateHints: ["cold"],
      activityHints: [],
    });
    const jacket = items.find((i) => i.label === "insulated jacket");
    expect(jacket?.quantity).toBe(2);
  });

  it("adds activity-specific items when hinted", () => {
    const items = generatePackingItems({
      nights: 3,
      travelerCount: 1,
      climateHints: ["mild"],
      activityHints: ["hiking"],
    });
    expect(items.some((i) => i.label === "hiking boots")).toBe(true);
  });

  it("caps underwear/socks quantity at 10 for long trips", () => {
    const items = generatePackingItems({
      nights: 30,
      travelerCount: 1,
      climateHints: ["mild"],
      activityHints: [],
    });
    expect(items.find((i) => i.label === "socks")?.quantity).toBe(10);
  });
});

describe("sketchTransit", () => {
  it("computes an arrival time from a depart time and duration estimate", () => {
    const sketch = sketchTransit({ fromPlace: "Hotel", toPlace: "Museum", departTime: "09:00", modeHint: "walk" });
    expect(sketch.estimatedDurationMinutes).toBe(20);
    expect(sketch.arriveTime).toBe("09:20");
  });

  it("infers taxi mode when an airport is mentioned", () => {
    const sketch = sketchTransit({ fromPlace: "Hotel", toPlace: "Narita Airport" });
    expect(sketch.mode).toBe("taxi");
  });
});
