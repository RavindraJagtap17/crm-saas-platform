-- §M idempotency guard for the Razorpay webhook, separate from the
-- generic webhook_logs table (Step 7): Razorpay assigns a stable event id
-- (`x-razorpay-event-id`) that stays IDENTICAL across retry deliveries of
-- the same event, which is exactly what a UNIQUE constraint needs to
-- prevent double-processing. Only valid, signature-verified, parseable
-- events reach this table — an invalid signature is logged to the
-- existing webhook_logs instead (mirroring exactly how Step 7's Meta
-- webhook already separates the two concerns).
CREATE TABLE razorpay_webhook_events (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  razorpay_event_id  VARCHAR(64) NOT NULL,
  event_type         VARCHAR(100) NOT NULL,
  tenant_id          BIGINT UNSIGNED NULL,
  payload            JSON NULL,
  processed          BOOLEAN NOT NULL DEFAULT FALSE,
  error              TEXT NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_razorpay_webhook_events_event_id (razorpay_event_id),
  KEY idx_razorpay_webhook_events_tenant (tenant_id),

  CONSTRAINT fk_razorpay_webhook_events_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
