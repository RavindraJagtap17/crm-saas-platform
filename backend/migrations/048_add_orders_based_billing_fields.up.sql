-- Orders-based Client billing (Step 8 design): client_subscriptions gains
-- the fields a self-managed recurring-Order engine needs that migration 044
-- (built around a Subscriptions-object model later found unsupported for a
-- connected Agency account under Technology Partner OAuth — see the Step
-- 7/8 Razorpay verification) did not anticipate. razorpay_subscription_id
-- stays in place, unused, per 001-047 immutability — never repurposed,
-- never dropped. razorpay_customer_id / current_period_end /
-- grace_period_ends_at / auto_renew / plan_id are all unchanged and remain
-- exactly as they were.
ALTER TABLE client_subscriptions
  -- Identifies the Razorpay Order currently awaiting payment for this
  -- subscription's current pending action (initial purchase, a renewal, or
  -- an upgrade) — the join key a webhook uses to resolve which subscription
  -- an order.paid/payment.captured event belongs to BEFORE any
  -- client_payments row exists (that table's razorpay_payment_id is NOT
  -- NULL, so a row can only be inserted once a real payment attempt
  -- exists). Cleared once the order is resolved (paid, or superseded by a
  -- new one).
  ADD COLUMN pending_razorpay_order_id VARCHAR(64) NULL AFTER razorpay_customer_id,
  -- A requested downgrade's target plan, applied by the (not-yet-built)
  -- renewal job in place of plan_id at the next renewal — plan_id itself is
  -- deliberately left untouched until then, so "current plan remains active
  -- until current period ends" is a guarantee the schema itself enforces,
  -- not just application discipline.
  ADD COLUMN next_plan_id BIGINT UNSIGNED NULL AFTER plan_id,
  -- Snapshot of the price actually being charged for the CURRENT billing
  -- period, captured when the subscription enters/renews into 'active' —
  -- read at renewal time instead of the live client_subscription_plans.price
  -- so a later Agency Admin price edit can never silently change what an
  -- already-active subscription is charged mid-cycle ("existing Client
  -- subscription keeps current terms through its current paid period").
  ADD COLUMN current_price BIGINT UNSIGNED NULL AFTER grace_period_ends_at,
  -- The current billing period's start — paired with current_period_end to
  -- give prorated-upgrade calculations an actual cycle length to divide by,
  -- which current_period_end alone cannot provide.
  ADD COLUMN current_period_start TIMESTAMP NULL AFTER current_price;

ALTER TABLE client_subscriptions
  -- Composite-FK covering index, exactly mirroring plan_id's own
  -- idx_client_subscriptions_tenant_plan — required so next_plan_id can
  -- carry the SAME tenant-ownership guarantee plan_id already has: a
  -- downgrade can only ever target a plan belonging to the client's own
  -- agency, never another agency's.
  ADD KEY idx_client_subscriptions_tenant_next_plan (tenant_id, next_plan_id),
  -- Nullable-safe unique key, same style as
  -- uq_client_subscriptions_razorpay_subscription_id — at most one
  -- subscription may ever point at a given outstanding order id.
  ADD UNIQUE KEY uq_client_subscriptions_pending_razorpay_order_id (pending_razorpay_order_id),
  -- RESTRICT: "Preserve plan history; do not destructively delete plans
  -- referenced by subscriptions" applies to a pending downgrade target
  -- exactly as it already does to plan_id — a plan referenced here can only
  -- ever be deactivated, never deleted, matching
  -- fk_client_subscriptions_tenant_plan's existing convention precisely.
  ADD CONSTRAINT fk_client_subscriptions_tenant_next_plan FOREIGN KEY (tenant_id, next_plan_id)
    REFERENCES client_subscription_plans(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

-- tenant_razorpay_accounts: the connected Agency account's own webhook
-- secret (Step 8 design). A DIFFERENT secret from the OAuth app-level one
-- already used for account.app.authorization_revoked
-- (config.razorpayPartner.webhookSecret, config-only) and from the
-- platform's own RAZORPAY_WEBHOOK_SECRET — Razorpay documents
-- application-level Partner webhooks and per-sub-merchant-account webhooks
-- as configured independently, each with its own secret (see Step 5's
-- webhook research), so Order/Payment events on THIS Agency's connected
-- account need this account's own secret, not shared with any other
-- webhook in this schema. TEXT + "_encrypted" naming, matching
-- access_token_encrypted/refresh_token_encrypted exactly: never stored as
-- plaintext; encryption itself is application-layer work for a later step.
ALTER TABLE tenant_razorpay_accounts
  ADD COLUMN webhook_secret_encrypted TEXT NULL AFTER refresh_token_encrypted;
