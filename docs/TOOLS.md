# Tripkit MCP Tools

All tools are exposed by `tripkit mcp` over stdio. Inputs are validated with
[zod](https://zod.dev); malformed calls return an MCP tool error rather than
crashing the server. Timestamps use ISO 8601 with a UTC offset
(`2026-04-12T14:30:00-07:00`); calendar dates use `YYYY-MM-DD`; day-plan
block times use local 24h clock time (`HH:MM`, no date/offset — they're
implicitly scoped to their day).

Every entity carries a generated `id` (e.g. `trip_<uuid>`), `createdAt`, and
`updatedAt`. Fields not listed as required are optional.

---

## Trips & people

### `tripkit_trip_create`

Create a trip.

| Param | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | |
| `startDate` | date | yes | |
| `endDate` | date | yes | must be `>= startDate` |
| `homeTimezone` | string | yes | IANA timezone name, e.g. `America/Los_Angeles` |
| `notes` | string | no | |

**Returns:** the created `Trip`.

### `tripkit_trip_update`

Update fields on an existing trip.

| Param | Type | Required |
|---|---|---|
| `id` | string | yes |
| `name`, `startDate`, `endDate`, `homeTimezone`, `notes` | — | no (partial update) |

**Returns:** the updated `Trip`.

### `tripkit_trip_get`

| Param | Type | Required |
|---|---|---|
| `id` | string | yes |

**Returns:** the `Trip`. Errors if not found.

### `tripkit_trip_list`

No params. **Returns:** `Trip[]`, ordered by `startDate`.

### `tripkit_person_add`

Add a traveler to a trip.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `name` | string | yes | |
| `email` | string | no | must be a valid email if present |
| `role` | string | no | free text, e.g. "organizer" |
| `notes` | string | no | |

**Returns:** the created `Person`.

### `tripkit_person_update`

| Param | Type | Required |
|---|---|---|
| `id` | string | yes |
| `name`, `email`, `role`, `notes` | — | no (partial update) |

**Returns:** the updated `Person`.

### `tripkit_person_list`

| Param | Type | Required |
|---|---|---|
| `tripId` | string | yes |

**Returns:** `Person[]` for the trip.

---

## Flights & stays

### `tripkit_flight_add`

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `airline` | string | yes | |
| `flightNumber` | string | yes | |
| `departureAirport` | string | yes | 3–4 letter IATA/ICAO code; upcased on save |
| `arrivalAirport` | string | yes | 3–4 letter IATA/ICAO code; upcased on save |
| `departureTime` | datetime | yes | with UTC offset |
| `arrivalTime` | datetime | yes | with UTC offset |
| `confirmation` | string | no | |
| `seat` | string | no | |
| `travelerIds` | string[] | no | `Person` ids on this flight |
| `notes` | string | no | |

**Returns:** the created `Flight`.

### `tripkit_flight_update`

| Param | Type | Required |
|---|---|---|
| `id` | string | yes |
| all other `tripkit_flight_add` fields except `tripId` | — | no (partial update) |

**Returns:** the updated `Flight`.

### `tripkit_flight_list`

| Param | Type | Required |
|---|---|---|
| `tripId` | string | yes |

**Returns:** `Flight[]`, ordered by `departureTime`.

### `tripkit_stay_add`

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `name` | string | yes | property/lodging name |
| `checkIn` | datetime | yes | with UTC offset |
| `checkOut` | datetime | yes | with UTC offset |
| `address` | string | no | |
| `confirmation` | string | no | |
| `guestIds` | string[] | no | `Person` ids staying here |
| `notes` | string | no | |

**Returns:** the created `Stay`.

### `tripkit_stay_update`

| Param | Type | Required |
|---|---|---|
| `id` | string | yes |
| all other `tripkit_stay_add` fields except `tripId` | — | no (partial update) |

**Returns:** the updated `Stay`.

### `tripkit_stay_list`

| Param | Type | Required |
|---|---|---|
| `tripId` | string | yes |

**Returns:** `Stay[]`, ordered by `checkIn`.

---

## Days & plans

### `tripkit_day_upsert`

Create or update a day. Idempotent on `(tripId, date)` — calling it twice
for the same date updates the existing day rather than creating a duplicate.

| Param | Type | Required |
|---|---|---|
| `tripId` | string | yes |
| `date` | date | yes |
| `title` | string | no |
| `notes` | string | no |

**Returns:** the `Day` (without needing a separate plan call).

### `tripkit_day_plan_set`

Replace a day's plan with an ordered list of time-boxed blocks. **The whole
block list is replaced** — this is not an incremental add. Blocks are
re-sorted by `startTime` and checked for overlaps; if any two blocks
overlap, the call fails with an error and the day's plan is left unchanged.

| Param | Type | Required |
|---|---|---|
| `dayId` | string | yes |
| `blocks` | array | yes | see below |

Each block:

| Field | Type | Required | Notes |
|---|---|---|---|
| `startTime` | time (`HH:MM`) | yes | |
| `endTime` | time (`HH:MM`) | yes | must be after `startTime` |
| `type` | enum | yes | `activity` \| `meal` \| `transit` \| `buffer` \| `other` |
| `title` | string | yes | |
| `place` | string | no | |
| `notes` | string | no | |

**Returns:** the `Day` with its new `blocks`. **Errors:** `OverlappingBlocksError` if two blocks overlap.

### `tripkit_day_get`

Fetch by `id`, or by `tripId` + `date`.

| Param | Type | Required |
|---|---|---|
| `id` | string | one of `id` or (`tripId` + `date`) |
| `tripId` | string | " |
| `date` | date | " |

**Returns:** the `Day` (with `blocks`). Errors if not found.

### `tripkit_day_list`

| Param | Type | Required |
|---|---|---|
| `tripId` | string | yes |
| `startDate` | date | no | inclusive lower bound |
| `endDate` | date | no | inclusive upper bound |

**Returns:** `Day[]` (each with `blocks`), ordered by `date`.

---

## Packing & transit

### `tripkit_packing_list_generate`

Generates packing items from deterministic v1 rules: fixed base items
(documents, charger, toiletries), items per climate hint, items per activity
hint, and clothing quantities (underwear/socks/tops) scaled by trip length
and traveler count (capped at 10 for long trips).

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `climateHints` | enum[] | yes (defaults to `["mild"]`) | `cold` \| `mild` \| `hot` \| `rainy` \| `mixed` |
| `activityHints` | string[] | no | e.g. `["hiking", "swimming", "business", "formal", "camping"]` |
| `replaceExisting` | boolean | no (default `false`) | `false` merges generated items into the existing list without touching `packed` state on items that already exist; `true` wipes and regenerates |

**Returns:** `PackingItem[]` for the trip after generation.

### `tripkit_packing_list_update`

Check off, edit, add, or remove packing items.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `upserts` | array | no | items with an `id` are updated; items without one are inserted |
| `removeIds` | string[] | no | item ids to delete |

Each `upserts` entry:

| Field | Type | Required |
|---|---|---|
| `id` | string | no (omit to insert) |
| `category` | string | no |
| `label` | string | yes |
| `quantity` | integer > 0 | no |
| `packed` | boolean | no |
| `notes` | string | no |

**Returns:** `PackingItem[]` for the trip after applying changes.

### `tripkit_transit_sketch`

Computes a rough transit-leg estimate. **Not persisted** — it's a pure
calculation; feed the result into `tripkit_day_plan_set` as a `transit`
block if you want it on the ledger. No live routing or booking API is called
in v1; durations are placeholder estimates by mode.

| Param | Type | Required | Notes |
|---|---|---|---|
| `fromPlace` | string | yes | |
| `toPlace` | string | yes | |
| `departTime` | time (`HH:MM`) | no | used to compute `arriveTime` |
| `modeHint` | enum | no | `walk` \| `drive` \| `taxi` \| `rideshare` \| `transit` \| `train` \| `bike` \| `unknown`; inferred from place names if omitted |

**Returns:** `{ fromPlace, toPlace, mode, departTime?, estimatedDurationMinutes, arriveTime?, notes }`.

---

## Invites

Only registered when running against Supabase (a `SupabaseInviteService` was passed to
`createTripkitMcpServer`) — not available in local/SQLite mode. As of this writing,
`httpServer.ts` doesn't construct or pass one yet (ticket #23 wires that up as part of
retiring SQLite entirely); this tool and automatic redemption are functional but not yet
reachable through the running server.

### `tripkit_invite_create`

Invite someone by email to join a trip you own. Callable only by the trip's Owner. If the
email already has a Supabase Account, no duplicate account is created — either way, the
invited Account is granted `trip_members` access automatically the next time they
authenticate, no explicit accept step.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | must be a trip you own |
| `email` | string | yes | |

**Returns:** the created `Invite` (`status: "pending"`).

---

## Query & export

### `tripkit_query`

Structured filter over a trip's ledger.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `entityTypes` | enum[] | yes | any of `trip`, `person`, `flight`, `stay`, `day`, `packingItem` |
| `startDate` | date | no | filters flights (by departure date), stays (by stay window), and days |
| `endDate` | date | no | " |
| `personId` | string | no | filters people, flights (by traveler), and stays (by guest) |

**Returns:** `{ trip?, people?, flights?, stays?, days?, packingItems? }` — only the requested `entityTypes` are populated.

### `tripkit_export_markdown`

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `dayId` | string | no | scope the export to a single day instead of the whole trip |

**Returns:** `{ markdown: string }`.

### `tripkit_export_ics`

Exports an RFC 5545 calendar. Flight and stay times carry a UTC offset and
are emitted in UTC; day-plan block times are local clock times with no
offset, so they're emitted as floating time on their day.

| Param | Type | Required | Notes |
|---|---|---|---|
| `tripId` | string | yes | |
| `dayId` | string | no | scope to one day's blocks instead of all flights/stays/blocks |

**Returns:** `{ ics: string }`.
