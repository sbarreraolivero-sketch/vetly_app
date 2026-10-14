-- update_prospecting_lead gana 4 parámetros opcionales para editar/aprobar
-- los correos B y C desde el panel (mismo flujo de revisión humana que ya
-- existía para el correo A).

CREATE OR REPLACE FUNCTION public.update_prospecting_lead(
    p_id uuid,
    p_contact_status text DEFAULT NULL::text,
    p_email_subject text DEFAULT NULL::text,
    p_email_body text DEFAULT NULL::text,
    p_notes text DEFAULT NULL::text,
    p_email_subject_b text DEFAULT NULL::text,
    p_email_body_b text DEFAULT NULL::text,
    p_email_subject_c text DEFAULT NULL::text,
    p_email_body_c text DEFAULT NULL::text
)
 RETURNS prospecting_leads
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_row public.prospecting_leads;
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    IF p_contact_status IS NOT NULL AND p_contact_status = 'en_pipeline' THEN
        RAISE EXCEPTION 'Usa promote_prospecting_lead_to_crm para pasar a en_pipeline';
    END IF;

    UPDATE public.prospecting_leads SET
        contact_status  = COALESCE(p_contact_status, contact_status),
        email_subject   = COALESCE(p_email_subject, email_subject),
        email_body      = COALESCE(p_email_body, email_body),
        notes           = COALESCE(p_notes, notes),
        email_b_subject = COALESCE(p_email_subject_b, email_b_subject),
        email_b_body    = COALESCE(p_email_body_b, email_b_body),
        email_c_subject = COALESCE(p_email_subject_c, email_c_subject),
        email_c_body    = COALESCE(p_email_body_c, email_c_body)
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Lead no encontrado';
    END IF;
    RETURN v_row;
END;
$function$;
