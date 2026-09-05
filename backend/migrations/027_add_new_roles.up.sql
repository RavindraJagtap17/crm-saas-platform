-- B2B2C restructure: additive only — existing tenant_admin/tenant_employee
-- role rows are NOT touched or deleted here (retired later, once no user
-- references them — see migration 029). super_admin is untouched.
-- WHERE NOT EXISTS guards mirror uq_roles_name's own uniqueness (which
-- would reject a duplicate anyway) — belt-and-suspenders idempotency.
INSERT INTO roles (name)
SELECT 'agency_admin' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'agency_admin');

INSERT INTO roles (name)
SELECT 'client_admin' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'client_admin');

INSERT INTO roles (name)
SELECT 'client_employee' WHERE NOT EXISTS (SELECT 1 FROM roles WHERE name = 'client_employee');
