# Tripkit

**A local-first trip ledger, exposed as MCP tools.**

Tripkit is a Neuron-class OSS MCP server: it does not plan your trip or
hold a conversation with you. Your personal agent (Claude, or any
MCP-capable assistant) keeps that role. Tripkit is the **tool surface**
underneath it — a small, structured ledger of trips, flights, stays, day
plans, people, and packing lists that an agent can read and write reliably,
without re-parsing free text or losing state between sessions.

## The problem

Ask an AI agent to help plan a trip and it will happily produce an
itinerary — as unstructured prose, gone the moment the conversation ends or
you switch tools. There's nowhere for "the flight confirmation number,"
"who's staying at which hotel," or "what's actually in the 2pm slot on
Tuesday" to live in a form the agent can reliably re-read, update, and
export later. Tripkit gives agents a small set of typed tools backed by a
real local database, so trip state survives across sessions and tools.

## What Tripkit is / isn't

**Owns (v1):**
- A local-first trip ledger: trips, flights, stays, days, people
- MCP tools to add/update/query those entities
- Constrained day plans (time-boxed blocks that can't overlap), packing
  lists, and rough transit sketches
- Markdown and ICS (calendar) export

**Does not own (v1):**
- Being the chat planner itself — that's your agent's job, not Tripkit's
- Full airline/hotel booking or checkout — Tripkit stores confirmation
  numbers you already have; it doesn't buy anything
- Live routing, pricing, or availability APIs — transit sketches are
  deterministic placeholder estimates, not real quotes

**Deploy path:** local-first today — an stdio MCP server plus a CLI, backed
by a SQLite file on disk. Storage sits behind a `TripkitRepository`
interface so a hosted backend can be added later, once there's reason to;
that's a deliberate non-goal for this release, not an oversight.

## Install

Requires **Node.js >= 22** (Tripkit uses the built-in `node:sqlite` module,
so there's no native dependency to compile).

```bash
npm install -g @kovartravis/tripkit
```

Or run it without installing, via `npx`:

```bash
npx @kovartravis/tripkit mcp
```

## Quickstart

Initialize a local data directory in your project (optional — Tripkit falls
back to a per-user data directory if you skip this):

```bash
npx tripkit init
```

Check where your data lives:

```bash
npx tripkit status
```

### Connect it as an MCP server

Tripkit speaks MCP over stdio. Point any MCP-capable client at it — for
example, in Claude Desktop's `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tripkit": {
      "command": "npx",
      "args": ["-y", "@kovartravis/tripkit", "mcp"]
    }
  }
}
```

Or run it directly:

```bash
tripkit mcp
```

Once connected, your agent can call tools like `tripkit_trip_create`,
`tripkit_flight_add`, and `tripkit_day_plan_set` to build up a trip, then
`tripkit_export_markdown` or `tripkit_export_ics` to hand you something
readable.

## Tools

All 14 tools are prefixed `tripkit_`. Full parameter and return-value
reference: [`docs/TOOLS.md`](docs/TOOLS.md).

| Tool | Purpose |
|---|---|
| `tripkit_trip_create` | Create a trip (name, dates, home timezone, notes) |
| `tripkit_trip_update` | Update trip fields |
| `tripkit_trip_get` | Get one trip |
| `tripkit_trip_list` | List all trips |
| `tripkit_person_add` | Add a traveler to a trip |
| `tripkit_person_update` | Update a traveler |
| `tripkit_person_list` | List travelers on a trip |
| `tripkit_flight_add` | Add a flight (airline, times, confirmation, seat, travelers) |
| `tripkit_flight_update` | Update a flight |
| `tripkit_flight_list` | List a trip's flights |
| `tripkit_stay_add` | Add lodging (check-in/out, address, confirmation, guests) |
| `tripkit_stay_update` | Update a stay |
| `tripkit_stay_list` | List a trip's stays |
| `tripkit_day_upsert` | Create/update a calendar day on a trip |
| `tripkit_day_plan_set` | Set a day's plan as ordered, non-overlapping time blocks |
| `tripkit_day_get` | Get one day (with its plan) |
| `tripkit_day_list` | List a trip's days (with plans) |
| `tripkit_packing_list_generate` | Generate a packing list from trip length, travelers, and climate hints |
| `tripkit_packing_list_update` | Check off, edit, add, or remove packing items |
| `tripkit_transit_sketch` | Rough transit-leg estimate between two places (no live routing) |
| `tripkit_query` | Structured filtered query over a trip's ledger |
| `tripkit_export_markdown` | Export a trip or single day as markdown |
| `tripkit_export_ics` | Export flights/stays/day blocks as an ICS calendar |

## CLI

```
tripkit mcp       Start the Tripkit MCP server on stdio
tripkit init      Initialize a local .tripkit/ data directory in this folder
tripkit status    Show where Tripkit's data lives and a quick summary
```

## Storage

Data lives in a SQLite file — either `.tripkit/tripkit.db` in the current
project (after `tripkit init`), or a per-user data directory shared across
projects if you haven't initialized one locally. Trips, people, flights,
stays, days, day blocks, and packing items each get their own table, with
foreign keys cascading from trips. All access goes through the
`TripkitRepository` interface (`src/db/repository.ts`), so the storage
layer can be swapped — for a hosted backend, say — without touching the MCP
tool code.

## Development

```bash
git clone https://github.com/kovartravis/tripkit.git
cd tripkit
npm install
npm run build
npm test
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for project layout and contribution
guidelines, and [CHANGELOG.md](CHANGELOG.md) for release notes.

## License

[MIT](LICENSE)
