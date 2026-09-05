-- B2B2C restructure — the core table. Additive only: tenant_id and all
-- its existing FKs/indexes stay fully intact (currently-running app keeps
-- working unchanged). client_id is added, backfilled, and given the same
-- five composite FKs leads already has via tenant_id — source, status,
-- product, assigned_to, and the self-referencing duplicate_of_lead_id —
-- now mirrored via client_id. meta_lead_id's platform-wide UNIQUE index
-- (needed for Step 7's cross-client webhook idempotency) is untouched.
ALTER TABLE leads
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE leads l
JOIN clients c ON c.tenant_id = l.tenant_id
SET l.client_id = c.id
WHERE l.client_id IS NULL;

ALTER TABLE leads
  ADD UNIQUE KEY uq_leads_client_id_id (client_id, id),
  ADD KEY idx_leads_client_id (client_id),
  ADD KEY idx_leads_client_status (client_id, status_id),
  ADD KEY idx_leads_client_assigned (client_id, assigned_to),
  ADD KEY idx_leads_client_phone (client_id, phone),
  ADD KEY idx_leads_client_source (client_id, source_id),
  ADD KEY idx_leads_client_product (client_id, product_id),
  ADD CONSTRAINT fk_leads_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Split into a second statement — the self-referencing FK on
-- duplicate_of_lead_id needs uq_leads_client_id_id (added just above) to
-- already exist; keeping every new FK addition in one preceding statement
-- and the self-reference in its own avoids any same-statement ordering
-- ambiguity.
ALTER TABLE leads
  ADD CONSTRAINT fk_leads_source_client FOREIGN KEY (client_id, source_id)
    REFERENCES lead_sources(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_leads_status_client FOREIGN KEY (client_id, status_id)
    REFERENCES lead_statuses(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_leads_product_client FOREIGN KEY (client_id, product_id)
    REFERENCES products(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_leads_assigned_to_client FOREIGN KEY (client_id, assigned_to)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_leads_duplicate_of_client FOREIGN KEY (client_id, duplicate_of_lead_id)
    REFERENCES leads(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
