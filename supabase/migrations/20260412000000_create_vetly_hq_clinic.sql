-- Insert Vetly HQ Clinic
INSERT INTO clinic_settings (
    id,
    clinic_name, 
    ycloud_phone_number, 
    ai_active_model, 
    activation_status, 
    subscription_plan,
    ai_personality
)
VALUES (
    '00000000-0000-0000-0000-000000000000', -- Consistent ID for HQ
    'Vetly HQ', 
    '+56993089185', 
    '4o', 
    'active', 
    'prestige',
    'Consultor Especialista'
)
ON CONFLICT (id) DO UPDATE SET
    ycloud_phone_number = EXCLUDED.ycloud_phone_number,
    ai_active_model = EXCLUDED.ai_active_model,
    ai_personality = EXCLUDED.ai_personality;
