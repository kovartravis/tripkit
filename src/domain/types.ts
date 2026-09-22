import { z } from "zod";

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
    name: z.string().min(1),
    startDate: dateSchema,
    endDate: dateSchema,
    homeTimezone: z.string().min(1),
    notes: z.string().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: "endDate must be on or after startDate",
    path: ["endDate"],
  });
export type TripCreateInput = z.infer<typeof tripCreateInputSchema>;

export const tripUpdateInputSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  homeTimezone: z.string().min(1).optional(),
  notes: z.string().optional(),
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
  tripId: idSchema,
  name: z.string().min(1),
  email: z.email().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
});
export type PersonAddInput = z.infer<typeof personAddInputSchema>;

export const personUpdateInputSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  email: z.email().optional(),
  role: z.string().optional(),
  notes: z.string().optional(),
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
  departureAirport: z.string().min(3).max(4),
  arrivalAirport: z.string().min(3).max(4),
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

export const flightAddInputSchema = z.object({
  tripId: idSchema,
  airline: z.string().min(1),
  flightNumber: z.string().min(1),
  departureAirport: z.string().min(3).max(4),
  arrivalAirport: z.string().min(3).max(4),
  departureTime: dateTimeSchema,
  arrivalTime: dateTimeSchema,
  confirmation: z.string().optional(),
  seat: z.string().optional(),
  travelerIds: z.array(idSchema).optional(),
  notes: z.string().optional(),
});
export type FlightAddInput = z.infer<typeof flightAddInputSchema>;

export const flightUpdateInputSchema = z.object({
  id: idSchema,
  airline: z.string().min(1).optional(),
  flightNumber: z.string().min(1).optional(),
  departureAirport: z.string().min(3).max(4).optional(),
  arrivalAirport: z.string().min(3).max(4).optional(),
  departureTime: dateTimeSchema.optional(),
  arrivalTime: dateTimeSchema.optional(),
  confirmation: z.string().optional(),
  seat: z.string().optional(),
  travelerIds: z.array(idSchema).optional(),
  notes: z.string().optional(),
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

export const stayAddInputSchema = z.object({
  tripId: idSchema,
  name: z.string().min(1),
  checkIn: dateTimeSchema,
  checkOut: dateTimeSchema,
  address: z.string().optional(),
  confirmation: z.string().optional(),
  guestIds: z.array(idSchema).optional(),
  notes: z.string().optional(),
});
export type StayAddInput = z.infer<typeof stayAddInputSchema>;

export const stayUpdateInputSchema = z.object({
  id: idSchema,
  name: z.string().min(1).optional(),
  checkIn: dateTimeSchema.optional(),
  checkOut: dateTimeSchema.optional(),
  address: z.string().optional(),
  confirmation: z.string().optional(),
  guestIds: z.array(idSchema).optional(),
  notes: z.string().optional(),
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
    startTime: timeSchema,
    endTime: timeSchema,
    type: dayBlockTypeSchema,
    title: z.string().min(1),
    place: z.string().optional(),
    notes: z.string().optional(),
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
  tripId: idSchema,
  date: dateSchema,
  title: z.string().optional(),
  notes: z.string().optional(),
});
export type DayUpsertInput = z.infer<typeof dayUpsertInputSchema>;

export const dayPlanSetInputSchema = z.object({
  dayId: idSchema,
  blocks: z.array(dayBlockInputSchema),
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
  tripId: idSchema,
  climateHints: z.array(climateHintSchema).min(1).default(["mild"]),
  activityHints: z.array(z.string()).optional(),
  replaceExisting: z.boolean().default(false),
});
export type PackingListGenerateInput = z.infer<
  typeof packingListGenerateInputSchema
>;

export const packingListUpdateInputSchema = z.object({
  tripId: idSchema,
  upserts: z
    .array(
      z.object({
        id: idSchema.optional(),
        category: z.string().min(1).optional(),
        label: z.string().min(1),
        quantity: z.number().int().positive().optional(),
        packed: z.boolean().optional(),
        notes: z.string().optional(),
      }),
    )
    .default([]),
  removeIds: z.array(idSchema).default([]),
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
  fromPlace: z.string().min(1),
  toPlace: z.string().min(1),
  departTime: timeSchema.optional(),
  modeHint: transitModeSchema.optional(),
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
 * Place lookup (geocoding, not persisted)
 */
export const placeLookupInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(5).optional(),
});
export type PlaceLookupInput = z.infer<typeof placeLookupInputSchema>;

export const placeCandidateSchema = z.object({
  displayName: z.string(),
  address: z.string(),
  lat: z.number(),
  lon: z.number(),
  mapsUrl: z.string(),
});
export type PlaceCandidate = z.infer<typeof placeCandidateSchema>;

/**
 * Invite
 */
export const inviteStatusSchema = z.enum(["pending", "accepted", "revoked"]);
export type InviteStatus = z.infer<typeof inviteStatusSchema>;

export const inviteSchema = z.object({
  id: idSchema,
  tripId: idSchema,
  email: z.email(),
  invitedByAccountId: idSchema,
  status: inviteStatusSchema,
  acceptedAccountId: idSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Invite = z.infer<typeof inviteSchema>;

export const inviteCreateInputSchema = z.object({
  tripId: idSchema,
  email: z.email(),
});
export type InviteCreateInput = z.infer<typeof inviteCreateInputSchema>;

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
  tripId: idSchema,
  entityTypes: z.array(queryEntityTypeSchema).min(1),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  personId: idSchema.optional(),
});
export type QueryInput = z.infer<typeof queryInputSchema>;
