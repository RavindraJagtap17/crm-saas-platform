-- B2B2C subscription redesign: records an Agency's own connected Razorpay
-- account, established through a proper Razorpay account-connect/
-- OAuth-style flow (never manual secret-key entry — "Client payment goes
-- to the Agency's own connected Razorpay account... Agency must connect
-- its own Razorpay account before Client plans can be purchased"). Only
-- CONFIRMED connections are recorded here — mirrors this schema's existing
-- "only confirmed state reaches this table" discipline (see
-- razorpay_webhook_events: only signature-verified events are stored).
-- Any in-progress OAuth state (redirect nonce, CSRF token, etc.) belongs
-- to application/session state, not this table. The actual OAuth flow and
-- token encryption are backend work for a later step — this migration
-- only adds the schema to receive that data once implemented.
CREATE TABLE tenant_razorpay_accounts (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                 BIGINT UNSIGNED NOT NULL,
  razorpay_account_id       VARCHAR(64) NOT NULL,
  status                    ENUM('pending', 'connected', 'disconnected') NOT NULL DEFAULT 'pending',
  -- Column names make the requirement explicit: these must never be stored
  -- as plaintext. Encryption itself is application-layer work, out of
  -- scope for this migration — matches how this backend already keeps
  -- every other real secret (Razorpay key_secret, Google client secret)
  -- out of the database entirely, in config/env only. TEXT, not VARCHAR —
  -- ciphertext length is implementation-dependent and unbounded here.
  access_token_encrypted    TEXT NULL,
  refresh_token_encrypted   TEXT NULL,
  token_expires_at          TIMESTAMP NULL,
  connected_at              TIMESTAMP NULL,
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- One connected account per agency.
  UNIQUE KEY uq_tenant_razorpay_accounts_tenant (tenant_id),
  UNIQUE KEY uq_tenant_razorpay_accounts_account_id (razorpay_account_id),

  CONSTRAINT fk_tenant_razorpay_accounts_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
