-- New business model: Agency registration now collects real business/KYC
-- details (name, address, GST, city, mobile, email) alongside Google
-- Sign-In identity — see the "Agency pays per Client" restructure. Purely
-- additive: all nullable, existing rows are simply unset until an Agency
-- Admin fills them in (no retroactive requirement). contact_email is
-- deliberately distinct from users.email (the Agency Admin's own login
-- identity, verified by Google) — this is the Agency's own business
-- contact address, which may differ from the signing-up person's email.
ALTER TABLE tenants
  ADD COLUMN address        VARCHAR(500) NULL AFTER name,
  ADD COLUMN city           VARCHAR(120) NULL AFTER address,
  ADD COLUMN gst_number     VARCHAR(20)  NULL AFTER city,
  ADD COLUMN mobile         VARCHAR(20)  NULL AFTER gst_number,
  ADD COLUMN contact_email  VARCHAR(255) NULL AFTER mobile;
