SELECT 
    trigger_name,
    event_manipulation AS event,
    action_statement AS definition
FROM information_schema.triggers 
WHERE event_object_table = 'clinic_settings';
