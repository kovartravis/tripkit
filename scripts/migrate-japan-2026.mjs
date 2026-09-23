#!/usr/bin/env node
// One-time migration (issue #24): reads the local SQLite ledger and writes the "Kovar Family
// Japan 2026" trip into Supabase under the Owner's real Account. Not part of the npm package or
// its test suite — run once, by hand, before the trip starts (2026-10-05).
//
// Usage:
//   npm run build                              # dist/db/postgres/pool.js must exist
//   node scripts/migrate-japan-2026.mjs         # dry run — prints what would be written
//   node scripts/migrate-japan-2026.mjs --apply # writes to Supabase
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_HOST, SUPABASE_DB_USER,
// SUPABASE_DB_PASSWORD (SUPABASE_DB_PORT/SUPABASE_DB_NAME optional) — set directly or via a
// gitignored .env.local at the repo root (see .env.example). Connects with the same
// SUPABASE_DB_* pooler credentials the live-Postgres test suite uses, which authenticate as
// Postgres's own `postgres` role and so bypass RLS entirely — no JWT/set_config dance, matching
// the spec's "service-role key, bypassing RLS" instruction.
//
// The Owner's Supabase Account (OWNER_EMAIL, default kovartravis@gmail.com) must already exist
// — sign up normally first. There is no inviter for an Owner.
//
// Idempotent: every insert is ON CONFLICT DO NOTHING, so re-running after a partial or repeat
// run is a safe no-op rather than a duplicate or a crash.

import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function loadEnvLocal() {
  const envPath = path.join(repoRoot, ".env.local");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = line.slice(idx + 1).trim();
  }
}
loadEnvLocal();

const APPLY = process.argv.includes("--apply");
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? "kovartravis@gmail.com";
const SQLITE_PATH =
  process.env.TRIPKIT_SQLITE_PATH ??
  path.join(process.env.HOME ?? "", "Library/Application Support/tripkit/tripkit.db");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var: ${name} (see .env.example)`);
    process.exit(1);
  }
  return value;
}

/**
 * Dumps one SQLite table as an array of row objects via the `sqlite3` CLI's JSON output mode —
 * avoids adding a SQLite driver dependency for a script that runs exactly once. Table names are
 * always literals from this file, never user input, so shelling out is safe.
 */
function readTable(dbPath, table) {
  const out = execFileSync("sqlite3", ["-json", dbPath, `select * from ${table};`], {
    encoding: "utf8",
  });
  return out.trim() ? JSON.parse(out) : [];
}

/** Row-shape transforms between SQLite's storage types and Postgres's — exported for unit tests. */
export function mapFlight(row) {
  return { ...row, traveler_ids: JSON.stringify(JSON.parse(row.traveler_ids ?? "[]")) };
}
export function mapStay(row) {
  return { ...row, guest_ids: JSON.stringify(JSON.parse(row.guest_ids ?? "[]")) };
}
export function mapPackingItem(row) {
  return { ...row, packed: Boolean(row.packed) };
}

async function findOwnerAccountId(supabaseUrl, serviceRoleKey, email) {
  const res = await fetch(`${supabaseUrl}/auth/v1/admin/users?` + new URLSearchParams({ email }), {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
  });
  if (!res.ok) {
    throw new Error(`Supabase Admin API lookup failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  const users = body.users ?? [];
  const match = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match?.id;
}

async function main() {
  if (!existsSync(SQLITE_PATH)) {
    console.error(`SQLite file not found at ${SQLITE_PATH} (set TRIPKIT_SQLITE_PATH to override)`);
    process.exit(1);
  }

  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  console.log(`Looking up Owner Account for ${OWNER_EMAIL} via Supabase Admin API...`);
  const ownerAccountId = await findOwnerAccountId(supabaseUrl, serviceRoleKey, OWNER_EMAIL);
  if (!ownerAccountId) {
    console.error(
      `No Supabase Account found for ${OWNER_EMAIL}. Sign up normally first — there's no inviter for an Owner.`,
    );
    process.exit(1);
  }
  console.log(`Owner Account: ${ownerAccountId}`);

  const trips = readTable(SQLITE_PATH, "trips");
  if (trips.length !== 1) {
    console.error(`Expected exactly 1 trip in ${SQLITE_PATH}, found ${trips.length}`);
    process.exit(1);
  }
  const [tripRow] = trips;
  const people = readTable(SQLITE_PATH, "people").filter((r) => r.trip_id === tripRow.id);
  const flights = readTable(SQLITE_PATH, "flights")
    .filter((r) => r.trip_id === tripRow.id)
    .map(mapFlight);
  const stays = readTable(SQLITE_PATH, "stays")
    .filter((r) => r.trip_id === tripRow.id)
    .map(mapStay);
  const days = readTable(SQLITE_PATH, "days").filter((r) => r.trip_id === tripRow.id);
  const dayIds = new Set(days.map((d) => d.id));
  const dayBlocks = readTable(SQLITE_PATH, "day_blocks").filter((r) => dayIds.has(r.day_id));
  const packingItems = readTable(SQLITE_PATH, "packing_items")
    .filter((r) => r.trip_id === tripRow.id)
    .map(mapPackingItem);

  console.log(
    `Trip "${tripRow.name}" (${tripRow.id}): ${people.length} people, ${flights.length} flights, ` +
      `${stays.length} stays, ${days.length} days, ${dayBlocks.length} day blocks, ` +
      `${packingItems.length} packing items.`,
  );

  if (!APPLY) {
    console.log("\nDry run only (pass --apply to write to Supabase). No changes made.");
    return;
  }

  const poolConfig = {
    host: requireEnv("SUPABASE_DB_HOST"),
    port: Number(process.env.SUPABASE_DB_PORT ?? 5432),
    user: requireEnv("SUPABASE_DB_USER"),
    password: requireEnv("SUPABASE_DB_PASSWORD"),
    database: process.env.SUPABASE_DB_NAME ?? "postgres",
  };

  const { createSupabasePool } = await import(path.join(repoRoot, "dist/db/postgres/pool.js"));
  const pool = createSupabasePool(poolConfig);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `insert into public.trips
         (id, name, start_date, end_date, home_timezone, notes, owner_account_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (id) do nothing`,
      [
        tripRow.id,
        tripRow.name,
        tripRow.start_date,
        tripRow.end_date,
        tripRow.home_timezone,
        tripRow.notes,
        ownerAccountId,
        tripRow.created_at,
        tripRow.updated_at,
      ],
    );

    await client.query(
      `insert into public.trip_members (trip_id, account_id, role)
       values ($1, $2, 'owner')
       on conflict (trip_id, account_id) do nothing`,
      [tripRow.id, ownerAccountId],
    );

    for (const p of people) {
      await client.query(
        `insert into public.people (id, trip_id, name, email, role, notes, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do nothing`,
        [p.id, p.trip_id, p.name, p.email, p.role, p.notes, p.created_at, p.updated_at],
      );
    }

    for (const f of flights) {
      await client.query(
        `insert into public.flights
           (id, trip_id, airline, flight_number, departure_airport, arrival_airport,
            departure_time, arrival_time, confirmation, seat, traveler_ids, notes,
            created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
         on conflict (id) do nothing`,
        [
          f.id,
          f.trip_id,
          f.airline,
          f.flight_number,
          f.departure_airport,
          f.arrival_airport,
          f.departure_time,
          f.arrival_time,
          f.confirmation,
          f.seat,
          f.traveler_ids,
          f.notes,
          f.created_at,
          f.updated_at,
        ],
      );
    }

    for (const s of stays) {
      await client.query(
        `insert into public.stays
           (id, trip_id, name, check_in, check_out, address, confirmation, guest_ids, notes,
            created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
         on conflict (id) do nothing`,
        [
          s.id,
          s.trip_id,
          s.name,
          s.check_in,
          s.check_out,
          s.address,
          s.confirmation,
          s.guest_ids,
          s.notes,
          s.created_at,
          s.updated_at,
        ],
      );
    }

    for (const d of days) {
      await client.query(
        `insert into public.days (id, trip_id, date, title, notes, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (id) do nothing`,
        [d.id, d.trip_id, d.date, d.title, d.notes, d.created_at, d.updated_at],
      );
    }

    for (const b of dayBlocks) {
      await client.query(
        `insert into public.day_blocks
           (id, day_id, block_order, start_time, end_time, type, title, place, notes)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do nothing`,
        [b.id, b.day_id, b.block_order, b.start_time, b.end_time, b.type, b.title, b.place, b.notes],
      );
    }

    for (const item of packingItems) {
      await client.query(
        `insert into public.packing_items
           (id, trip_id, category, label, quantity, packed, notes, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (id) do nothing`,
        [
          item.id,
          item.trip_id,
          item.category,
          item.label,
          item.quantity,
          item.packed,
          item.notes,
          item.created_at,
          item.updated_at,
        ],
      );
    }

    await client.query("COMMIT");
    console.log("\nMigration applied.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
