-- Each tenant's own extra lead fields (§14/§15 of the spec). field_type is
-- an ENUM specifically so the database itself makes a file/document-upload
-- type impossible to store, not just the application layer.
CREATE TABLE custom_field_definitions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  field_key   VARCHAR(100) NOT NULL,
  label       VARCHAR(255) NOT NULL,
  field_type  ENUM('text', 'select', 'number', 'date', 'textarea') NOT NULL,
  options     JSON NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_cfd_tenant_id (tenant_id),
  -- A tenant can't define the same field_key twice — it's what leads.custom_fields
  -- values are keyed by, so a duplicate would be ambiguous.
  UNIQUE KEY uq_cfd_tenant_field_key (tenant_id, field_key),

  CONSTRAINT fk_cfd_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
