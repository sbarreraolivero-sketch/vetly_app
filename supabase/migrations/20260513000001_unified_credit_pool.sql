-- =========================================
-- UNIFIED CREDIT POOL: Multi-Branch Support
-- Parent: fd11b7e4-7d96-461c-a292-2caa5e2592ce (AnimalGrace Linares - Matriz)
-- Child:  13472ea4-4da6-461c-9a80-a5c970d9ec73 (AnimalGrace Santiago)
-- =========================================

-- 1. Add parent_clinic_id column
ALTER TABLE clinic_settings 
ADD COLUMN IF NOT EXISTS parent_clinic_id UUID REFERENCES clinic_settings(id);

-- 2. Set Santiago as child of Linares
UPDATE clinic_settings 
SET parent_clinic_id = 'fd11b7e4-7d96-461c-a292-2caa5e2592ce'
WHERE id = '13472ea4-4da6-461c-9a80-a5c970d9ec73';

-- 3. Fix max_users for Santiago
UPDATE clinic_settings 
SET max_users = 5
WHERE id = '13472ea4-4da6-461c-9a80-a5c970d9ec73' AND (max_users IS NULL OR max_users < 0);

-- 4. Update increment RPCs to always increment on the PARENT clinic
CREATE OR REPLACE FUNCTION increment_clinic_mini_usage(p_clinic_id UUID)
RETURNS VOID AS $$
DECLARE
    target_id UUID;
BEGIN
    -- If this clinic has a parent, increment on the parent
    SELECT COALESCE(parent_clinic_id, id) INTO target_id
    FROM clinic_settings WHERE id = p_clinic_id;
    
    UPDATE clinic_settings
    SET ai_credits_monthly_mini_used = COALESCE(ai_credits_monthly_mini_used, 0) + 1
    WHERE id = target_id;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION increment_clinic_4o_usage(p_clinic_id UUID)
RETURNS VOID AS $$
DECLARE
    target_id UUID;
BEGIN
    -- If this clinic has a parent, increment on the parent
    SELECT COALESCE(parent_clinic_id, id) INTO target_id
    FROM clinic_settings WHERE id = p_clinic_id;
    
    UPDATE clinic_settings
    SET ai_credits_monthly_4o_used = COALESCE(ai_credits_monthly_4o_used, 0) + 1
    WHERE id = target_id;
END;
$$ LANGUAGE plpgsql;

-- 5. Helper: Get all clinic IDs that share the same credit pool
CREATE OR REPLACE FUNCTION get_credit_pool_clinic_ids(p_clinic_id UUID)
RETURNS SETOF UUID AS $$
DECLARE
    root_id UUID;
BEGIN
    -- Find the root parent
    SELECT COALESCE(parent_clinic_id, id) INTO root_id
    FROM clinic_settings WHERE id = p_clinic_id;
    
    -- Return the parent + all children
    RETURN QUERY
    SELECT id FROM clinic_settings 
    WHERE id = root_id OR parent_clinic_id = root_id;
END;
$$ LANGUAGE plpgsql;
