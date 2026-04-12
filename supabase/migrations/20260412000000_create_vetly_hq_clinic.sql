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

-- Insert Pipeline Stages for HQ
INSERT INTO crm_pipeline_stages (clinic_id, name, color, position, is_default)
VALUES 
    ('00000000-0000-0000-0000-000000000000', 'Nuevo', '#6366f1', 0, true),
    ('00000000-0000-0000-0000-000000000000', 'Contactado', '#3b82f6', 1, false),
    ('00000000-0000-0000-0000-000000000000', 'Prueba Iniciada', '#f59e0b', 2, false),
    ('00000000-0000-0000-0000-000000000000', 'Convertido', '#10b981', 3, false),
    ('00000000-0000-0000-0000-000000000000', 'Postergado/Perdido', '#ef4444', 4, false)
ON CONFLICT DO NOTHING;
