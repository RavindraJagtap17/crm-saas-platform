-- White-label Phase 1: favicon upload. Purely additive/nullable — existing
-- tenants are unaffected and keep the app's static default favicon until an
-- Agency Admin uploads their own (see applyTenantBranding()'s favicon step).
ALTER TABLE tenants
  ADD COLUMN favicon_url VARCHAR(1024) NULL AFTER logo_url;
