-- B2B2C restructure — the actual user data migration. Placed here
-- (immediately after users.client_id exists, before any CRM table gains a
-- composite FK referencing users(client_id, id) in later migrations) so
-- every such FK is added against an already-fully-backfilled users table,
-- never relying on today's incidental "no row happens to reference a user
-- yet" state.
--
-- tenant_admin -> client_admin, tenant_employee -> client_employee, each
-- re-homed onto the ONE client backfilled (migration 026) for their
-- current tenant. tenant_id is nulled per the finalized user-scope model
-- (028's comment). No user is ever assigned agency_admin here — per the
-- approved business decision, provisioning the first Agency Admin per
-- agency is a deliberate, later Super Admin action, never automatic.
--
-- Naturally idempotent: after the first run, no user's role_id still
-- equals the OLD tenant_admin/tenant_employee role id, so a second run
-- would match zero rows (on top of the migration runner's own
-- schema_migrations bookkeeping already preventing a second run).
UPDATE users u
JOIN clients c ON c.tenant_id = u.tenant_id
SET u.role_id = (SELECT id FROM roles WHERE name = 'client_admin'),
    u.client_id = c.id,
    u.tenant_id = NULL
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'tenant_admin');

UPDATE users u
JOIN clients c ON c.tenant_id = u.tenant_id
SET u.role_id = (SELECT id FROM roles WHERE name = 'client_employee'),
    u.client_id = c.id,
    u.tenant_id = NULL
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'tenant_employee');
