-- B2B2C restructure: the new CRM-operating unit. tenants (kept, not
-- renamed) now means "agency"; clients is the new child level everything
-- currently scoped by tenant_id for CRM purposes (leads, statuses,
-- sources, products, custom fields, Meta, CAPI) moves to.
--
-- UNIQUE(tenant_id, id) mirrors the exact composite-FK-target pattern
-- already used throughout this schema (uq_leads_tenant_id_id etc.) —
-- required so web_forms' new (tenant_id, client_id) composite FK
-- (migration 040) can reference this table.
CREATE TABLE clients (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id   BIGINT UNSIGNED NOT NULL,
  name        VARCHAR(255) NOT NULL,
  status      ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_clients_tenant_id_id (tenant_id, id),
  KEY idx_clients_tenant_id (tenant_id),

  CONSTRAINT fk_clients_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Deterministic backfill: exactly one client per existing tenant, named
-- after that tenant. WHERE NOT EXISTS makes this specific INSERT safe to
-- run more than once (defense-in-depth on top of the migration runner's
-- own schema_migrations bookkeeping, which already prevents this file
-- from being applied twice in normal operation) — required so an
-- accidental re-run can never create a second client for the same tenant.
INSERT INTO clients (tenant_id, name, status)
SELECT t.id, t.name, 'active'
FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM clients c WHERE c.tenant_id = t.id);
