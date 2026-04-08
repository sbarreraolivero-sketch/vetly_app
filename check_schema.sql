SELECT column_name, is_nullable, column_default 
FROM information_schema.columns 
WHERE table_name = 'clinic_settings' 
AND table_schema = 'public';
