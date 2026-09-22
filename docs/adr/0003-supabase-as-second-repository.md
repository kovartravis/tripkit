---
status: superseded by ADR-0004
---

# Supabase/Postgres as a second TripkitRepository, not a replacement

`TripkitRepository` (`src/db/repository.ts`) was built as a storage port specifically so a hosted backend could be added later without touching MCP tool code. The obvious path once multi-user sharing was needed would be to migrate everyone onto Postgres and retire `SqliteTripkitRepository`. We're not doing that: local-first/SQLite stays the default for solo, offline use (`npx tripkit`, no account needed), and a Supabase-backed `TripkitRepository` implementation is added alongside it, selected when running the hosted HTTP server. Sharing a Trip requires the hosted path; using Tripkit solo never does.
