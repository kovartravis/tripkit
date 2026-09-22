import type {
  Day,
  DayBlockInput,
  DayUpsertInput,
  Flight,
  FlightAddInput,
  FlightUpdateInput,
  PackingItem,
  Person,
  PersonAddInput,
  PersonUpdateInput,
  QueryEntityType,
  Stay,
  StayAddInput,
  StayUpdateInput,
  Trip,
  TripCreateInput,
  TripUpdateInput,
} from "../domain/types.js";

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export interface QueryFilters {
  entityTypes: QueryEntityType[];
  startDate?: string;
  endDate?: string;
  personId?: string;
}

export interface QueryResult {
  trip?: Trip;
  people?: Person[];
  flights?: Flight[];
  stays?: Stay[];
  days?: Day[];
  packingItems?: PackingItem[];
}

/**
 * Storage port. v1 shipped a SQLite-backed implementation
 * (`SqliteTripkitRepository`) for local-first use; `SupabaseTripkitRepository` implements the
 * same interface against Postgres/RLS. Every data-access method is async because RLS
 * enforcement requires a real network round trip per call (see
 * `SupabaseTripkitRepository.withAuth`) — `SqliteTripkitRepository`'s methods are still
 * synchronous under the hood but satisfy this interface trivially since an `async` method
 * whose body has nothing to await still returns a `Promise` that resolves on the same tick.
 */
export interface TripkitRepository {
  createTrip(input: TripCreateInput): Promise<Trip>;
  updateTrip(input: TripUpdateInput): Promise<Trip>;
  getTrip(id: string): Promise<Trip | undefined>;
  listTrips(): Promise<Trip[]>;

  addPerson(input: PersonAddInput): Promise<Person>;
  updatePerson(input: PersonUpdateInput): Promise<Person>;
  listPeople(tripId: string): Promise<Person[]>;

  addFlight(input: FlightAddInput): Promise<Flight>;
  updateFlight(input: FlightUpdateInput): Promise<Flight>;
  listFlights(tripId: string): Promise<Flight[]>;

  addStay(input: StayAddInput): Promise<Stay>;
  updateStay(input: StayUpdateInput): Promise<Stay>;
  listStays(tripId: string): Promise<Stay[]>;

  upsertDay(input: DayUpsertInput): Promise<Day>;
  getDay(id: string): Promise<Day | undefined>;
  getDayByDate(tripId: string, date: string): Promise<Day | undefined>;
  listDays(tripId: string, range?: { startDate?: string; endDate?: string }): Promise<Day[]>;
  setDayPlan(dayId: string, blocks: DayBlockInput[]): Promise<Day>;

  listPackingItems(tripId: string): Promise<PackingItem[]>;
  replacePackingItems(
    tripId: string,
    items: Array<{ category: string; label: string; quantity: number }>,
  ): Promise<PackingItem[]>;
  upsertPackingItems(
    tripId: string,
    upserts: Array<{
      id?: string;
      category?: string;
      label: string;
      quantity?: number;
      packed?: boolean;
      notes?: string;
    }>,
    removeIds: string[],
  ): Promise<PackingItem[]>;

  query(tripId: string, filters: QueryFilters): Promise<QueryResult>;

  close(): void;
}
