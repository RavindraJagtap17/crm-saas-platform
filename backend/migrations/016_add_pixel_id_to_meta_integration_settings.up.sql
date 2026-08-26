-- Step 8 (Meta CAPI): the tenant's Meta Pixel/Dataset ID — where a
-- server-side conversion event actually gets sent. Distinct from page_id
-- (Step 7's Lead Ads ingestion source): a Page's leads and a Pixel's
-- conversion destination are different Meta objects, and OAuth doesn't
-- reliably expose a single "correct" pixel to auto-select (an ad account
-- can have zero or several). The Tenant Admin enters it manually on the
-- same Meta connection they already set up in Step 7 — not a second
-- connection, one more field on the existing one.
ALTER TABLE meta_integration_settings
  ADD COLUMN pixel_id VARCHAR(64) NULL AFTER ad_account_id;
