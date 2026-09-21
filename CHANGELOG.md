# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffold of Tripkit: a local-first trip ledger (trips, people,
  flights, stays, days, day plans, packing lists) backed by SQLite via
  `node:sqlite`.
- MCP tools (`tripkit_trip_create` through `tripkit_export_ics`) exposed
  over an stdio MCP server built on `@modelcontextprotocol/sdk`.
- Constrained day plans that reject overlapping time blocks.
- Deterministic packing list generation from trip length, traveler count,
  and climate/activity hints.
- Transit leg sketches (placeholder duration estimates, no live routing).
- Markdown and ICS export for trips and individual days.
- CLI: `tripkit mcp`, `tripkit init`, `tripkit status`.
- Repository interface (`TripkitRepository`) decoupling MCP tools from
  storage, so a hosted backend can be added later without touching tool code.
- In-process MCP tests covering tool listing, trip/flight writes, markdown
  export, and day-plan overlap errors.

### Changed

- Day-plan blocks are re-sorted by start time before they are stored.
- SQLite opens in WAL mode with a busy timeout (Neuron-style local store).
- `tripkit --help` no longer loads `node:sqlite`.
- README follows problem → install → quickstart → tool table → what it is /
  isn't → license.

### Fixed

- Listing or querying entities on a missing trip now returns a not-found
  error instead of an empty result.
- Trip / flight / stay writes reject inverted date ranges at the store
  layer, not only at the MCP schema boundary.
