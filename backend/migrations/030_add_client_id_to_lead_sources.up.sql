-- B2B2C restructure: additive only — tenant_id and its existing FKs stay
-- fully intact and functional (the currently-running, not-yet-refactored
-- application keeps working unchanged against tenant_id). client_id is
-- added, backfilled, and given its own composite-key readiness for
-- leads.source_id's new FK (migration 034). Dropping tenant_id from this
-- table is a later cleanup migration, once Phase C's backend refactor and
-- regression testing are both complete.
ALTER TABLE lead_sources
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE lead_sources ls
JOIN clients c ON c.tenant_id = ls.tenant_id
SET ls.client_id = c.id
WHERE ls.client_id IS NULL;

ALTER TABLE lead_sources
  ADD UNIQUE KEY uq_lead_sources_client_id_id (client_id, id),
  ADD KEY idx_lead_sources_client_id (client_id),
  ADD CONSTRAINT fk_lead_sources_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;
