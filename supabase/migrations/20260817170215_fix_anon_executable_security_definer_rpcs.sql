-- Aplicada vía MCP el 2026-08-17. Archivo local para que un reset la reproduzca.
--
-- Cuatro RPCs SECURITY DEFINER hacían un SELECT directo sin ningún control de
-- acceso y eran ejecutables con la anon key pública (embebida en el bundle de
-- vetly.pro). Sin login se obtenían: meta_access_token y meta_capi_token de
-- ambas sucursales, ai_behavior_rules/ai_personality completos, 1.648 contactos
-- con teléfono y dirección, y los emails del equipo.
--
-- CAPA 1: REVOKE FROM anon no basta — PostgreSQL concede EXECUTE a PUBLIC por
-- defecto y anon hereda de ahí. Hay que revocar de PUBLIC también.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND p.proname NOT IN ('get_pet_owner_portal','get_referral_link_data','mark_diagnostic_wa_clicked')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

-- CAPA 2: sin este check, un usuario autenticado de CUALQUIER clínica seguía
-- leyendo los datos de otra (aislamiento entre sucursales).
CREATE OR REPLACE FUNCTION public.get_clinic_settings_secure(p_clinic_id uuid)
RETURNS SETOF clinic_settings LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role'
     AND NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  RETURN QUERY SELECT * FROM public.clinic_settings WHERE id = p_clinic_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_clinic_members_secure(p_clinic_id uuid)
RETURNS SETOF clinic_members LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
  IF COALESCE(auth.role(), 'service_role') <> 'service_role'
     AND NOT public.is_clinic_member(p_clinic_id) THEN
    RAISE EXCEPTION 'Acceso denegado';
  END IF;
  RETURN QUERY SELECT * FROM public.clinic_members WHERE clinic_id = p_clinic_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_clinic_settings_secure(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_clinic_members_secure(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_clinic_settings_secure(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_clinic_members_secure(uuid) TO authenticated, service_role;
