-- In a real production app, this would be an invited user, not a migration insert.
-- We are picking the first user that exists and inserting them into platform_admins
-- for the sake of the local demo working.

INSERT INTO platform_admins (id, email)
SELECT id, email FROM auth.users LIMIT 1
ON CONFLICT (id) DO NOTHING;
