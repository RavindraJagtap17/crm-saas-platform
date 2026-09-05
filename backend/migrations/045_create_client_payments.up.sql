-- B2B2C subscription redesign: append-only Client payment ledger — the
-- exact same shape/discipline as the existing payments table (020:
-- webhook-confirmed only, never a client-reported result; no raw
-- payment-method detail ever stored), scoped one level down to Client
-- subscriptions instead of Agency ones. The existing payments table is
-- left completely untouched (existing Agency billing tables must not
-- break) and continues to record Agency-level payments only.
CREATE TABLE client_payments (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  -- Redundant with clients.tenant_id / client_subscriptions.tenant_id but
  -- required in place — same reasoning as client_subscriptions.tenant_id
  -- and the existing payments.tenant_id (020).
  tenant_id                BIGINT UNSIGNED NOT NULL,
  client_id                BIGINT UNSIGNED NOT NULL,
  client_subscription_id   BIGINT UNSIGNED NOT NULL,
  razorpay_payment_id      VARCHAR(64) NOT NULL,
  razorpay_order_id        VARCHAR(64) NULL,
  -- Smallest currency unit, matching payments.amount / client_subscription_plans.price.
  amount                   BIGINT UNSIGNED NOT NULL,
  currency                 VARCHAR(3) NOT NULL DEFAULT 'INR',
  status                   ENUM('created', 'authorized', 'captured', 'refunded', 'failed') NOT NULL,
  paid_at                  TIMESTAMP NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Idempotency guarantee, identical purpose to uq_payments_razorpay_payment_id.
  UNIQUE KEY uq_client_payments_razorpay_payment_id (razorpay_payment_id),
  KEY idx_client_payments_tenant (tenant_id),
  KEY idx_client_payments_client (client_id),
  KEY idx_client_payments_tenant_client (tenant_id, client_id),
  KEY idx_client_payments_tenant_subscription (tenant_id, client_subscription_id),

  CONSTRAINT fk_client_payments_tenant_client FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_client_payments_tenant_subscription FOREIGN KEY (tenant_id, client_subscription_id)
    REFERENCES client_subscriptions(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
