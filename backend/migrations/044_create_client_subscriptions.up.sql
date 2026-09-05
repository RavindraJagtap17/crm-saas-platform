-- B2B2C subscription redesign: one CURRENT subscription per Client,
-- updated in place across its lifecycle — mirrors the existing
-- subscriptions table's shape (019) one level down, using the new
-- business model's status vocabulary directly (PENDING/ACTIVE/
-- GRACE_PERIOD/CANCELLED/EXPIRED — Razorpay has no native GRACE_PERIOD
-- concept, so this is an explicit local state machine, not a mirror of a
-- Razorpay enum the way the old subscriptions.status is).
--
-- tenant_id is redundant with client_subscription_plans.tenant_id /
-- clients.tenant_id but required in place, exactly like payments.tenant_id
-- (020) — it is what lets BOTH FKs below be expressed as the composite
-- (tenant_id, x_id) -> (tenant_id, id) pattern, which is what makes it
-- structurally impossible (not just conventionally unlikely) for a
-- client's subscription to reference another agency's client or another
-- agency's plan.
CREATE TABLE client_subscriptions (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                 BIGINT UNSIGNED NOT NULL,
  client_id                 BIGINT UNSIGNED NOT NULL,
  plan_id                   BIGINT UNSIGNED NOT NULL,
  -- Nullable: a row is created in 'pending' status as soon as a Client
  -- selects a plan, before any Razorpay checkout has necessarily begun
  -- ("Client CRM access remains locked" until payment — the row must be
  -- able to exist to represent that locked-pending state).
  razorpay_subscription_id  VARCHAR(64) NULL,
  razorpay_customer_id      VARCHAR(64) NULL,
  status                    ENUM('pending', 'active', 'grace_period', 'cancelled', 'expired')
                               NOT NULL DEFAULT 'pending',
  current_period_end        TIMESTAMP NULL,
  grace_period_ends_at      TIMESTAMP NULL,
  -- "Cancellation disables auto-renewal. Client continues using CRM until
  -- the already-paid billing period ends" — auto_renew=false with status
  -- still 'active' represents exactly that in-between state; a separate
  -- scheduled process (out of scope here) flips status to 'expired' once
  -- current_period_end passes with auto_renew false.
  auto_renew                BOOLEAN NOT NULL DEFAULT TRUE,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- "One active/current subscription per Client" — enforced at the
  -- database level exactly like uq_subscriptions_tenant does for tenants.
  UNIQUE KEY uq_client_subscriptions_client (client_id),
  UNIQUE KEY uq_client_subscriptions_razorpay_subscription_id (razorpay_subscription_id),
  -- Composite-FK target for client_payments (045).
  UNIQUE KEY uq_client_subscriptions_tenant_id_id (tenant_id, id),
  KEY idx_client_subscriptions_tenant (tenant_id),
  -- Covering indexes for the two composite FKs below (MySQL requires a
  -- leading index on the FK's own columns) — same pairing style as
  -- web_forms' idx_web_forms_client_id / idx_web_forms_tenant_client (040).
  KEY idx_client_subscriptions_tenant_client (tenant_id, client_id),
  KEY idx_client_subscriptions_tenant_plan (tenant_id, plan_id),

  -- Guarantees this subscription's client actually belongs to tenant_id.
  CONSTRAINT fk_client_subscriptions_tenant_client FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Guarantees this subscription's plan belongs to the SAME agency as the
  -- client — the core cross-agency isolation guarantee for this table.
  -- RESTRICT: "Preserve plan history; do not destructively delete plans
  -- referenced by subscriptions" — a plan referenced here can only ever be
  -- deactivated (is_active=false), never deleted, exactly matching
  -- fk_subscriptions_plan's existing RESTRICT convention.
  CONSTRAINT fk_client_subscriptions_tenant_plan FOREIGN KEY (tenant_id, plan_id)
    REFERENCES client_subscription_plans(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
