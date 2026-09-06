-- FK bug fix (see the Git-history/FK investigation report): leads,
-- lead_statuses, lead_activities, and lead_status_history each carry TWO
-- composite FKs to users for the same column — one on (tenant_id, x)
-- (from migrations 006/007/008/009) and one on (client_id, x) (from
-- migrations 031/034/035/036), added additively alongside the old ones
-- rather than replacing them. Client-level users (client_admin,
-- client_employee) always have users.tenant_id = NULL and users.client_id
-- set instead — the exact opposite of every other tenant-scoped table in
-- this schema, where tenant_id and client_id are populated together. Since
-- assigned_to/created_by/user_id/changed_by are only ever written by
-- Client-level actors (Agency Admin never touches Leads), the (tenant_id, x)
-- FK against users can never be satisfied and unconditionally rejects every
-- real write. The (client_id, x) FK already provides the correct and
-- sufficient guarantee (assignee/creator must belong to the SAME client),
-- so only the legacy (tenant_id, x) FK against users needs to go — no other
-- FK on these tables is affected (lead_statuses/lead_sources/products/leads
-- themselves always carry both tenant_id and client_id together, so their
-- own (tenant_id, x) FKs remain valid and are left untouched).
ALTER TABLE leads
  DROP FOREIGN KEY fk_leads_assigned_to;

ALTER TABLE lead_statuses
  DROP FOREIGN KEY fk_lead_statuses_created_by;

ALTER TABLE lead_activities
  DROP FOREIGN KEY fk_lead_activities_user;

ALTER TABLE lead_status_history
  DROP FOREIGN KEY fk_lsh_changed_by;
