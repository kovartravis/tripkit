import { z } from 'zod';
import { isHHMM, isIsoDate, isIsoDateTime, isValidTimeZone } from './time.js';

/**
 * Zod schemas for every entity in the ledger and for every tool input.
 * These are the single source of truth: the SQLite repository stores what
 * these describe, the MCP server validates against them, and the CLI /
 * library consumers get the inferred TypeScript types.
 *
 * Conventions: snake_case keys (they cross the MCP boundary as JSON),
 * `YYYY-MM-DD` dates, `HH:MM` clock times, ISO 8601 instants.
 */

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

export const IsoDate = z
  .string()
  .refine(isIsoDate, { message: 'Expected a calendar date in YYYY-MM-DD form' })
  .describe('Calendar date, YYYY-MM-DD');

export const ClockTime = z
  .string()
  .refine(isHHMM, { message: 'Expected a 24h clock time in HH:MM form' })
  .describe('24h clock time, HH:MM');

export const IsoDateTime = z
  .string()
  .refine(isIsoDateTime, {
    message: 'Expected an ISO 8601 datetime such as 2026-10-03T08:15 or 2026-10-03T08:15:00-07:00',
  })
  .describe('ISO 8601 datetime; include a UTC offset when known, omit it for airport-local wall time');

export const TimeZone = z
  .string()
  .refine(isValidTimeZone, { message: 'Expected an IANA time zone such as America/Los_Angeles' })
  .describe('IANA time zone, e.g. Europe/Lisbon');

export const AirportCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3,4}$/, 'Expected a 3-letter IATA (or 4-letter ICAO) airport code')
  .describe('Airport code, e.g. SFO');

export const EntityId = z.string().min(1);

const NonEmpty = z.string().trim().min(1);

// ---------------------------------------------------------------------------
// Trips
// ---------------------------------------------------------------------------

export const TripSchema = z.object({
  id: EntityId,
  name: NonEmpty,
  start_date: IsoDate,
  end_date: IsoDate,
  home_timezone: TimeZone,
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Trip = z.infer<typeof TripSchema>;

function datesOrdered(v: { start_date?: string; end_date?: string }): boolean {
  if (!v.start_date || !v.end_date) return true;
  return v.start_date <= v.end_date;
}

export const TripCreateInput = z
  .object({
    name: NonEmpty.describe('Trip name, e.g. "Lisbon, October"'),
    start_date: IsoDate,
    end_date: IsoDate,
    home_timezone: TimeZone.describe('Traveler home time zone; used as the default zone for day plans'),
    notes: z.string().optional(),
  })
  .refine(datesOrdered, { message: 'end_date must be on or after start_date', path: ['end_date'] });
export type TripCreateInput = z.infer<typeof TripCreateInput>;

export const TripUpdateInput = z
  .object({
    trip_id: EntityId,
    name: NonEmpty.optional(),
    start_date: IsoDate.optional(),
    end_date: IsoDate.optional(),
    home_timezone: TimeZone.optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(datesOrdered, { message: 'end_date must be on or after start_date', path: ['end_date'] });
export type TripUpdateInput = z.infer<typeof TripUpdateInput>;

// ---------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------

export const PersonSchema = z.object({
  id: EntityId,
  trip_id: EntityId,
  name: NonEmpty,
  role: z.string().nullable(),
  email: z.string().nullable(),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Person = z.infer<typeof PersonSchema>;

export const PersonAddInput = z.object({
  trip_id: EntityId,
  name: NonEmpty,
  role: z.string().optional().describe('Free-form role, e.g. "organizer", "kid", "partner"'),
  email: z.email().optional(),
  notes: z.string().optional().describe('Dietary needs, passport expiry reminders, seat preferences…'),
});
export type PersonAddInput = z.infer<typeof PersonAddInput>;

export const PersonUpdateInput = z.object({
  person_id: EntityId,
  name: NonEmpty.optional(),
  role: z.string().nullable().optional(),
  email: z.email().nullable().optional(),
  notes: z.string().nullable().optional(),
});
export type PersonUpdateInput = z.infer<typeof PersonUpdateInput>;

// ---------------------------------------------------------------------------
// Flights
// ---------------------------------------------------------------------------

export const FlightSchema = z.object({
  id: EntityId,
  trip_id: EntityId,
  airline: NonEmpty,
  flight_number: NonEmpty,
  depart_airport: AirportCode,
  arrive_airport: AirportCode,
  depart_at: IsoDateTime,
  arrive_at: IsoDateTime,
  confirmation: z.string().nullable(),
  seat: z.string().nullable(),
  traveler_ids: z.array(EntityId),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Flight = z.infer<typeof FlightSchema>;

export const FlightAddInput = z.object({
  trip_id: EntityId,
  airline: NonEmpty.describe('Marketing carrier name or code, e.g. "TAP" or "United"'),
  flight_number: NonEmpty.describe('e.g. "TP 238"'),
  depart_airport: AirportCode,
  arrive_airport: AirportCode,
  depart_at: IsoDateTime,
  arrive_at: IsoDateTime,
  confirmation: z.string().optional().describe('Record locator / PNR'),
  seat: z.string().optional(),
  traveler_ids: z.array(EntityId).optional().describe('Person ids on this flight; defaults to nobody'),
  notes: z.string().optional(),
});
export type FlightAddInput = z.infer<typeof FlightAddInput>;

export const FlightUpdateInput = z.object({
  flight_id: EntityId,
  airline: NonEmpty.optional(),
  flight_number: NonEmpty.optional(),
  depart_airport: AirportCode.optional(),
  arrive_airport: AirportCode.optional(),
  depart_at: IsoDateTime.optional(),
  arrive_at: IsoDateTime.optional(),
  confirmation: z.string().nullable().optional(),
  seat: z.string().nullable().optional(),
  traveler_ids: z.array(EntityId).optional(),
  notes: z.string().nullable().optional(),
});
export type FlightUpdateInput = z.infer<typeof FlightUpdateInput>;

// ---------------------------------------------------------------------------
// Stays
// ---------------------------------------------------------------------------

export const StaySchema = z.object({
  id: EntityId,
  trip_id: EntityId,
  name: NonEmpty,
  check_in: IsoDate,
  check_out: IsoDate,
  check_in_time: ClockTime.nullable(),
  check_out_time: ClockTime.nullable(),
  address: z.string().nullable(),
  confirmation: z.string().nullable(),
  guest_ids: z.array(EntityId),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Stay = z.infer<typeof StaySchema>;

function stayOrdered(v: { check_in?: string; check_out?: string }): boolean {
  if (!v.check_in || !v.check_out) return true;
  return v.check_in < v.check_out;
}

export const StayAddInput = z
  .object({
    trip_id: EntityId,
    name: NonEmpty.describe('Lodging name, e.g. "Hotel Avenida Palace"'),
    check_in: IsoDate,
    check_out: IsoDate,
    check_in_time: ClockTime.optional(),
    check_out_time: ClockTime.optional(),
    address: z.string().optional(),
    confirmation: z.string().optional(),
    guest_ids: z.array(EntityId).optional().describe('Person ids staying here; defaults to nobody'),
    notes: z.string().optional(),
  })
  .refine(stayOrdered, { message: 'check_out must be after check_in', path: ['check_out'] });
export type StayAddInput = z.infer<typeof StayAddInput>;

export const StayUpdateInput = z
  .object({
    stay_id: EntityId,
    name: NonEmpty.optional(),
    check_in: IsoDate.optional(),
    check_out: IsoDate.optional(),
    check_in_time: ClockTime.nullable().optional(),
    check_out_time: ClockTime.nullable().optional(),
    address: z.string().nullable().optional(),
    confirmation: z.string().nullable().optional(),
    guest_ids: z.array(EntityId).optional(),
    notes: z.string().nullable().optional(),
  })
  .refine(stayOrdered, { message: 'check_out must be after check_in', path: ['check_out'] });
export type StayUpdateInput = z.infer<typeof StayUpdateInput>;

// ---------------------------------------------------------------------------
// Days and day blocks
// ---------------------------------------------------------------------------

export const BLOCK_TYPES = ['activity', 'meal', 'transit', 'buffer', 'other'] as const;
export const BlockType = z.enum(BLOCK_TYPES);
export type BlockType = z.infer<typeof BlockType>;

export const DayBlockSchema = z.object({
  id: EntityId,
  day_id: EntityId,
  position: z.number().int().nonnegative(),
  start_time: ClockTime,
  end_time: ClockTime,
  type: BlockType,
  title: NonEmpty,
  place: z.string().nullable(),
  notes: z.string().nullable(),
});
export type DayBlock = z.infer<typeof DayBlockSchema>;

export const DaySchema = z.object({
  id: EntityId,
  trip_id: EntityId,
  date: IsoDate,
  title: z.string().nullable(),
  notes: z.string().nullable(),
  timezone: TimeZone.nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Day = z.infer<typeof DaySchema>;

export const DayWithBlocksSchema = DaySchema.extend({ blocks: z.array(DayBlockSchema) });
export type DayWithBlocks = z.infer<typeof DayWithBlocksSchema>;

export const DayUpsertInput = z.object({
  trip_id: EntityId,
  date: IsoDate,
  title: z.string().nullable().optional().describe('Short headline for the day, e.g. "Sintra day trip"'),
  notes: z.string().nullable().optional(),
  timezone: TimeZone.nullable().optional().describe('Zone the day is lived in; defaults to the trip home_timezone'),
});
export type DayUpsertInput = z.infer<typeof DayUpsertInput>;

export const DayBlockInput = z
  .object({
    start_time: ClockTime,
    end_time: ClockTime,
    type: BlockType,
    title: NonEmpty,
    place: z.string().optional(),
    notes: z.string().optional(),
  })
  .refine((b) => b.start_time < b.end_time, {
    message: 'end_time must be after start_time (blocks cannot cross midnight)',
    path: ['end_time'],
  });
export type DayBlockInput = z.infer<typeof DayBlockInput>;

export const DayPlanSetInput = z.object({
  trip_id: EntityId,
  date: IsoDate,
  blocks: z
    .array(DayBlockInput)
    .describe('The complete plan for the day, replacing any existing blocks. Blocks may not overlap.'),
});
export type DayPlanSetInput = z.infer<typeof DayPlanSetInput>;

export const DayGetInput = z.object({ trip_id: EntityId, date: IsoDate });
export const DayListInput = z.object({
  trip_id: EntityId,
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

export const PackingItemSchema = z.object({
  id: EntityId,
  trip_id: EntityId,
  name: NonEmpty,
  category: NonEmpty,
  quantity: z.number().int().positive(),
  checked: z.boolean(),
  person_id: EntityId.nullable(),
  source: z.enum(['generated', 'manual']),
  notes: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type PackingItem = z.infer<typeof PackingItemSchema>;

export const CLIMATE_HINTS = ['hot', 'warm', 'mild', 'cool', 'cold', 'rain', 'snow', 'humid', 'sun'] as const;
export const ClimateHint = z.enum(CLIMATE_HINTS);
export type ClimateHint = z.infer<typeof ClimateHint>;

export const PackingListGenerateInput = z.object({
  trip_id: EntityId,
  climate: z
    .array(ClimateHint)
    .optional()
    .describe('Climate hints for the destination, e.g. ["warm", "rain"]. Drives the deterministic rules.'),
  activities: z
    .array(z.string())
    .optional()
    .describe('Extra activity keywords (beach, hike, swim, formal, business, camping, ski…) beyond those inferred from day plans'),
  laundry_every_days: z
    .number()
    .int()
    .positive()
    .optional()
    .describe('If you can do laundry, clothing quantities are capped to this many days (default 7)'),
  replace: z
    .boolean()
    .optional()
    .describe('Replace previously generated items (unchecked ones only). Manual items are never touched. Default true.'),
});
export type PackingListGenerateInput = z.infer<typeof PackingListGenerateInput>;

export const PackingListUpdateInput = z.object({
  trip_id: EntityId,
  add: z
    .array(
      z.object({
        name: NonEmpty,
        category: NonEmpty.optional(),
        quantity: z.number().int().positive().optional(),
        person_id: EntityId.optional(),
        notes: z.string().optional(),
      })
    )
    .optional(),
  update: z
    .array(
      z.object({
        item_id: EntityId,
        name: NonEmpty.optional(),
        category: NonEmpty.optional(),
        quantity: z.number().int().positive().optional(),
        checked: z.boolean().optional(),
        person_id: EntityId.nullable().optional(),
        notes: z.string().nullable().optional(),
      })
    )
    .optional(),
  remove: z.array(EntityId).optional().describe('Item ids to delete'),
  check_all: z.boolean().optional().describe('Mark every item checked (true) or unchecked (false)'),
});
export type PackingListUpdateInput = z.infer<typeof PackingListUpdateInput>;

// ---------------------------------------------------------------------------
// Transit sketch
// ---------------------------------------------------------------------------

export const TRANSIT_MODES = ['walk', 'bike', 'transit', 'rail', 'drive', 'taxi', 'rideshare', 'ferry', 'other'] as const;
export const TransitMode = z.enum(TRANSIT_MODES);
export type TransitMode = z.infer<typeof TransitMode>;

export const TransitSketchInput = z
  .object({
    trip_id: EntityId,
    date: IsoDate,
    from_place: NonEmpty,
    to_place: NonEmpty,
    depart_at: ClockTime.optional().describe('Leave at this time; mutually exclusive with arrive_by'),
    arrive_by: ClockTime.optional().describe('Must arrive by this time; mutually exclusive with depart_at'),
    modes: z.array(TransitMode).optional().describe('Mode hints to sketch; defaults to walk, transit, taxi'),
    distance_km: z.number().positive().optional().describe('Straight-line or route distance if known; enables duration estimates'),
    duration_minutes: z.number().int().positive().optional().describe('Known duration override (from a maps lookup you already did)'),
    add_to_day_plan: z
      .boolean()
      .optional()
      .describe('Persist the preferred option as a transit block on the day plan (requires a resolvable time window)'),
    notes: z.string().optional(),
  })
  .refine((v) => !(v.depart_at && v.arrive_by), {
    message: 'Provide depart_at or arrive_by, not both',
    path: ['arrive_by'],
  });
export type TransitSketchInput = z.infer<typeof TransitSketchInput>;

// ---------------------------------------------------------------------------
// Query & export
// ---------------------------------------------------------------------------

export const QUERY_ENTITY_TYPES = ['trip', 'people', 'flights', 'stays', 'days', 'blocks', 'packing'] as const;
export const QueryEntityType = z.enum(QUERY_ENTITY_TYPES);
export type QueryEntityType = z.infer<typeof QueryEntityType>;

export const QueryInput = z.object({
  trip_id: EntityId,
  entity_types: z
    .array(QueryEntityType)
    .optional()
    .describe('Which entity kinds to return; defaults to all'),
  from: IsoDate.optional().describe('Only entities touching dates on/after this'),
  to: IsoDate.optional().describe('Only entities touching dates on/before this'),
  person_id: EntityId.optional().describe('Only flights/stays/packing items involving this person'),
  text: z.string().optional().describe('Case-insensitive substring match on names, titles, places, notes, codes'),
  block_types: z.array(BlockType).optional().describe('Only day blocks of these types'),
});
export type QueryInput = z.infer<typeof QueryInput>;

export const ExportMarkdownInput = z.object({
  trip_id: EntityId,
  date: IsoDate.optional().describe('Export a single day instead of the whole trip'),
  include_packing: z.boolean().optional().describe('Include the packing list (trip export only). Default true.'),
});
export type ExportMarkdownInput = z.infer<typeof ExportMarkdownInput>;

export const ExportIcsInput = z.object({
  trip_id: EntityId,
  include: z
    .array(z.enum(['flights', 'stays', 'blocks']))
    .optional()
    .describe('Which entity kinds become VEVENTs; defaults to all three'),
  block_types: z.array(BlockType).optional().describe('Only day blocks of these types (e.g. skip "buffer")'),
});
export type ExportIcsInput = z.infer<typeof ExportIcsInput>;
