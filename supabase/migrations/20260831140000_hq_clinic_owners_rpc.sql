-- ════════════════════════════════════════════════════════════════════════════
-- HQ "Clínicas" — datos del dueño (nombre/email/teléfono) sin abrir RLS
-- ════════════════════════════════════════════════════════════════════════════
--
-- Bug encontrado al verificar el panel reconfigurado: ninguna policy SELECT de
-- `clinic_members` contempla is_platform_admin() (solo is_clinic_admin() /
-- is_admin_of_clinic(), ambas scoped a la propia clínica del usuario). Un
-- admin de HQ leyendo `clinic_settings?select=*,clinic_members(...)` para
-- TODAS las clínicas obtiene 0 filas de clinic_members en casi todos los
-- casos → el fallback `owner?.email || clinic.id` terminaba mostrando el UUID
-- de la clínica como si fuera el email del dueño.
--
-- Fix: RPC SECURITY DEFINER gated por is_platform_admin(), mismo patrón ya
-- usado por get_all_clinics_usage / get_hq_clinic_activity — no se toca la
-- RLS de clinic_members ni user_profiles (tablas sensibles, usadas en todo
-- el resto de la app).
CREATE OR REPLACE FUNCTION public.get_hq_clinic_owners()
RETURNS TABLE (
    clinic_id UUID,
    owner_email TEXT,
    owner_name TEXT,
    owner_phone TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;

    RETURN QUERY
    SELECT
        cs.id AS clinic_id,
        owner.email AS owner_email,
        COALESCE(owner.first_name, up.full_name) AS owner_name,
        up.phone AS owner_phone
    FROM public.clinic_settings cs
    LEFT JOIN LATERAL (
        -- Prioriza role='owner'; si no hay ninguno (dato viejo/incompleto),
        -- cae al miembro más antiguo en vez de dejar todo en null.
        SELECT cm.email, cm.first_name, cm.user_id
        FROM public.clinic_members cm
        WHERE cm.clinic_id = cs.id
        ORDER BY (cm.role = 'owner') DESC, cm.created_at ASC
        LIMIT 1
    ) owner ON true
    LEFT JOIN public.user_profiles up ON up.id = owner.user_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_hq_clinic_owners() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_hq_clinic_owners() TO authenticated, service_role;
