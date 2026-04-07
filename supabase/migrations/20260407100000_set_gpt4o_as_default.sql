-- Set GPT-4o as default for all clinics and existing records

-- 1. Upgrade the column default value to '4o' (Premium)
ALTER TABLE clinic_settings 
ALTER COLUMN ai_active_model SET DEFAULT '4o';

-- 2. Update existing clinics that still have 'mini' or are NULL
UPDATE clinic_settings 
SET ai_active_model = '4o' 
WHERE ai_active_model = 'mini' OR ai_active_model IS NULL;

-- 3. Comment explaining the change
COMMENT ON COLUMN clinic_settings.ai_active_model IS 'The active AI model for response generation. Defaulting to 4o (Premium) as per user request.';
