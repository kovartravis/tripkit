/** Locked v1 MCP tool surface. Names are the wire names agents call. */
export const TRIPKIT_TOOL_NAMES = [
  "tripkit_trip_create",
  "tripkit_trip_update",
  "tripkit_trip_get",
  "tripkit_trip_list",
  "tripkit_person_add",
  "tripkit_person_update",
  "tripkit_person_list",
  "tripkit_flight_add",
  "tripkit_flight_update",
  "tripkit_flight_list",
  "tripkit_stay_add",
  "tripkit_stay_update",
  "tripkit_stay_list",
  "tripkit_day_upsert",
  "tripkit_day_plan_set",
  "tripkit_day_get",
  "tripkit_day_list",
  "tripkit_packing_list_generate",
  "tripkit_packing_list_update",
  "tripkit_transit_sketch",
  "tripkit_query",
  "tripkit_export_markdown",
  "tripkit_export_ics",
] as const;

export type TripkitToolName = (typeof TRIPKIT_TOOL_NAMES)[number];
