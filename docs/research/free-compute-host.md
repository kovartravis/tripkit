# Research: best free compute host for the phase-1 MCP HTTP server

Ticket: [#5](https://github.com/kovartravis/tripkit/issues/5), child of the [wayfinder map](https://github.com/kovartravis/tripkit/issues/4).

## Question

Where can Tripkit's Express/MCP HTTP server (`src/mcp/httpServer.ts`, run via `tripkit mcp --http`) run continuously for $0/month, so Companions' agents can reach it without depending on the Owner's laptop being on — verified against current official docs, not memory, since free-tier offerings across these providers have shifted heavily through 2025–2026.

A hard constraint shaped every option below: the current single-owner OAuth provider (`src/mcp/oauth/provider.ts`) keeps pending authorization codes and access tokens in an **in-memory `Map`**, only persisting refresh tokens to a local JSON file in the data dir. Any host whose execution model can kill the process, recycle it, or run multiple concurrent instances mid-flow breaks OAuth code/token exchange. (Note: this is the *current* code as of the free-compute-host research date — [Design: multi-user MCP authentication via Supabase Auth](https://github.com/kovartravis/tripkit/issues/8) is expected to replace this in-memory model with something backed by Postgres/Supabase Auth, which would relax this constraint for some options below. This research evaluates hosts against *today's* code, since phase 1 needs to work before that redesign lands.)

## Findings by option

### Oracle Cloud "Always Free" VM — recommended

Free **indefinitely**, not a trial: "All Oracle Cloud Infrastructure accounts (whether free or paid) have a set of resources that are free of charge in the home region of the tenancy, for the life of the account," separate from the 30-day/$300 trial. [[Oracle docs]](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

Current allocation (Oracle **halved** the Arm allocation in mid-2026, per [InfoQ](https://www.infoq.com/news/2026/07/oracle-cloud-free-tier-limits/)):
- 2 AMD `VM.Standard.E2.1.Micro` instances (1/8 OCPU, 1GB RAM each), **or**
- 1–2 Arm `VM.Standard.A1.Flex` instances totaling 2 OCPU / 12GB RAM
- 200GB block storage, 1 public IP per instance, up to 50Mbps bandwidth

This is a **real VM you control** — full Linux, no execution-model constraints. It runs Tripkit's existing Express/Node process, with its in-memory OAuth state, completely unmodified. No cold starts.

**Caveats:**
- **Idle reclamation**: Oracle can reclaim an Always Free instance if, over a 7-day window, CPU, network, *and* memory utilization (95th percentile) all stay under 20%. A low-traffic single-trip MCP server plausibly dips that low; mitigate with a lightweight periodic heartbeat if this becomes a problem.
- **Capacity**: Ampere A1 capacity is not always available in every region for new instances — a real, reported friction point, though it doesn't affect an instance once provisioned.
- Oracle changed these limits with no advance announcement in 2026; free-tier terms here have proven less stable than "indefinitely free" suggests.

### Laptop + tunnel (already supported, no new host)

$0, zero setup — `tripkit mcp --http` already supports this today. The tradeoff already known going in: requires the Owner's machine to be on and reachable. Good phase-1 fallback if Oracle provisioning is friction, but doesn't solve "companions can reach it any time."

### Render (free web service tier)

Free, but **not what "free" usually implies**: web services sleep after 15 minutes with no inbound traffic, waking on the next request with ~30–60s of cold-start latency. [[Render docs]](https://render.com/docs/free) 750 free instance-hours/month (plenty for low traffic; sleeping time doesn't count against it).

**Critical flag beyond the cold start**: Render's docs state local filesystem changes are **lost every time the service spins down**. Tripkit's current data dir (SQLite file + `oauth-state.json`) would be wiped on every sleep cycle — a non-starter *as the code stands today*, independent of the in-memory-OAuth-map issue. This becomes viable only once all state (trip data and auth) is fully externalized to Postgres/Supabase — i.e., after the multi-user auth redesign ([#8](https://github.com/kovartravis/tripkit/issues/8)) and the Postgres repository ([#9](https://github.com/kovartravis/tripkit/issues/9)) both land. Render's own docs explicitly discourage the free tier for production use.

### Google Cloud Run

Genuinely permanent free tier — 2 million requests/month, 360,000 GB-seconds compute, per [Google's free program docs](https://docs.cloud.google.com/free/docs/free-cloud-features) — not a trial.

But it **scales to zero** between requests and can route different requests to different instances; in-memory state (the current OAuth code/token maps) is not guaranteed to survive across requests. Same conclusion as Render: not viable against today's code, but a credible *later* option once auth/session state is fully Postgres-backed — worth revisiting after [#8](https://github.com/kovartravis/tripkit/issues/8) resolves, since Cloud Run's free tier is more generous and stable than Render's.

### Cloudflare Workers

Free tier is generous for request volume (100k requests/day), but this is disqualifying regardless of price: Workers "do not support long-lived TCP servers" — the runtime is built for request/response at the edge, not a persistent Express process. [[Cloudflare docs]](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) Not viable for Tripkit's HTTP server in its current shape, and would need a full rearchitecture (not just a state migration) to ever fit.

### Supabase Edge Functions

Same category as Workers: Deno-based, "optimized for short-lived, idempotent operations," with Supabase's own docs directing long-running work to a separate background-worker product instead. [[Supabase docs]](https://supabase.com/docs/guides/functions) Not viable for a persistent MCP server, regardless of it being the same vendor as the database.

### Railway

No real ongoing free tier as of 2026: a one-time $5 trial credit (30 days), then a $1/month credit on the standing free plan — likely consumed well before a month is out for an always-on process. [[Railway pricing]](https://railway.com/pricing) Not free in practice.

### Fly.io

No free allowance for new accounts since 2024 — pure pay-as-you-go now (a tiny shared-CPU machine runs ~$2/month). Cheap, but not free, and not applicable to a new Tripkit deployment.

## Recommendation

For phase 1, against Tripkit's **current** code (in-memory OAuth state, local SQLite/JSON files):

1. **Oracle Cloud Always Free VM (Ampere A1)** is the best fit — genuinely free indefinitely, a real always-on machine, runs the existing Express/Node server unmodified, no cold starts. Accept the idle-reclamation and capacity risks as known, monitorable trade-offs.
2. **Laptop + tunnel** is the zero-setup fallback if Oracle provisioning proves to be friction, or as a starting point before committing to VM setup.
3. Everything serverless (Render, Cloud Run, Workers, Supabase Edge Functions) is disqualified for phase 1 specifically because Tripkit's local state (SQLite file, OAuth JSON, in-memory token maps) doesn't survive their execution models. **Cloud Run is worth reconsidering once [#8](https://github.com/kovartravis/tripkit/issues/8) (multi-user Supabase Auth) and [#9](https://github.com/kovartravis/tripkit/issues/9) (Postgres repository) land** and no state lives outside Postgres anymore — its free tier is the most durable and generous of the serverless options once that constraint is gone.
