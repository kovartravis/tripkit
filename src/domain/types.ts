import { z } from "zod";
import { isIanaTimeZone } from "./validation.js";

/**
 * Shared primitives
 */

// Calendar date, e.g. "2026-04-12"
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// Full timestamp with offset, e.g. "2026-04-12T14:30:00-07:00" or "...Z"
export const dateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})$/,
    "expected ISO 8601 datetime with timezone offset, e.g. 2026-04-12T14:30:00-07:00",
  );

// Local clock time within a single day, e.g. "09:30"
export const timeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "expected HH:MM 24h time");

export const idSchema = z.string().min(1);

export const timezoneSchema = z
  .string()
  .min(1)
  .refine(isIanaTimeZone, {
    message: "expected IANA timezone name, e.g. America/Los_Angeles",
  });

export const airportCodeSchema = z
  .string()
  .regex(/^[A-Za-z]{3,4}$/, "expected 3–4 letter IATA/ICAO airport code");

export const dayBlockTypeSchema = z.enum([
  "activity",
  "meal",
  "transit",
  "buffer",
  "other",
]);
export type DayBlockType = z.infer<typeof dayBlockTypeSchema>;

/**
 * Trip
 */
export const tripSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  startDate: dateSchema,
  endDate: dateSchema,
  homeTimezone: z.string().min(1),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Trip = z.infer<typeof tripSchema>;

export const tripCreateInputSchema = z
  .object({
    name: z.string().min(1).describe("Trip name"),
    startDate: dateSchema.describe("Start date (YYYY-MM-DD)"),
    endDate: dateSchema.describe("End date (YYYY-MM-DD), on or after startDate"),
    homeTimezone: timezoneSchema.describe("Home IANA timezone, e.g. America/Los_Angeles"),
    notes: z.string().optional().describe("Free-text notes"),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type TripCreateInput = z.infer<typeof tripCreateInputSchema>;

export const tripUpdateInputSchema = z.object({
  id: idSchema.describe("Trip id"),
  name: z.string().min(1).optional().describe("Trip name"),
  startDate: dateSchema.optional().describe("Start date (YYYY-MM-DD)"),
  endDate: dateSchema.optional().describe("End date (YYYY-MM-DD)"),
  homeTimezone: timezoneSchema.optional().describe("Home IANA timezone"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type TripUpdateInput = z.infer<typeof tripUpdateInputSchema>;

/**
 * Person
 */
export const personSchema = z.object({
  id: idSchema,
  tripId: idSchema,
  name: z.string().min(1),
  email: z.email().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Person = z.infer<typeof personSchema>;

export const personAddInputSchema = z.object({
  tripId: idSchema.describe("Trip to add the traveler to"),
  name: z.string().min(1).describe("Traveler name"),
  email: z.email().optional().describe("Email address"),
  role: z.string().optional().describe("Free-text role, e.g. organizer"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type PersonAddInput = z.infer<typeof personAddInputSchema>;

export const personUpdateInputSchema = z.object({
  id: idSchema.describe("Person id"),
  name: z.string().min(1).optional().describe("Traveler name"),
  email: z.email().optional().describe("Email address"),
  role: z.string().optional().describe("Free-text role"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type PersonUpdateInput = z.infer<typeof personUpdateInputSchema>;

/**
 * Flight
 */
export const flightSchema = z.object({
  id: idSchema,
  tripId: idSchema,
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  departureAirport: airportCodeSchema,
  arrivalAirport: airportCodeSchema,
  departureTime: dateTimeSchema,
  arrivalTime: dateTimeSchema,
  confirmation: z.string().optional(),
  seat: z.string().optional(),
  travelerIds: z.array(idSchema).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Flight = z.infer<typeof flightSchema>;

export const flightAddInputSchema = z
  .object({
    tripId: idSchema.describe("Trip to add the flight to"),
    airline: z.string().min(1).describe("Airline name or IATA code"),
    flightNumber: z.string().min(1).describe("Flight number, e.g. NH7"),
    departureAirport: airportCodeSchema.describe("Departure airport code"),
    arrivalAirport: airportCodeSchema.describe("Arrival airport code"),
    departureTime: dateTimeSchema.describe("Departure time with UTC offset"),
    arrivalTime: dateTimeSchema.describe("Arrival time with UTC offset"),
    confirmation: z.string().optional().describe("Booking confirmation code you already have"),
    seat: z.string().optional().describe("Seat assignment"),
    travelerIds: z.array(idSchema).optional().describe("Person ids on this flight"),
    notes: z.string().optional().describe("Free-text notes"),
  })
  .refine((v) => new Date(v.arrivalTime).getTime() > new Date(v.departureTime).getTime(), {
    message: "arrivalTime must be after departureTime",
    path: ["arrivalTime"],
  });
export type FlightAddInput = z.infer<typeof flightAddInputSchema>;

export const flightUpdateInputSchema = z.object({
  id: idSchema.describe("Flight id"),
  airline: z.string().min(1).optional().describe("Airline name or IATA code"),
  flightNumber: z.string().min(1).optional().describe("Flight number"),
  departureAirport: airportCodeSchema.optional().describe("Departure airport code"),
  arrivalAirport: airportCodeSchema.optional().describe("Arrival airport code"),
  departureTime: dateTimeSchema.optional().describe("Departure time with UTC offset"),
  arrivalTime: dateTimeSchema.optional().describe("Arrival time with UTC offset"),
  confirmation: z.string().optional().describe("Booking confirmation code you already have"),
  seat: z.string().optional().describe("Seat assignment"),
  travelerIds: z.array(idSchema).optional().describe("Person ids on this flight"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type FlightUpdateInput = z.infer<typeof flightUpdateInputSchema>;

/**
 * Stay
 */
export const staySchema = z.object({
  id: idSchema,
  tripId: idSchema,
  name: z.string().min(1),
  checkIn: dateTimeSchema,
  checkOut: dateTimeSchema,
  address: z.string().optional(),
  confirmation: z.string().optional(),
  guestIds: z.array(idSchema).default([]),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Stay = z.infer<typeof staySchema>;

export const stayAddInputSchema = z
  .object({
    tripId: idSchema.describe("Trip to add the stay to"),
    name: z.string().min(1).describe("Property / lodging name"),
    checkIn: dateTimeSchema.describe("Check-in time with UTC offset"),
    checkOut: dateTimeSchema.describe("Check-out time with UTC offset"),
    address: z.string().optional().describe("Street address"),
    confirmation: z.string().optional().describe("Booking confirmation code you already have"),
    guestIds: z.array(idSchema).optional().describe("Person ids staying here"),
    notes: z.string().optional().describe("Free-text notes"),
  })
  .refine((v) => new Date(v.checkOut).getTime() > new Date(v.checkIn).getTime(), {
    message: "checkOut must be after checkIn",
    path: ["checkOut"],
  });
export type StayAddInput = z.infer<typeof stayAddInputSchema>;

export const stayUpdateInputSchema = z.object({
  id: idSchema.describe("Stay id"),
  name: z.string().min(1).optional().describe("Property / lodging name"),
  checkIn: dateTimeSchema.optional().describe("Check-in time with UTC offset"),
  checkOut: dateTimeSchema.optional().describe("Check-out time with UTC offset"),
  address: z.string().optional().describe("Street address"),
  confirmation: z.string().optional().describe("Booking confirmation code you already have"),
  guestIds: z.array(idSchema).optional().describe("Person ids staying here"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type StayUpdateInput = z.infer<typeof stayUpdateInputSchema>;

/**
 * Day + day plan blocks
 */
export const dayBlockSchema = z.object({
  id: idSchema,
  dayId: idSchema,
  order: z.number().int().nonnegative(),
  startTime: timeSchema,
  endTime: timeSchema,
  type: dayBlockTypeSchema,
  title: z.string().min(1),
  place: z.string().optional(),
  notes: z.string().optional(),
});
export type DayBlock = z.infer<typeof dayBlockSchema>;

export const dayBlockInputSchema = z
  .object({
    startTime: timeSchema.describe("Block start (HH:MM, 24h local clock)"),
    endTime: timeSchema.describe("Block end (HH:MM, 24h local clock); must be after startTime"),
    type: dayBlockTypeSchema.describe("activity | meal | transit | buffer | other"),
    title: z.string().min(1).describe("Short label for the block"),
    place: z.string().optional().describe("Place name"),
    notes: z.string().optional().describe("Free-text notes"),
  })
  .refine((v) => v.endTime > v.startTime, {
    message: "endTime must be after startTime",
    path: ["endTime"],
  });
export type DayBlockInput = z.infer<typeof dayBlockInputSchema>;

export const daySchema = z.object({
  id: idSchema,
  tripId: idSchema,
  date: dateSchema,
  title: z.string().optional(),
  notes: z.string().optional(),
  blocks: z.array(dayBlockSchema).default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Day = z.infer<typeof daySchema>;

export const dayUpsertInputSchema = z.object({
  tripId: idSchema.describe("Trip this day belongs to"),
  date: dateSchema.describe("Calendar date (YYYY-MM-DD)"),
  title: z.string().optional().describe("Optional day title"),
  notes: z.string().optional().describe("Free-text notes"),
});
export type DayUpsertInput = z.infer<typeof dayUpsertInputSchema>;

export const dayPlanSetInputSchema = z.object({
  dayId: idSchema.describe("Day id to replace the plan on"),
  blocks: z
    .array(dayBlockInputSchema)
    .describe("Replacement plan; overlapping blocks are rejected"),
});
export type DayPlanSetInput = z.infer<typeof dayPlanSetInputSchema>;

/**
 * Packing
 */
export const packingItemSchema = z.object({
  id: idSchema,
  tripId: idSchema,
  category: z.string().min(1),
  label: z.string().min(1),
  quantity: z.number().int().positive(),
  packed: z.boolean(),
  notes: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PackingItem = z.infer<typeof packingItemSchema>;

export const climateHintSchema = z.enum([
  "cold",
  "mild",
  "hot",
  "rainy",
  "mixed",
]);
export type ClimateHint = z.infer<typeof climateHintSchema>;

export const packingListGenerateInputSchema = z.object({
  tripId: idSchema.describe("Trip to generate a packing list for"),
  climateHints: z
    .array(climateHintSchema)
    .min(1)
    .default(["mild"])
    .describe("Climate hints: cold | mild | hot | rainy | mixed"),
  activityHints: z
    .array(z.string())
    .optional()
    .describe("Activity hints, e.g. hiking, swimming, business, formal, camping"),
  replaceExisting: z
    .boolean()
    .default(false)
    .describe("If true, wipe the existing list; if false, merge without clobbering checkoffs"),
});
export type PackingListGenerateInput = z.infer<
  typeof packingListGenerateInputSchema
>;

export const packingListUpdateInputSchema = z.object({
  tripId: idSchema.describe("Trip whose packing list to edit"),
  upserts: z
    .array(
      z.object({
        id: idSchema.optional().describe("Existing item id; omit to insert"),
        category: z.string().min(1).optional().describe("Category, e.g. clothing"),
        label: z.string().min(1).describe("Item label"),
        quantity: z.number().int().positive().optional().describe("Quantity"),
        packed: z.boolean().optional().describe("Checkoff state"),
        notes: z.string().optional().describe("Free-text notes"),
      }),
    )
    .default([])
    .describe("Items to insert or update"),
  removeIds: z.array(idSchema).default([]).describe("Item ids to delete"),
});
export type PackingListUpdateInput = z.infer<
  typeof packingListUpdateInputSchema
>;

/**
 * Transit sketch (computed, not persisted)
 */
export const transitModeSchema = z.enum([
  "walk",
  "drive",
  "taxi",
  "rideshare",
  "transit",
  "train",
  "bike",
  "unknown",
]);
export type TransitMode = z.infer<typeof transitModeSchema>;

export const transitSketchInputSchema = z.object({
  fromPlace: z.string().min(1).describe("Starting place"),
  toPlace: z.string().min(1).describe("Destination place"),
  departTime: timeSchema.optional().describe("Optional HH:MM depart time used to compute arriveTime"),
  modeHint: transitModeSchema
    .optional()
    .describe("walk | drive | taxi | rideshare | transit | train | bike | unknown"),
});
export type TransitSketchInput = z.infer<typeof transitSketchInputSchema>;

export const transitSketchSchema = z.object({
  fromPlace: z.string(),
  toPlace: z.string(),
  mode: transitModeSchema,
  departTime: timeSchema.optional(),
  estimatedDurationMinutes: z.number().int().positive(),
  arriveTime: timeSchema.optional(),
  notes: z.string(),
});
export type TransitSketch = z.infer<typeof transitSketchSchema>;

/**
 * Query
 */
export const queryEntityTypeSchema = z.enum([
  "trip",
  "person",
  "flight",
  "stay",
  "day",
  "packingItem",
]);
export type QueryEntityType = z.infer<typeof queryEntityTypeSchema>;

export const queryInputSchema = z.object({
  tripId: idSchema.describe("Trip to query"),
  entityTypes: z
    .array(queryEntityTypeSchema)
    .min(1)
    .describe("Entity types to include: trip | person | flight | stay | day | packingItem"),
  startDate: dateSchema.optional().describe("Inclusive lower bound (YYYY-MM-DD)"),
  endDate: dateSchema.optional().describe("Inclusive upper bound (YYYY-MM-DD)"),
  personId: idSchema.optional().describe("Filter people/flights/stays to this person"),
});
export type QueryInput = z.infer<typeof queryInputSchema>;
