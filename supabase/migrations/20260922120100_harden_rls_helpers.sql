-- Harden the previous migration per the Supabase advisor's findings:
--  1. is_trip_member was exposed as a public PostgREST RPC endpoint (any signed-in — or
--     even anonymous — caller could hit /rest/v1/rpc/is_trip_member directly). It's an
--     internal RLS helper, not part of the app's API, so it moves to a `private` schema
--     that PostgREST doesn't publish; RLS policies can still call it schema-qualified.
--  2. handle_new_user is a trigger function only and was directly callable the same way —
--     trigger firing doesn't need role EXECUTE grants, so revoking them is safe.
--  3. auth.uid() in policies/functions gets wrapped in (select ...) so Postgres evaluates
--     it once per query (an initplan) instead of once per row.
--  4. Add the covering indexes the advisor flagged as missing on foreign key columns.

drop policy "select own or trip-shared accounts" on public.accounts;
drop policy "members can read a trip" on public.trips;
drop policy "members can update a trip" on public.trips;
drop policy "any account can create a trip they own" on public.trips;
drop policy "owner can delete a trip" on public.trips;
drop policy "members can list a trip's membership" on public.trip_members;
drop policy "owner can insert their own membership row" on public.trip_members;
drop policy "owner or the member themself can remove a membership row" on public.trip_members;
drop policy "owner has full access to a trip's invites" on public.invites;

drop function public.is_trip_member(text);

create schema if not exists private;
grant usage on schema private to authenticated;

create function private.is_trip_member(p_trip_id text)
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
      and account_id = (select auth.uid())
  );
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create policy "select own or trip-shared accounts"
on public.accounts for select
to authenticated
using (
  id = (select auth.uid())
  or exists (
    select 1
    from public.trip_members mine
    join public.trip_members theirs on theirs.trip_id = mine.trip_id
    where mine.account_id = (select auth.uid())
      and theirs.account_id = accounts.id
  )
);

create policy "members can read a trip"
on public.trips for select
to authenticated
using (private.is_trip_member(id));

create policy "members can update a trip"
on public.trips for update
to authenticated
using (private.is_trip_member(id))
with check (private.is_trip_member(id));

create policy "any account can create a trip they own"
on public.trips for insert
to authenticated
with check (owner_account_id = (select auth.uid()));

create policy "owner can delete a trip"
on public.trips for delete
to authenticated
using (owner_account_id = (select auth.uid()));

create policy "members can list a trip's membership"
on public.trip_members for select
to authenticated
using (private.is_trip_member(trip_id));

create policy "owner can insert their own membership row"
on public.trip_members for insert
to authenticated
with check (
  role = 'owner'
  and account_id = (select auth.uid())
  and exists (
    select 1 from public.trips t
    where t.id = trip_id and t.owner_account_id = (select auth.uid())
  )
);

create policy "owner or the member themself can remove a membership row"
on public.trip_members for delete
to authenticated
using (
  account_id = (select auth.uid())
  or exists (
    select 1 from public.trips t
    where t.id = trip_id and t.owner_account_id = (select auth.uid())
  )
);

create policy "owner has full access to a trip's invites"
on public.invites for all
to authenticated
using (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner_account_id = (select auth.uid()))
)
with check (
  exists (select 1 from public.trips t where t.id = trip_id and t.owner_account_id = (select auth.uid()))
);

create index invites_accepted_account_id_idx on public.invites (accepted_account_id);
create index invites_invited_by_account_id_idx on public.invites (invited_by_account_id);
create index invites_trip_id_idx on public.invites (trip_id);
create index trip_members_account_id_idx on public.trip_members (account_id);
create index trips_owner_account_id_idx on public.trips (owner_account_id);
