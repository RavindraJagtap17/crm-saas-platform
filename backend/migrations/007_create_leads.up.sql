-- The core CRM record. Every foreign key here (except tenant_id itself) is
-- composite — (tenant_id, x_id) referencing the target table's own
-- (tenant_id, id) — specifically so a lead can never point at a status,
-- source, product, assigned employee, or "duplicate of" lead belonging to
-- a different tenant. A plain single-column FK could not guarantee that.
CREATE TABLE leads (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  name                  VARCHAR(255) NULL,
  phone                 VARCHAR(32) NULL,
  email                 VARCHAR(255) NULL,
  source_id             BIGINT UNSIGNED NULL,
  product_id            BIGINT UNSIGNED NULL,
  status_id             BIGINT UNSIGNED NULL,
  assigned_to           BIGINT UNSIGNED NULL,
  custom_fields         JSON NULL,
  meta_lead_id          VARCHAR(255) NULL,
  is_duplicate          BOOLEAN NOT NULL DEFAULT FALSE,
  duplicate_of_lead_id  BIGINT UNSIGNED NULL,
  converted_at          TIMESTAMP NULL,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- meta_lead_id comes from Meta's own globally-unique leadgen_id, so a
  -- plain (non-tenant-scoped) unique index is correct here. NULLs are each
  -- treated as distinct by MySQL, so any number of non-Meta leads (NULL)
  -- coexist fine.
  UNIQUE KEY uq_leads_meta_lead_id (meta_lead_id),

  -- Required composite indexes from the Final Specification (§ Indexes) —
  -- these double as the supporting indexes their matching foreign keys need.
  KEY idx_leads_tenant_status (tenant_id, status_id),
  KEY idx_leads_tenant_assigned (tenant_id, assigned_to),
  KEY idx_leads_tenant_phone (tenant_id, phone),
  KEY idx_leads_tenant_source (tenant_id, source_id),
  KEY idx_leads_tenant_product (tenant_id, product_id),

  -- Referenced by lead_activities and lead_status_history via composite
  -- (tenant_id, id) foreign keys, and by this table's own duplicate link.
  UNIQUE KEY uq_leads_tenant_id_id (tenant_id, id),

  CONSTRAINT fk_leads_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,

  CONSTRAINT fk_leads_status FOREIGN KEY (tenant_id, status_id)
    REFERENCES lead_statuses(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_leads_source FOREIGN KEY (tenant_id, source_id)
    REFERENCES lead_sources(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT fk_leads_product FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,

  -- assigned_to must be a user in the SAME tenant. Because a super_admin's
  -- users.tenant_id is always NULL and leads.tenant_id is never NULL, this
  -- also makes it structurally impossible to assign a lead to a Super Admin.
  CONSTRAINT fk_leads_assigned_to FOREIGN KEY (tenant_id, assigned_to)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,

  -- Self-reference for duplicate flagging (§13/§14 of the spec): must point
  -- at another lead in the same tenant. RESTRICT rather than CASCADE or
  -- SET NULL — deleting a lead should never silently delete or orphan the
  -- leads that were flagged as its duplicates.
  CONSTRAINT fk_leads_duplicate_of FOREIGN KEY (tenant_id, duplicate_of_lead_id)
    REFERENCES leads(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
