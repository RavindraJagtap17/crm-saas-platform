-- Additive pattern, mirroring existing fk_lsh_lead, fk_lsh_changed_by,
-- fk_lsh_from_status, fk_lsh_to_status (all tenant_id, x today).
ALTER TABLE lead_status_history
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE lead_status_history lsh
JOIN clients c ON c.tenant_id = lsh.tenant_id
SET lsh.client_id = c.id
WHERE lsh.client_id IS NULL;

ALTER TABLE lead_status_history
  ADD KEY idx_lsh_client_lead (client_id, lead_id),
  ADD KEY idx_lsh_client_changed_by (client_id, changed_by),
  ADD KEY idx_lsh_client_from_status (client_id, from_status_id),
  ADD KEY idx_lsh_client_to_status (client_id, to_status_id),
  ADD CONSTRAINT fk_lsh_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lsh_lead_client FOREIGN KEY (client_id, lead_id)
    REFERENCES leads(client_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lsh_changed_by_client FOREIGN KEY (client_id, changed_by)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lsh_from_status_client FOREIGN KEY (client_id, from_status_id)
    REFERENCES lead_statuses(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lsh_to_status_client FOREIGN KEY (client_id, to_status_id)
    REFERENCES lead_statuses(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
