-- B2B2C subscription redesign: the ONE global Agency plan Super Admin
-- configures (price/currency only — billing_cycle is fixed to 'yearly' per
-- the approved business model: "There is exactly ONE Agency subscription
-- plan... Billing is yearly and recurring"). Deliberately NOT the same
-- table as the existing subscription_plans (018) — that table is a flat,
-- multi-row catalog with a mandatory razorpay_plan_id and an unrelated
-- max_clients column; reusing it here would either force a fake "catalog
-- of one" or repurpose a column with a different meaning. subscription_plans
-- and subscriptions (018/019) are left completely untouched by this
-- migration and continue to exist exactly as-is — existing Agency billing
-- tables must not break.
--
-- Singleton enforcement: singleton_guard is always 1, and its UNIQUE key
-- makes a second row a constraint violation rather than an
-- application-only convention — the database itself guarantees "exactly
-- one" the same way uq_subscriptions_tenant guarantees "one per tenant"
-- elsewhere in this schema. No row is inserted by this migration — the
-- actual price is a business decision for Super Admin to set later via a
-- future endpoint, never invented here.
CREATE TABLE agency_subscription_plan (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  singleton_guard   TINYINT UNSIGNED NOT NULL DEFAULT 1,
  -- Smallest currency unit (e.g. paise for INR), matching subscription_plans.price.
  price             BIGINT UNSIGNED NOT NULL,
  currency          VARCHAR(3) NOT NULL DEFAULT 'INR',
  -- VARCHAR, not ENUM — matches subscription_plans.billing_cycle's existing
  -- convention (app-validated, not DB-validated). Always 'yearly' today per
  -- the business model; stored rather than hard-coded so a future change
  -- doesn't require a schema change.
  billing_cycle     VARCHAR(20) NOT NULL DEFAULT 'yearly',
  -- Nullable: Super Admin may set the price before the corresponding Plan
  -- exists on Razorpay's own dashboard — the Razorpay integration itself
  -- is out of scope for this migration.
  razorpay_plan_id  VARCHAR(64) NULL,
  -- Emergency kill switch for new-agency signup, independent of price —
  -- mirrors subscription_plans.is_active's "removes it from new selection,
  -- never touches an existing subscriber" semantics.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_agency_subscription_plan_singleton (singleton_guard)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
