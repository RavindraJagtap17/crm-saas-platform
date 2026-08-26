-- One CURRENT subscription per tenant — updated in place as its lifecycle
-- advances (created -> authenticated -> active -> ... ), not appended to.
-- `payments` (next migration) is the append-only ledger of individual
-- payment events against it. `status` mirrors Razorpay's own Subscription
-- status vocabulary directly (no local translation layer) so webhook
-- reconciliation is a straight assignment — see docs/API.md for how this
-- differs from the separate, simpler tenants.status gate.
CREATE TABLE subscriptions (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                 BIGINT UNSIGNED NOT NULL,
  plan_id                   BIGINT UNSIGNED NOT NULL,
  razorpay_subscription_id  VARCHAR(64) NOT NULL,
  razorpay_customer_id      VARCHAR(64) NOT NULL,
  status                    ENUM('created', 'authenticated', 'active', 'pending', 'halted',
                                  'cancelled', 'completed', 'expired', 'paused')
                              NOT NULL DEFAULT 'created',
  current_period_end        TIMESTAMP NULL,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- "One current subscription per tenant" (§A) — enforced at the database
  -- level, not just by application convention.
  UNIQUE KEY uq_subscriptions_tenant (tenant_id),
  UNIQUE KEY uq_subscriptions_razorpay_subscription_id (razorpay_subscription_id),
  KEY idx_subscriptions_plan (plan_id),

  CONSTRAINT fk_subscriptions_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT: a local plan is deactivated, never deleted, so this should
  -- never actually fire — kept as a safety net, matching the fk_leads_status
  -- convention elsewhere in this schema.
  CONSTRAINT fk_subscriptions_plan FOREIGN KEY (plan_id) REFERENCES subscription_plans(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
