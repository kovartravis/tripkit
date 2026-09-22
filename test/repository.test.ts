import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { openDatabase } from "../src/db/client.js";
import { SqliteTripkitRepository } from "../src/db/sqliteRepository.js";
import { OverlappingBlocksError } from "../src/domain/validation.js";
import { NotFoundError } from "../src/db/repository.js";
import type { DatabaseSync } from "node:sqlite";

describe("SqliteTripkitRepository", () => {
  let db: DatabaseSync;
  let repo: SqliteTripkitRepository;

  beforeEach(() => {
    db = openDatabase(":memory:");
    repo = new SqliteTripkitRepository(db);
  });

  afterEach(() => {
    repo.close();
  });

  it("creates and fetches a trip", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });

    expect(trip.id).toMatch(/^trip_/);
    expect(await repo.getTrip(trip.id)).toEqual(trip);
    expect(await repo.listTrips()).toEqual([trip]);
  });

  it("throws NotFoundError for an unknown trip", async () => {
    await expect(repo.updateTrip({ id: "trip_missing", name: "x" })).rejects.toThrow(NotFoundError);
  });

  it("adds a flight to a trip and lists it back", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });

    const flight = await repo.addFlight({
      tripId: trip.id,
      airline: "ANA",
      flightNumber: "NH7",
      departureAirport: "SFO",
      arrivalAirport: "HND",
      departureTime: "2026-04-10T13:15:00-07:00",
      arrivalTime: "2026-04-11T16:50:00+09:00",
      seat: "22A",
    });

    expect(flight.tripId).toBe(trip.id);
    expect(await repo.listFlights(trip.id)).toEqual([flight]);
  });

  it("rejects adding a flight to a nonexistent trip", async () => {
    await expect(
      repo.addFlight({
        tripId: "trip_missing",
        airline: "ANA",
        flightNumber: "NH7",
        departureAirport: "SFO",
        arrivalAirport: "HND",
        departureTime: "2026-04-10T13:15:00-07:00",
        arrivalTime: "2026-04-11T16:50:00+09:00",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("sets a day plan with non-overlapping blocks", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    const day = await repo.upsertDay({ tripId: trip.id, date: "2026-04-12", title: "Tokyo" });

    const updated = await repo.setDayPlan(day.id, [
      { startTime: "09:00", endTime: "10:30", type: "activity", title: "Senso-ji" },
      { startTime: "10:45", endTime: "12:00", type: "activity", title: "Nakamise shopping" },
      { startTime: "12:15", endTime: "13:15", type: "meal", title: "Ramen lunch" },
    ]);

    expect(updated.blocks).toHaveLength(3);
    expect(updated.blocks.map((b) => b.title)).toEqual(["Senso-ji", "Nakamise shopping", "Ramen lunch"]);
  });

  it("rejects overlapping day plan blocks", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    const day = await repo.upsertDay({ tripId: trip.id, date: "2026-04-12" });

    await expect(
      repo.setDayPlan(day.id, [
        { startTime: "09:00", endTime: "10:30", type: "activity", title: "Senso-ji" },
        { startTime: "10:00", endTime: "11:00", type: "activity", title: "Overlaps" },
      ]),
    ).rejects.toThrow(OverlappingBlocksError);

    // The failed set should not have partially persisted.
    expect((await repo.getDay(day.id))!.blocks).toHaveLength(0);
  });

  it("upsertDay is idempotent on trip + date", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-20",
      homeTimezone: "America/Los_Angeles",
    });
    const first = await repo.upsertDay({ tripId: trip.id, date: "2026-04-12", title: "Tokyo" });
    const second = await repo.upsertDay({ tripId: trip.id, date: "2026-04-12", title: "Tokyo (updated)" });

    expect(second.id).toBe(first.id);
    expect(await repo.listDays(trip.id)).toHaveLength(1);
    expect(second.title).toBe("Tokyo (updated)");
  });

  it("generates then merges packing items without clobbering checkoffs", async () => {
    const trip = await repo.createTrip({
      name: "Japan 2026",
      startDate: "2026-04-10",
      endDate: "2026-04-13",
      homeTimezone: "America/Los_Angeles",
    });
    const items = await repo.replacePackingItems(trip.id, [
      { category: "documents", label: "passport / ID", quantity: 1 },
    ]);
    await repo.upsertPackingItems(trip.id, [{ id: items[0]!.id, label: items[0]!.label, packed: true }], []);

    const merged = await repo.upsertPackingItems(
      trip.id,
      [{ category: "clothing", label: "socks", quantity: 3 }],
      [],
    );

    const passport = merged.find((i) => i.label === "passport / ID");
    expect(passport?.packed).toBe(true);
    expect(merged.find((i) => i.label === "socks")?.quantity).toBe(3);
  });
});
