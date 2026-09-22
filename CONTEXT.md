# Tripkit

A local-first trip ledger exposed as MCP tools for personal assistant agents. Tripkit is extending from a single-owner tool into a shared, multi-user backend (hosted on Supabase) that multiple people can access from their own agents, on the way to a future multi-tenant SaaS.

## Language

**Account**:
A Supabase Auth identity: a real login capable of authenticating an MCP session. Distinct from a `Person`.
_Avoid_: User, Owner (Owner is a role an Account can hold, not a synonym for Account)

**Owner**:
The Account that created a `Trip`. Holds exclusive control over that trip's membership: only the Owner can send `Invite`s or remove a `Member`. Every Trip has exactly one Owner.

**Member**:
An Account that has been granted access to a specific `Trip` (the Owner included). All Members currently get full read/write access to the trip's data via MCP; there are no permission tiers below Owner yet.
_Avoid_: Collaborator, User

**Companion**:
A Member of a Trip who is not its Owner.
_Avoid_: Guest, Participant

**Invite**:
A pending grant of Member access to a specific Trip, issued by the Trip's Owner and redeemed by creating (or linking) an Account. Invite-only: there is no open signup.

**Person**:
A travel-party member recorded as trip data (name, optional email, role, notes) — used for packing-list and day-plan assignments. Deliberately separate from Account/Member: a Person can exist in a trip's ledger without ever having an Account or MCP access (e.g. a child, or a non-technical travel companion), and an invited Member does not automatically become, or require, a Person record.

**Trip**:
The unit of data and of sharing. Has exactly one Owner and any number of Members (via Invite). Membership is per-trip, not tied to any persistent group — an Account can be a Member of trips owned by different people.
