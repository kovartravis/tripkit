# The Owner is a trip_members row too, not just trips.owner_account_id

Every Trip needs to track its Owner somewhere, and the obvious place is a `trips.owner_account_id` column — with a separate `trip_members` table holding only the invited-in Companions. We're not doing that: the Owner gets a `trip_members` row as well (`role = 'owner'`), so "is this Account allowed to touch this Trip's data" is always the same single check — a `trip_members` row exists for `(trip_id, auth.uid())` — instead of two different predicates (owner column OR membership row) repeated across every Row Level Security policy on every trip-scoped table.

CONTEXT.md already treats this as the correct shape ("Member: ...the Owner included"); this just carries that into the schema instead of only the glossary. `trips.owner_account_id` still exists, for creation and for owner-only actions (Invites, removing a Member) — but membership-gated reads and writes never need to know the difference.

**Consequences**: creating a Trip is a two-statement transaction (insert the Trip, insert its `trip_members` owner row) rather than one; removing "the owner from trip_members" must never be allowed independent of the `trips.owner_account_id` pointer, or the two would disagree about who owns the Trip.
