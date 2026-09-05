-- Additive pattern. Mirrors uq_meta_capi_events_tenant_lead (the §H
-- idempotency guarantee — at most one CAPI event per lead) and
-- fk_meta_capi_events_lead, now via client_id.
ALTER TABLE meta_capi_events
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE meta_capi_events mce
JOIN clients c ON c.tenant_id = mce.tenant_id
SET mce.client_id = c.id
WHERE mce.client_id IS NULL;

ALTER TABLE meta_capi_events
  ADD UNIQUE KEY uq_meta_capi_events_client_lead (client_id, lead_id),
  ADD CONSTRAINT fk_meta_capi_events_client FOREIGN KEY (client_id) REFERENCES clients(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT fk_meta_capi_events_lead_client FOREIGN KEY (client_id, lead_id)
    REFERENCES leads(client_id, id) ON DELETE CASCADE ON UPDATE CASCADE;
