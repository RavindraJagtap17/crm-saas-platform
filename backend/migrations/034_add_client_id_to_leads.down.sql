ALTER TABLE leads DROP FOREIGN KEY fk_leads_source_client;
ALTER TABLE leads DROP FOREIGN KEY fk_leads_status_client;
ALTER TABLE leads DROP FOREIGN KEY fk_leads_product_client;
ALTER TABLE leads DROP FOREIGN KEY fk_leads_assigned_to_client;
ALTER TABLE leads DROP FOREIGN KEY fk_leads_duplicate_of_client;
ALTER TABLE leads DROP FOREIGN KEY fk_leads_client;

-- fk_leads_duplicate_of_client (client_id, duplicate_of_lead_id) had no
-- explicit covering index (unlike source/status/product/assigned_to,
-- which reuse idx_leads_client_*), so InnoDB auto-created one under the
-- constraint's own name when it was added. Dropping the FOREIGN KEY above
-- does NOT drop that auto-created index — it must be dropped explicitly,
-- or a later re-apply of this migration's up.sql fails with "Duplicate
-- key name" trying to re-add a constraint under an already-taken index
-- name. Found and fixed via the disposable-database rollback test.
ALTER TABLE leads DROP KEY fk_leads_duplicate_of_client;

ALTER TABLE leads DROP KEY uq_leads_client_id_id;
ALTER TABLE leads DROP KEY idx_leads_client_id;
ALTER TABLE leads DROP KEY idx_leads_client_status;
ALTER TABLE leads DROP KEY idx_leads_client_assigned;
ALTER TABLE leads DROP KEY idx_leads_client_phone;
ALTER TABLE leads DROP KEY idx_leads_client_source;
ALTER TABLE leads DROP KEY idx_leads_client_product;

ALTER TABLE leads DROP COLUMN client_id;
