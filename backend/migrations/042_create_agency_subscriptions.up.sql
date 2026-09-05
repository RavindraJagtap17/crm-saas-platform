-- B2B2C subscription redesign: per-agency subscription STATE under the new
-- business model's status vocabulary (PENDING/ACTIVE/GRACE_PERIOD/
-- CANCELLED/EXPIRED) — distinct from the existing subscriptions table
-- (019), which mirrors Razorpay's own 9-value Subscription status directly
-- and has no grace-period concept. That table is left untouched (existing
-- Agency billing tables must not break); this is the new model's parallel
-- representation, referencing the new singleton agency_subscription_plan
-- (041) instead of the old subscription_plans catalog.
--
-- One row per tenant, updated in place across its lifecycle — exactly the
-- same shape/guarantee as subscriptions.uq_subscriptions_tenant.
-- grace_period_ends_at implements "Failed Agency renewal gets a 7-day
-- grace period" — the 7-day computation itself is application logic (out
-- of scope here); this column only stores the resulting deadline.
-- auto_renew implements "Agency cancellation stops future renewal but does
-- not immediately terminate already-paid access" (cancel = auto_renew
-- false, status stays 'active' until current_period_end).
CREATE TABLE agency_subscriptions (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                 BIGINT UNSIGNED NOT NULL,
  plan_id                   BIGINT UNSIGNED NOT NULL,
  -- Nullable: a row can exist in 'pending' status before Razorpay checkout
  -- has even been initiated (unlike the old subscriptions table, which is
  -- only ever created once Razorpay confirms a subscription id).
  razorpay_subscription_id  VARCHAR(64) NULL,
  razorpay_customer_id      VARCHAR(64) NULL,
  status                    ENUM('pending', 'active', 'grace_period', 'cancelled', 'expired')
                               NOT NULL DEFAULT 'pending',
  current_period_end        TIMESTAMP NULL,
  grace_period_ends_at      TIMESTAMP NULL,
  auto_renew                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_agency_subscriptions_tenant (tenant_id),
  UNIQUE KEY uq_agency_subscriptions_razorpay_subscription_id (razorpay_subscription_id),
  -- Exposed for the same reason migration 022 added it to the old
  -- subscriptions table: lets a future tenant-owned child table (e.g. an
  -- agency-side payments ledger, if ever added) target this row via the
  -- established (tenant_id, x_id) -> (tenant_id, id) composite-FK pattern.
  UNIQUE KEY uq_agency_subscriptions_tenant_id_id (tenant_id, id),
  KEY idx_agency_subscriptions_plan (plan_id),

  CONSTRAINT fk_agency_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT: the one Agency plan is edited in place, never deleted — kept
  -- as a safety net matching fk_subscriptions_plan's existing convention.
  CONSTRAINT fk_agency_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES agency_subscription_plan(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
