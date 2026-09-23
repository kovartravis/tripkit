import { describe, it, expect, beforeEach } from "vitest";
import { fakeTripkitRepository } from "./support/fakeRepository.js";
import { exportMarkdown } from "../src/export/markdown.js";
import { exportIcs } from "../src/export/ics.js";
import type { TripkitRepository } from "../src/db/repository.js";
import type { Day, Trip } from "../src/domain/types.js";

describe("exports", () => {
  let repo: TripkitRepository;
  let trip: Trip;
  let day: Day;

  beforeEach(() => {
    const ts = "2026-01-01T00:00:00Z";
    trip = {
      id: "trip-1",
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-13",
      homeTimezone: "America/Los_Angeles",
      notes: "Cherry blossom trip",
      createdAt: ts,
      updatedAt: ts,
    };
    day = {
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
          place: "Asakusa",
        },
      ],
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
          confirmation: "ABC123",
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
      days: [day],
    });
  });

  it("renders a markdown export with trip sections", async () => {
    const markdown = await exportMarkdown(repo, trip.id);
    expect(markdown).toContain("# Japan 2026");
    expect(markdown).toContain("Cherry blossom trip");
    expect(markdown).toContain("ANA NH7");
    expect(markdown).toContain("Park Hyatt Tokyo");
    expect(markdown).toContain("Senso-ji");
  });

  it("scopes markdown export to a single day", async () => {
    const markdown = await exportMarkdown(repo, trip.id, day.id);
    expect(markdown).toContain("2026-04-12");
    expect(markdown).toContain("Senso-ji");
    expect(markdown).not.toContain("Park Hyatt Tokyo");
  });

  it("renders a valid ICS calendar with flight, stay, and block events", async () => {
    const ics = await exportIcs(repo, trip.id);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
    expect(ics).toContain("SUMMARY:ANA NH7: SFO → HND");
  });

  it("scopes ICS export to a single day's blocks", async () => {
    const ics = await exportIcs(repo, trip.id, day.id);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain("SUMMARY:Senso-ji");
  });
});
