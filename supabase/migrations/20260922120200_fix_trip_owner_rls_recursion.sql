-- Fixes a chicken-and-egg RLS bug caught by the live-Postgres integration test (not a mock):
-- "owner can insert their own membership row" (and two similar policies) checked ownership
-- via `exists (select 1 from trips t where t.id = trip_id and t.owner_account_id = auth.uid())`.
-- That subquery runs against `trips`, which has its own RLS (`is_trip_member`) — and at
-- trip-creation time, no trip_members row exists yet (we're mid-transaction, about to insert
-- the very one this check gates), so the subquery can never see the trip it needs to check.
-- Same root cause as is_trip_member's own recursion (see the previous migration), same fix:
-- a `security definer` helper that bypasses trips' RLS for this one internal lookup.

create function private.is_trip_owner(p_trip_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.trips
    where id = p_trip_id and owner_account_id = (select auth.uid())
  );
$$;

drop policy "owner can insert their own membership row" on public.trip_members;
create policy "owner can insert their own membership row"
on public.trip_members for insert
to authenticated
with check (
  role = 'owner'
  and account_id = (select auth.uid())
  and private.is_trip_owner(trip_id)
);

drop policy "owner or the member themself can remove a membership row" on public.trip_members;
create policy "owner or the member themself can remove a membership row"
on public.trip_members for delete
to authenticated
using (
  account_id = (select auth.uid())
  or private.is_trip_owner(trip_id)
);

drop policy "owner has full access to a trip's invites" on public.invites;
create policy "owner has full access to a trip's invites"
on public.invites for all
to authenticated
using (private.is_trip_owner(trip_id))
with check (private.is_trip_owner(trip_id));
