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
 * Storage port. v1 ships a SQLite-backed implementation
 * (`SqliteTripkitRepository`) for local-first use; a hosted backend can
 * implement this same interface later without touching MCP tool code.
 */
export interface TripkitRepository {
  createTrip(input: TripCreateInput): Trip;
  updateTrip(input: TripUpdateInput): Trip;
  getTrip(id: string): Trip | undefined;
  listTrips(): Trip[];

  addPerson(input: PersonAddInput): Person;
  updatePerson(input: PersonUpdateInput): Person;
  listPeople(tripId: string): Person[];

  addFlight(input: FlightAddInput): Flight;
  updateFlight(input: FlightUpdateInput): Flight;
  listFlights(tripId: string): Flight[];

  addStay(input: StayAddInput): Stay;
  updateStay(input: StayUpdateInput): Stay;
  listStays(tripId: string): Stay[];

  upsertDay(input: DayUpsertInput): Day;
  getDay(id: string): Day | undefined;
  getDayByDate(tripId: string, date: string): Day | undefined;
  listDays(tripId: string, range?: { startDate?: string; endDate?: string }): Day[];
  setDayPlan(dayId: string, blocks: DayBlockInput[]): Day;

  listPackingItems(tripId: string): PackingItem[];
  replacePackingItems(
    tripId: string,
    items: Array<{ category: string; label: string; quantity: number }>,
  ): PackingItem[];
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
  ): PackingItem[];

  query(tripId: string, filters: QueryFilters): QueryResult;

  close(): void;
}
