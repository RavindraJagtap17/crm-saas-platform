-- Append-only audit trail of pipeline stage changes. This is also what a
-- later step uses to trigger the Meta CAPI event — not implemented here.
-- No updated_at — entries are never edited after creation.
CREATE TABLE lead_status_history (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  lead_id          BIGINT UNSIGNED NOT NULL,
  from_status_id   BIGINT UNSIGNED NULL,
  to_status_id     BIGINT UNSIGNED NOT NULL,
  changed_by       BIGINT UNSIGNED NULL,
  changed_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_lsh_tenant_lead (tenant_id, lead_id),
  KEY idx_lsh_tenant_changed_by (tenant_id, changed_by),

  CONSTRAINT fk_lsh_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lsh_lead FOREIGN KEY (tenant_id, lead_id)
    REFERENCES leads(tenant_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  -- Historical statuses are not deleted while history references them —
  -- deactivate a status (a later step's concern) rather than removing it.
  CONSTRAINT fk_lsh_from_status FOREIGN KEY (tenant_id, from_status_id)
    REFERENCES lead_statuses(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lsh_to_status FOREIGN KEY (tenant_id, to_status_id)
    REFERENCES lead_statuses(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_lsh_changed_by FOREIGN KEY (tenant_id, changed_by)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
