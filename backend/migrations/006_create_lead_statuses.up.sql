-- Tenant-defined pipeline stages (e.g. Hot, Warm, Converted, Scrap).
CREATE TABLE lead_statuses (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  color       VARCHAR(7) NULL,
  sort_order  INT NOT NULL DEFAULT 0,
  is_final    BOOLEAN NOT NULL DEFAULT FALSE,
  created_by  BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_lead_statuses_tenant_id (tenant_id),
  -- Referenced by leads.status_id and lead_status_history via composite
  -- (tenant_id, id) foreign keys.
  UNIQUE KEY uq_lead_statuses_tenant_id_id (tenant_id, id),
  KEY idx_lead_statuses_tenant_created_by (tenant_id, created_by),

  CONSTRAINT fk_lead_statuses_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- Composite: the user who created this status must belong to the same
  -- tenant the status belongs to — a plain users.id FK could not guarantee that.
  CONSTRAINT fk_lead_statuses_created_by FOREIGN KEY (tenant_id, created_by)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
