-- Tenant-defined lead origin tags (e.g. Meta Ads, Website Form, Referral).
CREATE TABLE lead_sources (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  type        VARCHAR(50) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_lead_sources_tenant_id (tenant_id),
  -- Referenced by leads.source_id via a composite (tenant_id, id) foreign
  -- key, so a lead can never point at another tenant's source.
  UNIQUE KEY uq_lead_sources_tenant_id_id (tenant_id, id),

  CONSTRAINT fk_lead_sources_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
