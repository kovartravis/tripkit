import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { SqliteTripkitRepository } from "../src/db/sqliteRepository.js";
import { exportMarkdown } from "../src/export/markdown.js";
import { exportIcs } from "../src/export/ics.js";
import type { DatabaseSync } from "node:sqlite";
import type { Day, Trip } from "../src/domain/types.js";

describe("exports", () => {
  let db: DatabaseSync;
  let repo: SqliteTripkitRepository;
  let trip: Trip;
  let day: Day;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SqliteTripkitRepository(db);
    trip = repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-13",
      homeTimezone: "America/Los_Angeles",
      notes: "Cherry blossom trip",
    });
    repo.addFlight({
      tripId: trip.id,
      airline: "ANA",
      flightNumber: "NH7",
      departureAirport: "SFO",
      arrivalAirport: "HND",
      departureTime: "2026-04-10T13:15:00-07:00",
      arrivalTime: "2026-04-11T16:50:00+09:00",
      confirmation: "ABC123",
    });
    repo.addStay({
      tripId: trip.id,
      name: "Park Hyatt Tokyo",
      checkIn: "2026-04-11T15:00:00+09:00",
      checkOut: "2026-04-13T11:00:00+09:00",
    });
    day = repo.upsertDay({ tripId: trip.id, date: "2026-04-12", title: "Tokyo" });
    day = repo.setDayPlan(day.id, [
      { startTime: "09:00", endTime: "10:30", type: "activity", title: "Senso-ji", place: "Asakusa" },
    ]);
  });

  afterEach(() => {
    repo.close();
  });

  it("renders a markdown export with trip sections", () => {
    const markdown = exportMarkdown(repo, trip.id);
    expect(markdown).toContain("# Japan 2026");
    expect(markdown).toContain("Cherry blossom trip");
    expect(markdown).toContain("ANA NH7");
    expect(markdown).toContain("Park Hyatt Tokyo");
    expect(markdown).toContain("Senso-ji");
  });

  it("scopes markdown export to a single day", () => {
    const markdown = exportMarkdown(repo, trip.id, day.id);
    expect(markdown).toContain("2026-04-12");
    expect(markdown).toContain("Senso-ji");
    expect(markdown).not.toContain("Park Hyatt Tokyo");
  });

  it("renders a valid ICS calendar with flight, stay, and block events", () => {
    const ics = exportIcs(repo, trip.id);
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("END:VCALENDAR");
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(3);
    expect(ics).toContain("SUMMARY:ANA NH7: SFO → HND");
  });

  it("scopes ICS export to a single day's blocks", () => {
    const ics = exportIcs(repo, trip.id, day.id);
    expect((ics.match(/BEGIN:VEVENT/g) ?? []).length).toBe(1);
    expect(ics).toContain("SUMMARY:Senso-ji");
  });
});
