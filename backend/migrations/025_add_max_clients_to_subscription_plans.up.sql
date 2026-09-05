-- B2B2C restructure: the agency's maximum number of clients is a property
-- of the PLAN it's subscribed to, not a static value stored on the agency
-- itself (that was the old, explicitly-rejected employee_limit design —
-- see tenants.employee_limit, left untouched and unused going forward).
-- NULL = unlimited (never an arbitrary large-integer sentinel).
-- Existing subscription_plans rows (0 in crm_dev today) get NULL by
-- default — real per-plan limits are entered deliberately later via the
-- plan-catalog UI, never invented here.
ALTER TABLE subscription_plans
  ADD COLUMN max_clients INT UNSIGNED NULL AFTER razorpay_plan_id;
