import type { TripkitRepository } from "../../src/db/repository.js";
import type { Day, Flight, PackingItem, Person, Stay, Trip } from "../../src/domain/types.js";

/**
 * An in-memory, read-only-by-construction `TripkitRepository`: seeded once with plain data
 * literals and never mutated after. Used by tests that exercise pure functions built on top of
 * a repository (`exportMarkdown`, `exportIcs`, `buildDayItineraries`) — those functions only
 * ever read, so every write method here throws, making an accidental write in test setup a
 * loud failure rather than a silent no-op.
 */
export function fakeTripkitRepository(data: {
  trip: Trip;
  people?: Person[];
  flights?: Flight[];
  stays?: Stay[];
  days?: Day[];
  packingItems?: PackingItem[];
}): TripkitRepository {
  const notImplemented = (): never => {
    throw new Error("fakeTripkitRepository: write methods are not implemented");
  };

  return {
    createTrip: notImplemented,
    updateTrip: notImplemented,
    getTrip: async (id) => (id === data.trip.id ? data.trip : undefined),
    listTrips: async () => [data.trip],

    addPerson: notImplemented,
    updatePerson: notImplemented,
    listPeople: async () => data.people ?? [],

    addFlight: notImplemented,
    updateFlight: notImplemented,
    listFlights: async () => data.flights ?? [],

    addStay: notImplemented,
    updateStay: notImplemented,
    listStays: async () => data.stays ?? [],

    upsertDay: notImplemented,
    getDay: notImplemented,
    getDayByDate: notImplemented,
    listDays: async () => data.days ?? [],
    setDayPlan: notImplemented,

    listPackingItems: async () => data.packingItems ?? [],
    replacePackingItems: notImplemented,
    upsertPackingItems: notImplemented,

    query: notImplemented,
    close: () => {},
  };
}
