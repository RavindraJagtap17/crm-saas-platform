-- Platform-level audit trail for Super Admin actions (Final Specification
-- requirement, added in the post-Step-10 hardening pass). Deliberately
-- NOT tenant-owned in the usual sense of this schema: the ACTOR (user_id)
-- is always a super_admin, whose own users.tenant_id is NULL by design —
-- tenant_id here instead records which tenant a given action AFFECTED
-- (null for actions with no single target tenant, e.g. plan-catalog
-- changes). A plain FK on each column is therefore correct, not the
-- composite (tenant_id, x_id) pattern used elsewhere in this schema for
-- genuinely tenant-owned rows (see docs/API.md's Step 10 tenant-isolation
-- notes) — this table exists precisely to see ACROSS tenants.
CREATE TABLE audit_logs (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NULL,
  user_id      BIGINT UNSIGNED NOT NULL,
  action       VARCHAR(100) NOT NULL,
  entity_type  VARCHAR(50) NOT NULL,
  entity_id    BIGINT UNSIGNED NOT NULL,
  meta         JSON NULL,
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  KEY idx_audit_logs_tenant (tenant_id),
  KEY idx_audit_logs_user (user_id),
  KEY idx_audit_logs_entity (entity_type, entity_id),
  KEY idx_audit_logs_created (created_at),

  CONSTRAINT fk_audit_logs_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  -- RESTRICT, not CASCADE: users are only ever deactivated in this system
  -- (no hard-delete path exists), but an audit trail should never be able
  -- to silently vanish alongside the account that created it regardless.
  CONSTRAINT fk_audit_logs_user FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
