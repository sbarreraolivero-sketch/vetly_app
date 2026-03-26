-- =============================================================
-- MIGRATION: Revenue Retention Engine™ — Default Protocols
-- =============================================================

-- 1. Create RPC to initialize default protocols
CREATE OR REPLACE FUNCTION public.initialize_default_protocols(p_clinic_id UUID)
RETURNS VOID AS $$
BEGIN
  -- Protocol 1: Medium Risk (Preventive)
  INSERT INTO public.retention_protocols (
    clinic_id, name, description, risk_level_trigger, execution_mode, is_active, actions
  )
  SELECT p_clinic_id, 'Recuperación Preventiva', 'Contactar pacientes que empiezan a retrasarse', 'medium', 'supervised', true, 
  '{"template_name": "retention_warning_soft", "channel": "whatsapp"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.retention_protocols WHERE clinic_id = p_clinic_id AND risk_level_trigger = 'medium'
  );

  -- Protocol 2: High Risk (Rescue)
  INSERT INTO public.retention_protocols (
    clinic_id, name, description, risk_level_trigger, execution_mode, is_active, actions
  )
  SELECT p_clinic_id, 'Rescate de Cliente', 'Oferta agresiva para clientes en riesgo de fuga', 'high', 'supervised', true, 
  '{"template_name": "retention_danger_offer", "channel": "whatsapp"}'::jsonb
  WHERE NOT EXISTS (
    SELECT 1 FROM public.retention_protocols WHERE clinic_id = p_clinic_id AND risk_level_trigger = 'high'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Backfill for existing clinics
DO $$
DECLARE
  v_clinic RECORD;
BEGIN
  FOR v_clinic IN SELECT id FROM public.clinic_settings LOOP
    PERFORM public.initialize_default_protocols(v_clinic.id);
  END LOOP;
END;
$$;
