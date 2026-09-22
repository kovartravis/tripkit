# Membership is per-Trip, not per-group

Sharing access could have been modeled as a persistent "travel group"/household that owns multiple trips over time, with membership managed once at the group level. We chose per-Trip membership instead: an Invite grants access to one specific Trip, and an Account can be a Member of trips owned by different people. This is simpler to build first and doesn't foreclose a group concept later — a group would just become a saved set of default invitees when creating a new trip — without forcing that abstraction before we know it's needed.
