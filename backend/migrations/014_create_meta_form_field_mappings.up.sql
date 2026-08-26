-- Maps a Meta lead form's raw field key to a CRM field key (§F). Two
-- different Meta forms can map different raw labels onto the same CRM
-- key. crm_field_key is validated at the application layer, not via FK —
-- it's either a fixed core key (name/phone/email) or a tenant's own
-- custom_field_definitions.field_key, and those two are different tables
-- with no single column to reference.
CREATE TABLE meta_form_field_mappings (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  meta_form_id    VARCHAR(64) NOT NULL,
  meta_field_key  VARCHAR(255) NOT NULL,
  crm_field_key   VARCHAR(100) NOT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- A given raw Meta field on a given form maps to exactly one CRM key.
  UNIQUE KEY uq_mffm_tenant_form_field (tenant_id, meta_form_id, meta_field_key),
  KEY idx_mffm_tenant (tenant_id),

  CONSTRAINT fk_mffm_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
