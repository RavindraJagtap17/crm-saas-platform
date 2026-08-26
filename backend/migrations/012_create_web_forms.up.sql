-- Step 6: one row per embeddable website enquiry form. form_key is the
-- public, opaque identifier a script/iframe embed carries — it is the
-- ONLY thing the public API uses to resolve a tenant, source, and
-- product; the tenant is never accepted from the public request itself.
CREATE TABLE web_forms (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  form_key         CHAR(32) NOT NULL,
  name             VARCHAR(255) NOT NULL,
  source_id        BIGINT UNSIGNED NOT NULL,
  product_id       BIGINT UNSIGNED NULL,
  allowed_domains  JSON NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Global, not tenant-scoped: the public submit endpoint has no tenant
  -- context to scope by yet — resolving the tenant IS what this lookup does.
  UNIQUE KEY uq_web_forms_form_key (form_key),
  KEY idx_web_forms_tenant_id (tenant_id),

  CONSTRAINT fk_web_forms_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- Composite, matching the pattern already used by leads: a form's
  -- source/product must belong to the SAME tenant as the form itself.
  CONSTRAINT fk_web_forms_source FOREIGN KEY (tenant_id, source_id)
    REFERENCES lead_sources(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_web_forms_product FOREIGN KEY (tenant_id, product_id)
    REFERENCES products(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
