import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { SqliteTripkitRepository } from "../src/db/sqliteRepository.js";
import { loadTripExportBundle } from "../src/export/markdown.js";
import { buildDayItineraries } from "../src/mcp/ui/itinerary.js";
import type { DatabaseSync } from "node:sqlite";
import type { Trip } from "../src/domain/types.js";

describe("buildDayItineraries", () => {
  let db: DatabaseSync;
  let repo: SqliteTripkitRepository;
  let trip: Trip;

  beforeEach(async () => {
    db = openDatabase(":memory:");
    repo = new SqliteTripkitRepository(db);
    trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-13",
      homeTimezone: "America/Los_Angeles",
    });
    await repo.addFlight({
      tripId: trip.id,
      airline: "ANA",
      flightNumber: "NH7",
      departureAirport: "SFO",
      arrivalAirport: "HND",
      departureTime: "2026-04-10T13:15:00-07:00",
      arrivalTime: "2026-04-11T16:50:00+09:00",
    });
    await repo.addStay({
      tripId: trip.id,
      name: "Park Hyatt Tokyo",
      checkIn: "2026-04-11T15:00:00+09:00",
      checkOut: "2026-04-13T11:00:00+09:00",
    });
    const day = await repo.upsertDay({ tripId: trip.id, date: "2026-04-12", title: "Tokyo" });
    await repo.setDayPlan(day.id, [{ startTime: "09:00", endTime: "10:30", type: "activity", title: "Senso-ji" }]);
  });

  afterEach(() => {
    repo.close();
  });

  it("covers every calendar date in the trip range, including ones with no Day record", async () => {
    const bundle = await loadTripExportBundle(repo, trip.id);
    const itinerary = buildDayItineraries(bundle);
    expect(itinerary.map((d) => d.date)).toEqual(["2026-04-10", "2026-04-11", "2026-04-12", "2026-04-13"]);
    expect(itinerary[0]?.day).toBeUndefined();
  });

  it("attaches flights to their departure and arrival dates", async () => {
    const bundle = await loadTripExportBundle(repo, trip.id);
    const itinerary = buildDayItineraries(bundle);
    const departureDay = itinerary.find((d) => d.date === "2026-04-10");
    const arrivalDay = itinerary.find((d) => d.date === "2026-04-11");
    expect(departureDay?.flightsDeparting).toHaveLength(1);
    expect(departureDay?.flightsArriving).toHaveLength(0);
    expect(arrivalDay?.flightsArriving).toHaveLength(1);
  });

  it("attaches stays to their check-in and check-out dates", async () => {
    const bundle = await loadTripExportBundle(repo, trip.id);
    const itinerary = buildDayItineraries(bundle);
    const checkInDay = itinerary.find((d) => d.date === "2026-04-11");
    const checkOutDay = itinerary.find((d) => d.date === "2026-04-13");
    expect(checkInDay?.staysCheckingIn).toHaveLength(1);
    expect(checkOutDay?.staysCheckingOut).toHaveLength(1);
  });

  it("carries the day's blocks through for dates that have a plan", async () => {
    const bundle = await loadTripExportBundle(repo, trip.id);
    const itinerary = buildDayItineraries(bundle);
    const planned = itinerary.find((d) => d.date === "2026-04-12");
    expect(planned?.day?.title).toBe("Tokyo");
    expect(planned?.day?.blocks).toHaveLength(1);
  });
});
