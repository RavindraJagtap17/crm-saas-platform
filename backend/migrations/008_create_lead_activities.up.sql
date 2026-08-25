-- Append-only activity log: call remarks and (later) assignment history.
-- No updated_at — entries are never edited after creation.
CREATE TABLE lead_activities (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  lead_id     BIGINT UNSIGNED NOT NULL,
  user_id     BIGINT UNSIGNED NULL,
  type        VARCHAR(50) NOT NULL,
  remarks     TEXT NULL,
  outcome     VARCHAR(255) NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_lead_activities_tenant_lead (tenant_id, lead_id),
  KEY idx_lead_activities_tenant_user (tenant_id, user_id),

  CONSTRAINT fk_lead_activities_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- A lead's activity history is meaningless without the lead, so it goes
  -- with it if the lead is ever deleted.
  CONSTRAINT fk_lead_activities_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES leads(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- The acting user is not deleted along with their history — see the
  -- users table's status column (deactivated) for how accounts are retired.
  CONSTRAINT fk_lead_activities_user FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
