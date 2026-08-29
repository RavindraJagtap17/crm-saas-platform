-- Step 10 hardening: every other tenant-owned table referenced by another
-- tenant-owned table's composite FK (leads, lead_sources, lead_statuses,
-- users, products, ...) exposes a UNIQUE (tenant_id, id) key specifically
-- so that referencing FK can be declared as (tenant_id, x_id) ->
-- (tenant_id, id) — the pattern that makes it structurally impossible for
-- a row to reference another tenant's parent row, not just conventionally
-- unlikely. subscriptions was missed when it was created (Step 9) — its
-- existing UNIQUE(tenant_id) alone guarantees the same uniqueness but
-- doesn't have `id` as a covered column, so MySQL can't use it as the
-- target of a composite FK. Added here so migration 023 can fix
-- payments.subscription_id's FK to match the established convention.
ALTER TABLE subscriptions
  ADD UNIQUE KEY uq_subscriptions_tenant_id_id (tenant_id, id);
