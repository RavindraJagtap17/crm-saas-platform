-- Additive pattern, mirroring existing fk_lead_activities_lead
-- (tenant_id, lead_id) and fk_lead_activities_user (tenant_id, user_id).
ALTER TABLE lead_activities
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE lead_activities la
JOIN clients c ON c.tenant_id = la.tenant_id
SET la.client_id = c.id
WHERE la.client_id IS NULL;

ALTER TABLE lead_activities
  ADD KEY idx_lead_activities_client_lead (client_id, lead_id),
  ADD KEY idx_lead_activities_client_user (client_id, user_id),
  ADD CONSTRAINT fk_lead_activities_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lead_activities_lead_client FOREIGN KEY (client_id, lead_id)
    REFERENCES leads(client_id, id) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lead_activities_user_client FOREIGN KEY (client_id, user_id)
    REFERENCES users(client_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
