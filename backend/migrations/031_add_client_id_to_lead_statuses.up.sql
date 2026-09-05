-- Same additive pattern as lead_sources (migration 030). Also gains a new
-- composite FK on created_by, mirroring the existing
-- fk_lead_statuses_created_by (tenant_id, created_by) -> users(tenant_id, id)
-- — safe to add now because migration 029 already fully backfilled
-- users.client_id before this migration runs.
ALTER TABLE lead_statuses
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE lead_statuses ls
JOIN clients c ON c.tenant_id = ls.tenant_id
SET ls.client_id = c.id
WHERE ls.client_id IS NULL;

ALTER TABLE lead_statuses
  ADD UNIQUE KEY uq_lead_statuses_client_id_id (client_id, id),
  ADD KEY idx_lead_statuses_client_id (client_id),
  ADD KEY idx_lead_statuses_client_created_by (client_id, created_by),
  ADD CONSTRAINT fk_lead_statuses_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE lead_statuses
  ADD CONSTRAINT fk_lead_statuses_created_by_client FOREIGN KEY (client_id, created_by)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
