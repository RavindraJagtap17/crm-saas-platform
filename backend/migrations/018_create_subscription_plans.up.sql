-- The LOCAL CRM plan catalog — distinct from Razorpay's own Plan object
-- (razorpay_plan_id references one, but Razorpay Plans are immutable once
-- created there; this table is what Super Admin can actually manage).
-- price/currency/billing_cycle are descriptive metadata entered by Super
-- Admin to match what they configured in the Razorpay Dashboard when they
-- created the corresponding Plan — never invented, never computed here.
CREATE TABLE subscription_plans (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(255) NOT NULL,
  -- Smallest currency unit (e.g. paise for INR), matching how Razorpay
  -- itself represents `amount` — avoids float rounding entirely.
  price             BIGINT UNSIGNED NOT NULL,
  currency          VARCHAR(3) NOT NULL DEFAULT 'INR',
  billing_cycle     VARCHAR(20) NOT NULL,
  features          JSON NULL,
  -- Required: Razorpay's Subscription-creation API takes a Plan ID, not a
  -- price — every local plan a tenant can actually subscribe to must
  -- reference one. Never stored inside `features`.
  razorpay_plan_id  VARCHAR(64) NOT NULL,
  -- Deactivating a plan removes it from what new subscribers can select
  -- without touching Razorpay at all (§B: Razorpay Plans can't be
  -- edited/deleted) — existing subscriptions on a retired plan are
  -- unaffected until changed/cancelled through normal subscription ops.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_subscription_plans_razorpay_plan_id (razorpay_plan_id),
  KEY idx_subscription_plans_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
