-- Aplicada vía MCP el 2026-08-17.
-- Cuerpo idéntico al original; sólo se antepone el control de acceso.
-- Sin él, cualquier usuario autenticado de CUALQUIER clínica podía leer los
-- 1.648 contactos (nombre, teléfono, email, dirección) de las dos sucursales.
CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id uuid)
RETURNS TABLE(id uuid, clinic_id uuid, name text, phone_number text, email text,
              address text, notes text, total_appointments integer, type text,
              created_at timestamp with time zone, tags jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $function$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
      RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT p.id, p.clinic_id, p.name, p.phone_number, p.email, p.address, p.notes,
        COALESCE(p.total_appointments, 0), 'tutor'::TEXT, p.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
        FROM public.tutor_tags pt JOIN public.tags t ON pt.tag_id = t.id WHERE pt.tutor_id = p.id), '[]'::jsonb)
    FROM public.tutors p WHERE p.clinic_id = p_clinic_id
    UNION ALL
    SELECT pr.id, pr.clinic_id, pr.name, pr.phone, pr.email, pr.address, pr.notes,
        0, 'prospect'::TEXT, pr.created_at,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
        FROM public.crm_prospect_tags cpt JOIN public.crm_tags t ON cpt.tag_id = t.id WHERE cpt.prospect_id = pr.id), '[]'::jsonb)
    FROM public.crm_prospects pr WHERE pr.clinic_id = p_clinic_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_unified_contacts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unified_contacts(uuid) TO authenticated, service_role;
