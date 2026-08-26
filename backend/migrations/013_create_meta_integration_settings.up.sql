-- Step 7: one row per tenant's connected Meta account. Each tenant
-- connects its OWN Meta assets — there is no shared/global Meta account.
-- page_id is UNIQUE (not just indexed) deliberately: this is what makes
-- webhook tenant resolution (page_id -> tenant) unambiguous by
-- construction, not just by convention.
CREATE TABLE meta_integration_settings (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id               BIGINT UNSIGNED NOT NULL,
  ad_account_id           VARCHAR(64) NULL,
  page_id                 VARCHAR(64) NOT NULL,
  page_name               VARCHAR(255) NULL,
  -- Never a raw token — always AES-256-GCM ciphertext (iv + authTag +
  -- data, base64-encoded) via backend/src/utils/encryption.js. Never
  -- selected into any API response.
  access_token_encrypted  TEXT NOT NULL,
  token_expires_at        TIMESTAMP NULL,
  created_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- One Meta connection per tenant.
  UNIQUE KEY uq_meta_integration_tenant (tenant_id),
  -- One tenant per Meta page — the unambiguous-resolution guarantee.
  UNIQUE KEY uq_meta_integration_page (page_id),

  CONSTRAINT fk_meta_integration_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
