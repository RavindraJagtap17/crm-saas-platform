ALTER TABLE meta_capi_events DROP FOREIGN KEY fk_meta_capi_events_lead_client;
ALTER TABLE meta_capi_events DROP FOREIGN KEY fk_meta_capi_events_client;
ALTER TABLE meta_capi_events DROP KEY uq_meta_capi_events_client_lead;
ALTER TABLE meta_capi_events DROP COLUMN client_id;
