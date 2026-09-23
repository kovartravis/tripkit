# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Tripkit's trip ledger (trips, people, flights, stays, days, day plans,
  packing lists) hosted on Supabase (Postgres + Auth), shared across
  multiple Accounts and enforced per-Trip by Row Level Security.
- MCP tools (`tripkit_trip_create` through `tripkit_export_ics`, plus
  `tripkit_invite_create`) exposed over stdio or HTTP, built on
  `@modelcontextprotocol/sdk`.
- Constrained day plans that reject overlapping time blocks.
- Deterministic packing list generation from trip length, traveler count,
  and climate/activity hints.
- Transit leg sketches (placeholder duration estimates, no live routing).
- Markdown and ICS export for trips and individual days.
- A read-only day-by-day itinerary dashboard (`/ui`), Account-scoped via
  Supabase's own hosted login.
- CLI: `tripkit mcp` (stdio or `--http`).
- Repository interface (`TripkitRepository`) decoupling MCP tools from
  storage, implemented by `SupabaseTripkitRepository`.

### Removed

- The original local-first, account-free mode (`SqliteTripkitRepository`,
  the `.tripkit/` data-directory model, `tripkit init`/`tripkit status`,
  and the owner-passphrase auth path) — every path now requires a
  Supabase Account (ADR 0004). Never released as a standalone version, so
  this is folded into Added above rather than kept as a separate history.
