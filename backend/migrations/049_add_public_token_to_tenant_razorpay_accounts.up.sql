-- Step 8C: Razorpay's OAuth token-exchange response (both the
-- authorization_code and refresh_token grants — verified directly against
-- Razorpay's own documented example responses) includes a `public_token`
-- (format rzp_test_oauth_XXXXXXXXXXXXXX) alongside access_token/
-- refresh_token, but Step 5 never persisted it — only the two secret
-- tokens were stored.
--
-- public_token is NOT a secret: Razorpay's own documentation states it
-- "can replace the key_id field" in a Checkout configuration, precisely
-- BECAUSE it is designed for public-facing/browser use — the exact same
-- trust level key_id already has in this codebase (see agency-billing.js's
-- existing window.CRM_CONFIG.RAZORPAY_KEY_ID usage). Stored as plain
-- VARCHAR, matching razorpay_account_id's own treatment — deliberately NOT
-- the *_encrypted TEXT columns used for access_token/refresh_token, which
-- genuinely are secrets and must never reach the frontend.
ALTER TABLE tenant_razorpay_accounts
  ADD COLUMN public_token VARCHAR(64) NULL AFTER razorpay_account_id;
