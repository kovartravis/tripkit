-- Remaining trip-data entities (people, flights, stays, days, day_blocks, packing_items) on
-- Postgres, carried forward column-for-column from the SQLite ledger (src/db/schema.ts), per
-- ticket #20. Every table is trip_id-scoped and gated by the same private.is_trip_member
-- helper the trips/trip_members policies already use (day_blocks is two hops out, via
-- day_id -> days.trip_id, so it gets its own membership check through a join on days).

-- ---------------------------------------------------------------- people
create table public.people (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  name text not null,
  email text,
  role text,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.people enable row level security;
create index people_trip_id_idx on public.people (trip_id);

-- --------------------------------------------------------------- flights
create table public.flights (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  airline text not null,
  flight_number text not null,
  departure_airport text not null,
  arrival_airport text not null,
  departure_time timestamptz not null,
  arrival_time timestamptz not null,
  confirmation text,
  seat text,
  traveler_ids jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.flights enable row level security;
create index flights_trip_id_idx on public.flights (trip_id);

-- ----------------------------------------------------------------- stays
create table public.stays (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  name text not null,
  check_in timestamptz not null,
  check_out timestamptz not null,
  address text,
  confirmation text,
  guest_ids jsonb not null default '[]'::jsonb,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.stays enable row level security;
create index stays_trip_id_idx on public.stays (trip_id);

-- ------------------------------------------------------------------ days
create table public.days (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  date date not null,
  title text,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  unique (trip_id, date)
);
alter table public.days enable row level security;
create index days_trip_id_idx on public.days (trip_id);

-- ------------------------------------------------------------ day_blocks
-- start_time/end_time stay `text` (HH:MM), matching the SQLite column shape and the app's
-- own timeSchema, rather than Postgres `time`, which would round-trip as HH:MM:SS.
create table public.day_blocks (
  id text primary key,
  day_id text not null references public.days (id) on delete cascade,
  block_order integer not null,
  start_time text not null,
  end_time text not null,
  type text not null,
  title text not null,
  place text,
  notes text
);
alter table public.day_blocks enable row level security;
create index day_blocks_day_id_idx on public.day_blocks (day_id);

-- ----------------------------------------------------------- packing_items
create table public.packing_items (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  category text not null,
  label text not null,
  quantity integer not null default 1,
  packed boolean not null default false,
  notes text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
alter table public.packing_items enable row level security;
create index packing_items_trip_id_idx on public.packing_items (trip_id);

-- --------------------------------------------------------------- policies
-- Full CRUD via membership, no permission tiers (per spec's RLS section for these tables).

create policy "members can crud people"
on public.people for all
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can crud flights"
on public.flights for all
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can crud stays"
on public.stays for all
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can crud days"
on public.days for all
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can crud packing_items"
on public.packing_items for all
to authenticated
using (private.is_trip_member(trip_id))
with check (private.is_trip_member(trip_id));

create policy "members can crud day_blocks"
on public.day_blocks for all
to authenticated
using (
  exists (
    select 1 from public.days d
    where d.id = day_id and private.is_trip_member(d.trip_id)
  )
)
with check (
  exists (
    select 1 from public.days d
    where d.id = day_id and private.is_trip_member(d.trip_id)
  )
);
