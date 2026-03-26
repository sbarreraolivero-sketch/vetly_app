-- RPC para actualizar la configuración de retención (Modo y Plantillas)
CREATE OR REPLACE FUNCTION public.update_retention_config(
  p_clinic_id UUID,
  p_autonomous_mode BOOLEAN,
  p_medium_template TEXT,
  p_high_template TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_mode TEXT;
BEGIN
  -- Verificar permisos (diferido a RLS o lógica de aplicación, aquí asumimos llamada autenticada vinculada a clinic_id)
  -- En producción, idealmente verificar que auth.uid() pertenece a la clínica.
  
  v_mode := CASE WHEN p_autonomous_mode THEN 'autonomous' ELSE 'supervised' END;

  -- 1. Actualizar protocolo de Riesgo Medio ("Recuperación Preventiva")
  UPDATE public.retention_protocols
  SET 
    execution_mode = v_mode,
    actions = jsonb_set(actions, '{template_name}', to_jsonb(p_medium_template))
  WHERE clinic_id = p_clinic_id 
    AND risk_level_trigger = 'medium';

  -- 2. Actualizar protocolo de Riesgo Alto ("Rescate de Cliente")
  UPDATE public.retention_protocols
  SET 
    execution_mode = v_mode,
    actions = jsonb_set(actions, '{template_name}', to_jsonb(p_high_template))
  WHERE clinic_id = p_clinic_id 
    AND risk_level_trigger = 'high';

  RETURN FOUND; -- Devuelve true si se actualizó algo
END;
$$;
