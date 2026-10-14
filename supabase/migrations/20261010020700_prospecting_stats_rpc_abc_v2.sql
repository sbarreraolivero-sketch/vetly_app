-- get_prospecting_stats incluye los conteos de los pasos B y C, más la
-- apertura combinada (cualquiera de los 3 correos).

CREATE OR REPLACE FUNCTION public.get_prospecting_stats()
 RETURNS TABLE(total bigint, sin_contactar bigint, en_revision bigint, listo_para_enviar bigint, email_enviado bigint, en_revision_b bigint, listo_para_enviar_b bigint, email_b_enviado bigint, en_revision_c bigint, listo_para_enviar_c bigint, secuencia_completa bigint, respondio bigint, en_pipeline bigint, descartado bigint, con_apertura bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    RETURN QUERY
    SELECT
        count(*),
        count(*) FILTER (WHERE contact_status = 'sin_contactar'),
        count(*) FILTER (WHERE contact_status = 'en_revision'),
        count(*) FILTER (WHERE contact_status = 'listo_para_enviar'),
        count(*) FILTER (WHERE contact_status = 'email_enviado'),
        count(*) FILTER (WHERE contact_status = 'en_revision_b'),
        count(*) FILTER (WHERE contact_status = 'listo_para_enviar_b'),
        count(*) FILTER (WHERE contact_status = 'email_b_enviado'),
        count(*) FILTER (WHERE contact_status = 'en_revision_c'),
        count(*) FILTER (WHERE contact_status = 'listo_para_enviar_c'),
        count(*) FILTER (WHERE contact_status = 'secuencia_completa'),
        count(*) FILTER (WHERE contact_status = 'respondio'),
        count(*) FILTER (WHERE contact_status = 'en_pipeline'),
        count(*) FILTER (WHERE contact_status = 'descartado'),
        count(*) FILTER (WHERE email_opened_at IS NOT NULL OR email_b_opened_at IS NOT NULL OR email_c_opened_at IS NOT NULL)
    FROM public.prospecting_leads;
END;
$function$;
