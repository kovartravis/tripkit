-- Automatic invite redemption (ticket #21): grants trip_members access the moment an
-- invited Account is present to call this, no explicit accept step.
--
-- `security definer` is load-bearing here for the same reason as `is_trip_owner`
-- (see 20260922120200): the caller isn't a trip_members row yet — that's exactly the row
-- this function is about to insert — so a `security invoker` version would have nothing to
-- authorize itself against. Unlike the internal `private.*` helpers, this one is meant to be
-- callable directly by any authenticated Account (it only ever acts on invites matching the
-- caller's own verified email), so it stays in `public`.
create function public.redeem_pending_invites()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := (select auth.uid());
  caller_email text;
begin
  select email into caller_email from public.accounts where id = caller_id;
  if caller_email is null then
    return;
  end if;

  insert into public.trip_members (trip_id, account_id, role)
  select i.trip_id, caller_id, 'companion'
  from public.invites i
  where i.status = 'pending' and i.email = caller_email
  on conflict (trip_id, account_id) do nothing;

  update public.invites
  set status = 'accepted', accepted_account_id = caller_id, updated_at = now()
  where status = 'pending' and email = caller_email;
end;
$$;

revoke execute on function public.redeem_pending_invites() from public, anon;
grant execute on function public.redeem_pending_invites() to authenticated;
