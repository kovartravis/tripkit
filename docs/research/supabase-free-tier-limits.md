# Supabase free-tier limits for phase-1 shared access

Researched for [wayfinder ticket #6](https://github.com/kovartravis/tripkit/issues/6), a child of the [Host Tripkit on Supabase map](https://github.com/kovartravis/tripkit/issues/4). Verified against Supabase's own docs, 2026-09-21.

## Limits (Free plan)

| Limit | Value | Source |
|---|---|---|
| Database size | 500 MB (shared CPU, 500 MB RAM) | [Pricing](https://supabase.com/pricing) |
| File storage | 1 GB | [Pricing](https://supabase.com/pricing) |
| Concurrent active free projects (per org) | 2 | [Pricing](https://supabase.com/pricing) |
| Auth monthly active users | 50,000 (same cap for third-party MAU) | [Pricing](https://supabase.com/pricing) |
| Egress | 5 GB/month + 5 GB cached egress/month | [Pricing](https://supabase.com/pricing) |
| Realtime concurrent connections | 200 peak | [Pricing](https://supabase.com/pricing) |
| Realtime messages | 2,000,000/month | [Pricing](https://supabase.com/pricing) |
| Edge Function invocations | 500,000 included | [Pricing](https://supabase.com/pricing) |
| Auth audit log retention | 1 hour | [Pricing](https://supabase.com/pricing) |
| API/database log retention | 1 day | [Pricing](https://supabase.com/pricing) |
| Max file upload size | 50 MB | [Pricing](https://supabase.com/pricing) |
| Backups | None (no automatic backups, no Point-in-Time Recovery, no branching) | [Pricing](https://supabase.com/pricing) |
| Support | Community only | [Pricing](https://supabase.com/pricing) |

## Project pausing (the limit that actually matters here)

Per the [official Project Pausing docs](https://supabase.com/docs/guides/platform/free-project-pausing):

- A Free-plan project pauses after **low activity over a 7-day period**. The docs describe activity loosely as "user database activity" — "a few user requests to the database each day over the previous week is enough to keep the project from being paused" — citing both direct API calls and requests via a connected application. The docs don't explicitly say whether Auth-only requests (no DB query) count; MCP tool calls that touch `TripkitRepository` will always hit the database, so this is moot for Tripkit's actual usage pattern.
- The project owner gets a warning email roughly a week before pausing.
- A paused project can be restored from the dashboard ("Resume project"), preserving data and configuration, for up to **1 year** after pausing.
- Upgrading to Pro is the only way to disable pausing entirely — paid projects cannot be paused.

## Assessment for phase 1

**Storage and MAU caps are not a concern.** One Trip's worth of relational data (trips, flights, stays, days, people, packing items) for an Owner plus a handful of Companions is kilobytes to low megabytes, nowhere near 500 MB. A handful of Companion accounts is nowhere near the 50,000 MAU cap.

**The real risk is the 7-day pause**, since trip planning is bursty — active while itinerary details are being worked out, then quiet for stretches, potentially longer than a week between sessions (e.g. between booking flights and packing the week before departure). Two ways to handle it, not mutually exclusive:

1. **Accept it and resume manually.** A pause doesn't lose data (recoverable for a year); it just means the first MCP call after a quiet stretch fails until someone hits "Resume project" in the dashboard. Acceptable if that's a rare, low-stakes inconvenience for a single test trip.
2. **Keep-alive ping.** A trivial scheduled job (e.g. a free GitHub Actions cron, or Supabase's own scheduled Edge Functions within the 500k/month free invocation budget) that issues one lightweight query on an interval under 7 days keeps the project active indefinitely at no cost. Multiple community write-ups (linked below) exist for exactly this because it's a common Free-tier annoyance, not a Tripkit-specific problem.

Recommendation: don't build a keep-alive for phase 1 — a single test trip with a handful of users is exactly the low-stakes case where "resume manually if it pauses" is fine, and adding scheduled infrastructure this early is premature. Revisit if the pause becomes a real friction point.

## Secondary sources (community, not authoritative — corroborate but don't override the docs above)

- [Project Pausing — official docs](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Supabase Pricing](https://supabase.com/pricing)
- [Prevent Supabase Free Tier Pausing (2026 Guide)](https://shadhujan.medium.com/how-to-keep-supabase-free-tier-projects-active-d60fd4a17263)
- [Supabase Free Tier Will Pause Your App — GitHub Actions Fix](https://levelup.gitconnected.com/supabase-free-tier-will-pause-your-app-heres-the-github-actions-fix-8c1fd35b49ca)
- [travisvn/supabase-pause-prevention](https://github.com/travisvn/supabase-pause-prevention) — an existing OSS keep-alive tool, if a keep-alive is wanted later
