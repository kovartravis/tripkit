# Tripkit

**A shared trip ledger, exposed as MCP tools.**

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
real database, so trip state survives across sessions, tools, and people.

## What Tripkit is / isn't

**Owns (v1):**
- A trip ledger, shared per-Trip across Accounts: trips, flights, stays, days, people
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

**Deploy path:** hosted on Supabase (Postgres + Auth) — every Account reads
and writes through MCP, authenticated per-request via their own Supabase
identity, with Row Level Security enforcing that a Member only ever sees
Trips they belong to. There is no local-only or account-free mode (ADR
0004): storage sits behind a `TripkitRepository` interface, but the only
implementation is `SupabaseTripkitRepository`.

## Install

Requires **Node.js >= 22**.

```bash
npm install -g @kovartravis/tripkit
```

Or run it without installing, via `npx`:

```bash
npx @kovartravis/tripkit mcp
```

## Quickstart

Tripkit needs a Supabase project (Postgres + Auth, with Dynamic Client
Registration enabled and the schema in `supabase/migrations/` applied) and
a Supabase Account of your own before it can do anything. Set these env
vars:

```bash
export TRIPKIT_SUPABASE_URL=https://<ref>.supabase.co
export TRIPKIT_SUPABASE_ACCESS_TOKEN=<your own Supabase session access token>
export SUPABASE_SERVICE_ROLE_KEY=<the project's service_role key>
export SUPABASE_DB_HOST=<pooler host>
export SUPABASE_DB_USER=<pooler user>
export SUPABASE_DB_PASSWORD=<pooler password>
```

### Connect it as an MCP server

Tripkit speaks MCP over stdio, authenticated for the whole session as
whichever Account `TRIPKIT_SUPABASE_ACCESS_TOKEN` belongs to. Point any
MCP-capable client at it — for example, in Claude Desktop's
`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "tripkit": {
      "command": "npx",
      "args": ["-y", "@kovartravis/tripkit", "mcp"],
      "env": {
        "TRIPKIT_SUPABASE_URL": "https://<ref>.supabase.co",
        "TRIPKIT_SUPABASE_ACCESS_TOKEN": "...",
        "SUPABASE_SERVICE_ROLE_KEY": "...",
        "SUPABASE_DB_HOST": "...",
        "SUPABASE_DB_USER": "...",
        "SUPABASE_DB_PASSWORD": "..."
      }
    }
  }
}
```

Or run it directly:

```bash
tripkit mcp
```

For a shared, always-on deployment reachable by multiple Members (Owner
and Companions alike, each through their own agent), run it over HTTP
instead — see `tripkit --help` for `--http`'s flags. Each request
authenticates against Supabase's own OAuth 2.1 server (dynamic client
registration + PKCE); Tripkit is only ever the resource server.

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
| `tripkit_invite_create` | Invite a Companion by email to join a trip you own |

## CLI

```
tripkit mcp              Start the Tripkit MCP server on stdio
tripkit mcp --http ...   Serve MCP over HTTP, plus a read-only dashboard at /ui
tripkit --help           Full flag/env var reference
```

## Storage

Data lives in Supabase Postgres. Trips, people, flights, stays, days, day
blocks, packing items, and invites each get their own table, with foreign
keys cascading from trips. All access goes through the `TripkitRepository`
interface (`src/db/repository.ts`), implemented by
`SupabaseTripkitRepository` (`src/db/postgres/`), which forwards each
caller's verified JWT into a per-request Postgres transaction so Row Level
Security — not application code — is what actually enforces that a Member
only reads or writes Trips they belong to.

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
