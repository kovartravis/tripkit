# Supabase Infrastructure Cost Scaling for Tripkit

Research date: 2026-09-21. All figures verified live against Supabase's pricing page and docs (see Sources). Pricing changes over time — re-verify before using these numbers for real budgeting.

## TL;DR

- Tripkit's per-tenant footprint (small structured rows, occasional MCP reads/writes, 2–6 auth users per Trip) is tiny relative to what Supabase's **Pro plan ($25/month base)** includes. Under conservative assumptions, **10, 100, and 1,000 tenants all fit inside Pro's included quotas with $0 in overages** — so the estimated cost is **~$25/month at all three tiers**.
- **Database storage is the dimension that binds first** as tenant count grows, because Pro's included disk (8 GB) is much smaller relative to Tripkit's low egress/MAU-per-tenant ratios. Under this model, Pro's 8 GB disk allowance isn't exceeded until roughly **~4,000 tenants** (at ~2 MB/tenant). MAU overage wouldn't hit until ~25,000 tenants, and egress overage not until ~12,500 tenants.
- Supabase's **Team plan ($599/month) has the *same* included resource quotas as Pro** (8 GB DB, 100,000 MAU, 250 GB egress) — its higher price buys longer backups/log retention and support SLAs, not more headroom. So scale alone doesn't force a Pro→Team upgrade in this model; what it forces (well beyond 1,000 tenants) is paying Pro's per-unit overage rates ($0.125/GB DB, $0.09/GB egress, $0.00325/MAU), or upgrading compute if concurrent-connection load grows.
- Caveat: Supabase's **Free plan** ($0/month) would also technically fit the 10-tenant tier on raw quota numbers, but Free projects **auto-pause after 1 week of inactivity** — unacceptable for a real app where companions might not open it for a couple of weeks between trips. Pro is the realistic floor for a production deployment at any of these tiers.

## Assumptions

Tripkit is modeled as **one shared Supabase project/org** (standard multi-tenant Postgres + RLS architecture — tenants are rows scoped by `trip_id`, not one Supabase project per tenant, which would be absurd at 1,000 tenants). Per-tenant assumptions, chosen to be conservative/realistic for a low-traffic, no-media, structured-data app:

| Assumption | Value | Rationale |
|---|---|---|
| Users per tenant (Owner + Companions) | 4 average (range 2–6 stated in brief) | Auth MAU billing counts distinct users who sign in/refresh token in the billing cycle |
| MAU per tenant | 4 | Assumes essentially all trip participants are active at least once/month — an upper-bound/conservative assumption |
| DB storage per tenant | ~2 MB (rows + indexes) | Small JSON/text rows across trips, flights, stays, day plans, people, packing lists — no attachments or blobs. A trip with dozens of flights/stays/day-plan entries as text/JSON rows is well under 1 MB of raw data; 2 MB/tenant leaves generous headroom for indexes and row/page overhead |
| Egress per tenant per month | ~20 MB | Occasional MCP tool calls reading/writing small rows — not high-traffic. 20 MB/tenant/month is generous headroom over a realistic few-hundred-KB of actual JSON payload traffic |
| Compute | Pro plan's included Micro instance (1 GB RAM, shared CPU, 60 direct / 200 pooler connections) | Workload is low-concurrency, non-heavy-compute (no analytics/aggregation jobs, no media processing) |
| Base project overhead | ~40–60 MB (pre-installed extensions/schemas) | Per Supabase docs — negligible at these scales, folded into the "well under 8 GB" conclusion rather than itemized separately |

These are deliberately conservative (i.e., likely to overestimate real usage) — if Tripkit's actual per-tenant storage or egress turns out several times higher, re-run the model; see "Sensitivity" note at the end of the per-tier breakdown.

## Plan overview (verified against live pricing page and docs)

| Plan | Base price | DB storage included | Compute included | MAU included | Egress included (uncached / cached) | Pause policy |
|---|---|---|---|---|---|---|
| **Free** | $0/mo | 500 MB | Shared CPU, 500 MB RAM (Nano) | 50,000 | 5 GB / 5 GB | Paused after 1 week of inactivity; max 2 active projects |
| **Pro** | $25/mo | 8 GB (autoscales, then billed) | Micro instance ($10/mo credit included) | 100,000 | 250 GB / 250 GB | Never pauses |
| **Team** | $599/mo | 8 GB (same as Pro) | Micro instance ($10/mo credit included) | 100,000 (same as Pro) | 250 GB / 250 GB (same as Pro) | Never pauses; adds 14-day backups, 28-day log retention |
| **Enterprise** | Custom | Custom | Custom | Custom | Custom | Custom, SLA-backed |

Source: [supabase.com/pricing](https://supabase.com/pricing)

Overage / add-on rates once a plan's included quota is exceeded (Pro and Team, per project unless noted):

| Dimension | Overage rate | Source |
|---|---|---|
| Database disk storage | $0.125 / GB / month ($0.000171 / GB-hr) | [database-size](https://supabase.com/docs/guides/platform/database-size), [pricing](https://supabase.com/pricing) |
| Uncached egress | $0.09 / GB | [manage-your-usage/egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| Cached egress | $0.03 / GB | [manage-your-usage/egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress) |
| MAU (Auth) | $0.00325 / MAU | [manage-your-usage/monthly-active-users](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users) |
| Compute (per instance, if bumped above the included Micro) | Small $15/mo, Medium $60/mo, Large $110/mo, XL $210/mo, 2XL $410/mo, 4XL $960/mo, 8XL $1,870/mo, 12XL ~$2,800/mo, 16XL ~$3,730/mo | [pricing](https://supabase.com/pricing), [compute-and-disk](https://supabase.com/docs/guides/platform/compute-and-disk) |
| Point-in-time recovery (PITR) | $100/mo per 7 days retention | [pricing](https://supabase.com/pricing) |
| Custom domain | $10/domain/mo/project | [pricing](https://supabase.com/pricing) |

Notes on Free plan overages: Free-plan projects cannot purchase overages — they get notified and enter a grace period, so Free is effectively hard-capped at its included quotas ([billing-faq](https://supabase.com/docs/guides/platform/billing-faq)).

Compute connection limits (relevant to whether Tripkit ever needs to scale compute for concurrency, not raw storage): Micro supports 60 direct DB connections / 200 pooler (Supavisor) clients, scaling up through Small (90/400), Medium (120/600), Large (160/800), up to 16XL (500/12,000). Source: [compute-and-disk](https://supabase.com/docs/guides/platform/compute-and-disk).

Org-based billing: Supabase bills per organization; each org has one subscription plan and its cost is base fee + usage overages across all projects in that org. Source: [billing-on-supabase](https://supabase.com/docs/guides/platform/billing-on-supabase).

## Per-tier cost breakdown

### Tier 1 — 10 tenants

- DB storage: 10 × 2 MB = **20 MB** (vs. 8,000 MB included on Pro — 0.25% used)
- MAU: 10 × 4 = **40 MAU** (vs. 100,000 included on Pro)
- Egress: 10 × 20 MB = **200 MB = 0.2 GB** (vs. 250 GB included on Pro)
- Compute: Micro instance, well within connection limits at this scale

Fits comfortably within the **Free plan's** raw quotas (500 MB DB, 50,000 MAU, 5 GB egress), but Free's 1-week auto-pause makes it unsuitable for a real product where a Trip's companions might not touch the app for a couple of weeks between trips.

**Recommended plan: Pro. Estimated cost: $25/month** (base fee only, no overages).

### Tier 2 — 100 tenants

- DB storage: 100 × 2 MB = **200 MB** (2.5% of Pro's 8 GB)
- MAU: 100 × 4 = **400 MAU** (0.4% of Pro's 100,000)
- Egress: 100 × 20 MB = **2 GB** (0.8% of Pro's 250 GB)
- Compute: Micro instance still comfortably sufficient (occasional MCP calls, not sustained concurrent load)

**Recommended plan: Pro. Estimated cost: $25/month** (base fee only, no overages).

### Tier 3 — 1,000 tenants

- DB storage: 1,000 × 2 MB = **2 GB** (25% of Pro's 8 GB)
- MAU: 1,000 × 4 = **4,000 MAU** (4% of Pro's 100,000)
- Egress: 1,000 × 20 MB = **20 GB** (8% of Pro's 250 GB)
- Compute: Micro instance still very likely sufficient — even with 1,000 tenants, concurrent connections from "occasional" MCP tool calls are unlikely to approach Micro's 200 pooler-client ceiling unless usage becomes bursty/synchronous across many tenants at once

**Recommended plan: Pro. Estimated cost: $25/month** (base fee only, no overages).

### Sensitivity / where this breaks

Because all three requested tiers land far under Pro's included quotas, the model is only interesting once you ask "at what tenant count does each dimension start costing extra, on top of the $25 base?" Solving included-quota ÷ per-tenant-assumption:

| Dimension | Pro included quota | Per-tenant assumption | Tenant count where overage starts |
|---|---|---|---|
| DB storage | 8 GB (8,192 MB) | 2 MB/tenant | **~4,096 tenants** |
| Egress | 250 GB (256,000 MB) | 20 MB/tenant/month | **~12,800 tenants** |
| MAU | 100,000 | 4 MAU/tenant | **~25,000 tenants** |

**DB storage is the binding constraint** — it's the first quota Tripkit would realistically exceed, around the ~4,000-tenant mark under these assumptions, and even then the cost impact is small: e.g. at 10,000 tenants (20 MB over 8 GB... actually 20,000 MB total, ~11.8 GB over the 8 GB included), overage would be roughly 11.8 GB × $0.125 ≈ **$1.48/month extra** on top of the $25 base — not a plan-forcing event by itself. If per-tenant DB storage assumptions were instead 10x higher (e.g., 20 MB/tenant, if trip histories/packing-list JSON grow much larger than assumed, or extensive full-text search indexes are added), the crossover would occur around ~400 tenants instead of ~4,000 — worth re-checking against real per-tenant row sizes once the schema and a few months of real usage exist.

Because Team's included quotas are identical to Pro's, reaching these overage thresholds doesn't itself justify moving to Team — Team's value is 14-day backups, 28-day log retention, and support SLAs, not more headroom. A scale-driven upgrade off Pro would instead look like: staying on Pro and paying the modest per-unit overages above, or bumping the compute instance size only if concurrent-connection load (not raw tenant count) becomes the constraint.

## Sources

- [Supabase Pricing](https://supabase.com/pricing) — plan base prices, included quotas (DB storage, MAU, egress, compute), Free-plan pause policy, compute add-on tier prices, PITR/custom-domain/other add-on prices
- [Understanding Database and Disk Size](https://supabase.com/docs/guides/platform/database-size) — $0.125/GB/month ($0.000171/GB-hr) disk overage rate, 8 GB included disk, autoscaling behavior, new-project baseline size (~40–60 MB)
- [Manage Disk size usage](https://supabase.com/docs/guides/platform/manage-your-usage/disk-size) — disk usage/billing mechanics
- [Compute and Disk](https://supabase.com/docs/guides/platform/compute-and-disk) — compute instance tiers (Micro through 16XL), RAM/vCPU, direct and pooler connection limits per tier, Nano (free-tier) behavior
- [Manage Compute usage](https://supabase.com/docs/guides/platform/manage-your-usage/compute) — hourly compute billing mechanics
- [Manage Monthly Active Users (MAU) usage](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users) — MAU counting methodology, included quotas per plan, $0.00325/MAU overage rate
- [Manage Egress usage](https://supabase.com/docs/guides/platform/manage-your-usage/egress) — what counts as egress, included quotas (uncached/cached), $0.09/GB and $0.03/GB overage rates
- [About billing on Supabase](https://supabase.com/docs/guides/platform/billing-on-supabase) — org-based billing model, per-plan quota summary
- [Billing FAQ](https://supabase.com/docs/guides/platform/billing-faq) — Free-plan overage/grace-period behavior
