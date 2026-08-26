-- Append-only payment ledger, reconciled from webhook-confirmed Razorpay
-- events only (§G/§L) — never from a client-reported result. Deliberately
-- narrow: no card number, CVV, expiry, or any other raw payment-method
-- detail is ever collected by this backend (Razorpay Checkout handles all
-- of that directly with Razorpay) or has a column here to hold it.
CREATE TABLE payments (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  subscription_id     BIGINT UNSIGNED NOT NULL,
  razorpay_payment_id VARCHAR(64) NOT NULL,
  razorpay_order_id   VARCHAR(64) NULL,
  -- Smallest currency unit, matching Razorpay's own `amount` and
  -- subscription_plans.price.
  amount              BIGINT UNSIGNED NOT NULL,
  currency            VARCHAR(3) NOT NULL DEFAULT 'INR',
  status              ENUM('created', 'authorized', 'captured', 'refunded', 'failed') NOT NULL,
  paid_at             TIMESTAMP NULL,
  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- §M: the idempotency guarantee for this table — a retried/duplicate
  -- webhook for the same Razorpay payment can never create a second row.
  UNIQUE KEY uq_payments_razorpay_payment_id (razorpay_payment_id),
  KEY idx_payments_tenant (tenant_id),
  KEY idx_payments_subscription (subscription_id),

  CONSTRAINT fk_payments_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
