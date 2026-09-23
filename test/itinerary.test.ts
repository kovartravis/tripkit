import { describe, it, expect, beforeEach } from "vitest";
import { fakeTripkitRepository } from "./support/fakeRepository.js";
import { loadTripExportBundle } from "../src/export/markdown.js";
import { buildDayItineraries } from "../src/mcp/ui/itinerary.js";
import type { TripkitRepository } from "../src/db/repository.js";
import type { Trip } from "../src/domain/types.js";

describe("buildDayItineraries", () => {
  let repo: TripkitRepository;
  let trip: Trip;

  beforeEach(() => {
    const ts = "2026-01-01T00:00:00Z";
    trip = {
      id: "trip-1",
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-13",
      homeTimezone: "America/Los_Angeles",
      createdAt: ts,
      updatedAt: ts,
    };

    repo = fakeTripkitRepository({
      trip,
      flights: [
        {
          id: "flight-1",
          tripId: trip.id,
          airline: "ANA",
          flightNumber: "NH7",
          departureAirport: "SFO",
          arrivalAirport: "HND",
          departureTime: "2026-04-10T13:15:00-07:00",
          arrivalTime: "2026-04-11T16:50:00+09:00",
          travelerIds: [],
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      stays: [
        {
          id: "stay-1",
          tripId: trip.id,
          name: "Park Hyatt Tokyo",
          checkIn: "2026-04-11T15:00:00+09:00",
          checkOut: "2026-04-13T11:00:00+09:00",
          guestIds: [],
          createdAt: ts,
          updatedAt: ts,
        },
      ],
      days: [
        {
          id: "day-1",
          tripId: trip.id,
          date: "2026-04-12",
          title: "Tokyo",
          blocks: [
            {
              id: "block-1",
              dayId: "day-1",
              order: 0,
              startTime: "09:00",
              endTime: "10:30",
              type: "activity",
              title: "Senso-ji",
            },
          ],
          createdAt: ts,
          updatedAt: ts,
        },
      ],
    });
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
