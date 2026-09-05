-- B2B2C restructure — user scope model:
--   super_admin:      tenant_id = NULL, client_id = NULL
--   agency_admin:     tenant_id = agency, client_id = NULL   (unchanged shape)
--   client_admin/employee: tenant_id = NULL, client_id = client (NEW)
--
-- tenant_id is deliberately NOT duplicated onto client-level users — their
-- owning agency is always derivable via clients.tenant_id (migration 026),
-- avoiding a redundant column that could drift. The application layer
-- (Phase C) resolves it into the JWT at token-issuance time instead.
--
-- UNIQUE(client_id, id) mirrors the existing UNIQUE(tenant_id, id) on this
-- same table — required so leads.assigned_to, lead_activities.user_id,
-- lead_status_history.changed_by, and lead_statuses.created_by can each
-- gain a (client_id, x) -> users(client_id, id) composite FK in later
-- migrations, exactly mirroring their existing (tenant_id, x) FKs.
ALTER TABLE users
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

ALTER TABLE users
  ADD UNIQUE KEY uq_users_client_id_id (client_id, id),
  ADD KEY idx_users_client_id (client_id),
  ADD CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
