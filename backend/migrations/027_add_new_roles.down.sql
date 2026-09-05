-- Safe only once no user references these roles — migration 029's down
-- runs before this one in a full rollback (reverse order), so by the time
-- this executes, every user has already been moved back off these roles.
DELETE FROM roles WHERE name IN ('agency_admin', 'client_admin', 'client_employee');
