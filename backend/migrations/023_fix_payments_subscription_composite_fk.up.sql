-- Step 10 hardening: payments.subscription_id was a plain single-column FK
-- to subscriptions(id) — structurally it could reference ANY tenant's
-- subscription row, relying entirely on application code (which today
-- always derives both ids from the same already-tenant-scoped row) to
-- keep them consistent. Every other tenant-owned-to-tenant-owned
-- reference in this schema uses a composite (tenant_id, x_id) ->
-- (tenant_id, id) FK specifically so that can never be just a convention.
-- Brings payments.subscription_id in line with that same guarantee, now
-- that migration 022 gives subscriptions the (tenant_id, id) key this
-- composite FK needs to reference.
-- Split into two statements — MySQL rejects dropping and re-adding a
-- foreign key with the identical name within one ALTER TABLE.
ALTER TABLE payments
  DROP FOREIGN KEY fk_payments_subscription,
  ADD KEY idx_payments_tenant_subscription (tenant_id, subscription_id);

ALTER TABLE payments
  ADD CONSTRAINT fk_payments_subscription FOREIGN KEY (tenant_id, subscription_id)
    REFERENCES subscriptions(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
