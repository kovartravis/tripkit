-- Trip schema, RLS foundation (accounts/trips/trip_members/invites).
--
-- Per docs/adr/0005 (owner-is-a-trip-member) and docs/adr/0006 (accounts mirror table),
-- and the resolution recorded on design ticket #9.

-- ---------------------------------------------------------------- accounts

-- Mirrors auth.users (id, email). Required because Supabase revokes all grants on the
-- `auth` schema from `authenticated`/`anon` — a direct Postgres connection cannot read
-- auth.users at all, so this is how account data becomes queryable by the app. See ADR 0006.
create table public.accounts (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.accounts enable row level security;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.accounts (id, email) values (new.id, new.email);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------------ trips

-- Same columns as the existing SQLite ledger (see src/db/schema.ts), plus owner_account_id.
create table public.trips (
  id text primary key,
  name text not null,
  start_date date not null,
  end_date date not null,
  home_timezone text not null,
  notes text,
  owner_account_id uuid not null references public.accounts (id),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

alter table public.trips enable row level security;

-- ------------------------------------------------------------ trip_members

-- The Owner gets a row here too (role = 'owner'), so every RLS policy that gates on
-- membership uses one uniform check instead of two different predicates (owner column OR
-- membership row). See ADR 0005.
create table public.trip_members (
  trip_id text not null references public.trips (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  role text not null check (role in ('owner', 'companion')),
  created_at timestamptz not null default now(),
  primary key (trip_id, account_id)
);

alter table public.trip_members enable row level security;

-- `security definer` is load-bearing, not a preference: trip_members' own SELECT policy
-- (below) calls this function, so a `security invoker` version would recurse into that same
-- policy while evaluating itself. Running as definer bypasses RLS for this one internal
-- lookup, which is exactly the standard Supabase pattern for this kind of helper predicate.
create function public.is_trip_member(p_trip_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.trip_members
    where trip_id = p_trip_id
      and account_id = auth.uid()
  );
$$;

-- --------------------------------------------------------------- invites

-- Column shape only, per ticket #9 — the redemption state machine belongs to ticket #10/#21.
create table public.invites (
  id text primary key,
  trip_id text not null references public.trips (id) on delete cascade,
  email text not null,
  invited_by_account_id uuid not null references public.accounts (id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_account_id uuid references public.accounts (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invites enable row level security;

-- --------------------------------------------------------------- policies

create policy "select own or trip-shared accounts"
on public.accounts for select
to authenticated
using (
  id = auth.uid()
  or exists (
    select 1
    from public.trip_members mine
    join public.trip_members theirs on theirs.trip_id = mine.trip_id
    where mine.account_id = auth.uid()
      and theirs.account_id = accounts.id
  )
);

create policy "members can read a trip"
on public.trips for select
to authenticated
using (public.is_trip_member(id));

create policy "members can update a trip"
on public.trips for update
to authenticated
using (public.is_trip_member(id))
with check (public.is_trip_member(id));

-- Any authenticated Account may create a Trip, becoming its Owner — but only as themselves;
-- owner_account_id can't be set to someone else's account id.
create policy "any account can create a trip they own"
on public.trips for insert
to authenticated
with check (owner_account_id = auth.uid());

create policy "owner can delete a trip"
on public.trips for delete
to authenticated
using (owner_account_id = auth.uid());

create policy "members can list a trip's membership"
on public.trip_members for select
to authenticated
using (public.is_trip_member(trip_id));

-- Deliberately narrow: only covers an Owner inserting their own row for a trip they just
-- created (the second half of the create-trip transaction; see ADR 0005). Companions being
-- added by invite redemption is a different, self-authorization-can't-work case — that path
-- is a `security definer` RPC, ticket #10/#21's to build, not this policy's job.
create policy "owner can insert their own membership row"
on public.trip_members for insert
to authenticated
with check (
  role = 'owner'
  and account_id = auth.uid()
  and exists (
    select 1 from public.trips t
    where t.id = trip_id and t.owner_account_id = auth.uid()
  )
);

create policy "owner or the member themself can remove a membership row"
on public.trip_members for delete
to authenticated
using (
  account_id = auth.uid()
  or exists (
    select 1 from public.trips t
    where t.id = trip_id and t.owner_account_id = auth.uid()
  )
);

create policy "owner has full access to a trip's invites"
on public.invites for all
to authenticated
using (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner_account_id = auth.uid())
)
with check (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner_account_id = auth.uid())
);
