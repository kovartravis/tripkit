# Contributing to Tripkit

Thanks for taking a look at Tripkit. It's a small, focused project, so the bar
for contributing is simple: keep changes scoped, tested, and in line with the
project's non-goals below.

## Development setup

Requires Node.js >= 22.13 (Tripkit uses the built-in `node:sqlite` module, which
needs no native build step).

```bash
git clone https://github.com/kovartravis/tripkit.git
cd tripkit
npm install
npm run build
npm test
```

To try the MCP server locally over stdio:

```bash
npm run build
node dist/cli/index.js mcp
```

Or point an MCP-capable client (Claude Desktop, etc.) at
`node /path/to/tripkit/dist/cli/index.js mcp`.

## Project layout

```
src/
  version.ts  package name + version shared by the CLI and MCP server
  domain/     zod schemas, validation rules, and pure domain logic
              (packing generation, transit sketch, day-plan overlap check)
  db/         storage: the TripkitRepository interface, SQLite schema,
              and the SqliteTripkitRepository implementation
  export/     markdown and ICS export, built on top of the repository
  mcp/        MCP server wiring and the tripkit_* tool registrations
  cli/        the `tripkit` CLI entry point (mcp / init / status)
test/         vitest unit and MCP in-process tests
docs/TOOLS.md per-tool parameter/return reference
```

## Making changes

- **Storage changes** go through `TripkitRepository` (`src/db/repository.ts`).
  Add methods to the interface first, then implement them in
  `SqliteTripkitRepository`. This keeps the door open for a future hosted
  backend to implement the same interface.
- **New MCP tools** get their own file under `src/mcp/tools/`, registered
  from `src/mcp/server.ts`. Define the input/output shape as a zod schema in
  `src/domain/types.ts` first, and document the tool in `docs/TOOLS.md`.
- **Validation** belongs in `src/domain/` as pure functions where possible
  (see `assertNoOverlaps` for the day-plan overlap check) so it's easy to
  unit test without touching the database.
- Run `npm run build` (type check) and `npm test` before opening a PR. CI
  runs both. Point `TRIPKIT_DATA_DIR` at a temp directory if you don't want
  a test or local MCP session to touch `~/.local/share/tripkit`.

## Scope

Please read the "What Tripkit is / isn't" section of the README before
proposing a feature. In short: Tripkit is a tool surface for a trip ledger,
not a chat planner, and v1 has no booking/checkout code and no live
routing/pricing APIs. PRs that add those are likely to be declined — open an
issue first if you want to discuss it.

## Reporting issues

Please include:
- What you expected vs. what happened
- Tripkit version (`npm ls @kovartravis/tripkit` or `tripkit --help`)
- Node.js version (`node --version`)
- Steps to reproduce, ideally as a minimal MCP tool call sequence
