-- Fixes a real gap the code review caught: "owner or the member themself can remove a
-- membership row" let an Owner delete their *own* trip_members row (it only checked
-- `account_id = auth.uid()`, with nothing excluding role = 'owner'). ADR 0005 is explicit
-- that this must never be allowed independent of the trips.owner_account_id pointer, or the
-- two disagree about who owns the trip — and concretely, the Owner would immediately lose
-- read/update access to their own trip (those are gated on trip_members membership) while
-- still being able to delete it (that's gated on owner_account_id directly), an inconsistent
-- and confusing state. Deleting an entire trip (which cascades trip_members) remains the
-- correct way for an Owner to walk away from one; this policy no longer offers a second,
-- inconsistent path to the same end.

drop policy "owner or the member themself can remove a membership row" on public.trip_members;
create policy "owner or the member themself can remove a membership row"
on public.trip_members for delete
to authenticated
using (
  role <> 'owner'
  and (
    account_id = (select auth.uid())
    or private.is_trip_owner(trip_id)
  )
);
