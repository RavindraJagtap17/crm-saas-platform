-- Exact inverse: moves every client_admin/client_employee back onto
-- tenant_admin/tenant_employee, restoring tenant_id from their client's
-- own tenant_id and nulling client_id.
UPDATE users u
JOIN clients c ON c.id = u.client_id
SET u.role_id = (SELECT id FROM roles WHERE name = 'tenant_admin'),
    u.tenant_id = c.tenant_id,
    u.client_id = NULL
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'client_admin');

UPDATE users u
JOIN clients c ON c.id = u.client_id
SET u.role_id = (SELECT id FROM roles WHERE name = 'tenant_employee'),
    u.tenant_id = c.tenant_id,
    u.client_id = NULL
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'client_employee');
