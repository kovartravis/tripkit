# Supabase Auth becomes the only path; solo/offline SQLite mode is removed

ADR 0003 added a Supabase-backed `TripkitRepository` alongside the existing SQLite one, keeping solo/offline use (`npx tripkit`, no account) as the untouched default. We're reversing that: solo mode is removed entirely, and every use of Tripkit — including a single person tracking their own trip — now requires a Supabase Account and goes through the hosted path.

This follows directly from committing to Supabase's OAuth 2.1 Server as the MCP authorization server (see [Design: multi-user MCP authentication via Supabase Auth](https://github.com/kovartravis/tripkit/issues/8)): true per-request RLS enforcement needs a real Supabase Account and JWT behind every request. Keeping solo mode meant maintaining a second identity model (the local owner-passphrase gate) permanently, for a use case — personal, single-owner trip tracking — that a free-tier Supabase Account already covers. One authentication path for the whole product was judged worth losing the fully-offline, no-signup entry point.

**Status**: accepted, supersedes [ADR 0003](./0003-supabase-as-second-repository.md).

**Considered and rejected**: keeping a simplified local passphrase gate purely for solo mode, dropping only the current implementation's complexity (in-memory token maps, etc.) while still running two parallel auth code paths. Rejected for the same reason ADR 0003's "second repository, not a migration" framing no longer holds once auth itself must be shared: two paths to maintain, test, and reason about security for, versus one.

**Consequences**: `SqliteTripkitRepository` and the existing single-owner OAuth implementation (`src/mcp/oauth/provider.ts`, `loginGate.ts`, `state.ts`) are removed rather than kept in parallel. There is no offline or account-free way to run Tripkit going forward.
