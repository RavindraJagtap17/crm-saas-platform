-- Reverses 051.up.sql exactly: re-adds the four legacy (tenant_id, x) FKs
-- against users, identical to how migrations 006/007/008/009 originally
-- defined them. This intentionally restores the bug those FKs caused for
-- every Client-level write — a down migration undoes the schema change,
-- not "undoes to a working state".
ALTER TABLE leads
  ADD CONSTRAINT fk_leads_assigned_to FOREIGN KEY (tenant_id, assigned_to)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE lead_statuses
  ADD CONSTRAINT fk_lead_statuses_created_by FOREIGN KEY (tenant_id, created_by)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE lead_activities
  ADD CONSTRAINT fk_lead_activities_user FOREIGN KEY (tenant_id, user_id)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE lead_status_history
  ADD CONSTRAINT fk_lsh_changed_by FOREIGN KEY (tenant_id, changed_by)
    REFERENCES users(tenant_id, id) ON DELETE RESTRICT ON UPDATE CASCADE;
