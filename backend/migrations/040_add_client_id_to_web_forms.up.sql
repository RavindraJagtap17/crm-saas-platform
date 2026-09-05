-- B2B2C restructure: web_forms is the one DUAL-scoped table — tenant_id
-- (the managing agency, KEPT, unchanged) plus the new client_id (the
-- target client the form's leads belong to). The composite FK below is
-- the structural guarantee that a form can never target a client
-- belonging to a DIFFERENT agency than the one managing it — an Agency
-- Admin's own tenant_id and their selected client_id must jointly resolve
-- to a real (tenant_id, client) pair, which is only possible if that
-- client actually belongs to that agency. This is what makes "Agency
-- Admin may only select their own clients" enforceable by the database,
-- not just application logic.
ALTER TABLE web_forms
  ADD COLUMN client_id BIGINT UNSIGNED NULL AFTER tenant_id;

UPDATE web_forms wf
JOIN clients c ON c.tenant_id = wf.tenant_id
SET wf.client_id = c.id
WHERE wf.client_id IS NULL;

ALTER TABLE web_forms
  ADD KEY idx_web_forms_client_id (client_id),
  ADD KEY idx_web_forms_tenant_client (tenant_id, client_id),
  ADD CONSTRAINT fk_web_forms_client_agency FOREIGN KEY (tenant_id, client_id)
    REFERENCES clients(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
