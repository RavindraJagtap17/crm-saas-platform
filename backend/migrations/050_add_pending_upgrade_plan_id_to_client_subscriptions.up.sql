-- Step 10: safely remembers "which plan a pending UPGRADE Order is paying
-- for" — deliberately a NEW, separate field from next_plan_id (which
-- means "scheduled downgrade at next renewal", a different concept with
-- different timing/semantics; never repurposed for this). An upgrade must
-- not change plan_id/current_price until the webhook confirms payment
-- (Step 10 business rule), so this is the only local record of the
-- upgrade's target plan between Order creation and that confirmation —
-- cleared together with pending_razorpay_order_id on success (activated)
-- or on a fresh retry (replaced), exactly mirroring how
-- pending_razorpay_order_id itself is managed.
ALTER TABLE client_subscriptions
  ADD COLUMN pending_upgrade_plan_id BIGINT UNSIGNED NULL AFTER pending_razorpay_order_id;

ALTER TABLE client_subscriptions
  -- Composite-FK covering index, mirroring next_plan_id's own
  -- idx_client_subscriptions_tenant_next_plan exactly — same reasoning:
  -- an upgrade can only ever target a plan belonging to the client's own
  -- agency.
  ADD KEY idx_client_subscriptions_tenant_pending_upgrade_plan (tenant_id, pending_upgrade_plan_id),
  -- RESTRICT: same "preserve plan history, never destructively delete a
  -- plan referenced by a subscription" convention already applied to
  -- plan_id/next_plan_id.
  ADD CONSTRAINT fk_client_subscriptions_tenant_pending_upgrade_plan FOREIGN KEY (tenant_id, pending_upgrade_plan_id)
    REFERENCES client_subscription_plans(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
