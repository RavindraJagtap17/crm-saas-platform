-- Same business/KYC fields as tenants (migration 052), one level down —
-- the Agency Admin fills these in when creating the Client (the separate
-- "invite the Client Admin person" step stays name+email only, unchanged).
-- Purely additive: all nullable, no retroactive requirement on existing
-- Clients. contact_email is the Client's own business contact address,
-- distinct from any individual Client Admin/Employee's own users.email.
ALTER TABLE clients
  ADD COLUMN address        VARCHAR(500) NULL AFTER name,
  ADD COLUMN city           VARCHAR(120) NULL AFTER address,
  ADD COLUMN gst_number     VARCHAR(20)  NULL AFTER city,
  ADD COLUMN mobile         VARCHAR(20)  NULL AFTER gst_number,
  ADD COLUMN contact_email  VARCHAR(255) NULL AFTER mobile;
