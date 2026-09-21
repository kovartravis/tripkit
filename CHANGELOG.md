# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffold of Tripkit: a local-first trip ledger (trips, people,
  flights, stays, days, day plans, packing lists) backed by SQLite via
  `node:sqlite`.
- 14 MCP tools (`tripkit_trip_create` through `tripkit_export_ics`) exposed
  over an stdio MCP server built on `@modelcontextprotocol/sdk`.
- Constrained day plans that reject overlapping time blocks.
- Deterministic packing list generation from trip length, traveler count,
  and climate/activity hints.
- Transit leg sketches (placeholder duration estimates, no live routing).
- Markdown and ICS export for trips and individual days.
- CLI: `tripkit mcp`, `tripkit init`, `tripkit status`.
- Repository interface (`TripkitRepository`) decoupling MCP tools from
  storage, so a hosted backend can be added later without touching tool code.
