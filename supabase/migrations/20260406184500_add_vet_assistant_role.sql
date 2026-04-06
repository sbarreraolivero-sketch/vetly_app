-- Migration: add_vet_assistant_role
-- Description: Adds a new role 'vet_assistant' for clinic staff with restricted permissions.

-- 1. Add 'vet_assistant' to the user_role enum
-- Note: PostgreSQL doesn't allow adding values to enums inside a transaction easily in older versions,
-- but Supabase/Postgres 14+ supports it.
DO $$ 
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM pg_enum 
        JOIN pg_type ON pg_enum.enumtypid = pg_type.oid 
        WHERE pg_type.typname = 'user_role' 
        AND pg_enum.enumlabel = 'vet_assistant'
    ) THEN
        ALTER TYPE user_role ADD VALUE 'vet_assistant';
    END IF;
END $$;

-- 2. Update invite_member_v2 to ensure it handles the new role correctly
-- (The existing function should work if it just takes user_role, but we'll re-verify or refresh it if needed)
-- Actually, it uses 'p_role user_role' so it is fine.

-- 3. Update delete_clinic_member (the one we just fixed) to ensure vet_assistant is handled 
-- like professional/receptionist (non-admins)
-- The logic we wrote in the last turn is already robust:
--   IF v_caller_role = 'owner' THEN ...
--   ELSIF v_caller_role = 'admin' THEN ...
--   ELSE RAISE EXCEPTION 'No tienes permisos para eliminar miembros.'; END IF;
-- So vet_assistant will NOT have permission to delete members by default, which is correct.
