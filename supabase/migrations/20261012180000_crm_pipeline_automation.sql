-- CRM: automatización de etapas + etiquetas + índices + RPCs eficientes.
--
-- Contexto (sesión 115): el webhook de Meta insertaba prospectos sin etapa ni nombre, nada movía las
-- tarjetas (el trigger de "Cita agendada" buscaba por tutor_id, que es NULL en citas creadas por la IA)
-- y el etiquetado por interés solo existía en el webhook viejo de YCloud. La pantalla del CRM además
-- traía todos los prospectos (tope silencioso de 1.000 filas de PostgREST).
--
-- Reglas de seguridad de esta migración:
--  * Todos los triggers tragan sus propios errores (EXCEPTION WHEN OTHERS): una falla del CRM jamás
--    debe impedir crear una cita, un prospecto o una solicitud de agenda.
--  * Funciones SECURITY DEFINER con search_path fijo; las de uso interno solo para service_role.

-- ---------------------------------------------------------------------------
-- 0. Helper: teléfono solo dígitos (indexable)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.phone_digits(p text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$ SELECT regexp_replace(COALESCE(p, ''), '\D', '', 'g') $$;

-- ---------------------------------------------------------------------------
-- 1. Índices
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_crm_prospects_clinic_stage_updated
    ON public.crm_prospects (clinic_id, stage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_clinic_phone_digits
    ON public.crm_prospects (clinic_id, public.phone_digits(phone));
CREATE INDEX IF NOT EXISTS idx_appointments_clinic_phone_digits
    ON public.appointments (clinic_id, public.phone_digits(phone_number));
CREATE INDEX IF NOT EXISTS idx_tutors_clinic_phone_digits
    ON public.tutors (clinic_id, public.phone_digits(phone_number));
CREATE INDEX IF NOT EXISTS idx_crm_prospect_tags_tag
    ON public.crm_prospect_tags (tag_id);
CREATE INDEX IF NOT EXISTS idx_scheduling_requests_open_phone_digits
    ON public.scheduling_requests (clinic_id, public.phone_digits(tutor_phone))
    WHERE status IN ('pending', 'authorized');

-- ---------------------------------------------------------------------------
-- 2. Todo prospecto nuevo nace en la primera etapa del embudo (no "sin etapa")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_prospect_default_stage()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF NEW.stage_id IS NULL AND NEW.clinic_id IS NOT NULL THEN
        SELECT s.id INTO NEW.stage_id
        FROM public.crm_pipeline_stages s
        WHERE s.clinic_id = NEW.clinic_id
        ORDER BY s.position ASC
        LIMIT 1;
    END IF;
    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_prospect_default_stage ON public.crm_prospects;
CREATE TRIGGER tr_crm_prospect_default_stage
    BEFORE INSERT ON public.crm_prospects
    FOR EACH ROW EXECUTE FUNCTION public.crm_prospect_default_stage();

-- ---------------------------------------------------------------------------
-- 3. Cita creada (por la IA, por el dashboard o por la reserva online) → "Cita agendada"
--    Antes buscaba al prospecto por tutors.phone_number vía NEW.tutor_id, que es NULL en las
--    citas de la IA hasta que se completan: el trigger nunca movía nada.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_appointment_crm_sync()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_digits text;
    v_stage uuid;
BEGIN
    IF NEW.status NOT IN ('pending', 'confirmed') THEN
        RETURN NEW;
    END IF;
    v_digits := public.phone_digits(NEW.phone_number);
    IF length(v_digits) < 7 THEN
        RETURN NEW;  -- bloqueos de agenda y teléfonos inválidos
    END IF;

    SELECT s.id INTO v_stage
    FROM public.crm_pipeline_stages s
    WHERE s.clinic_id = NEW.clinic_id
      AND (s.name ILIKE '%cita%' OR s.name ILIKE '%agendada%')
    ORDER BY s.position ASC
    LIMIT 1;
    IF v_stage IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.crm_prospects p
    SET stage_id = v_stage, updated_at = NOW()
    WHERE p.clinic_id = NEW.clinic_id
      AND public.phone_digits(p.phone) = v_digits
      AND p.stage_id IS DISTINCT FROM v_stage;

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Solicitud de agenda abierta → "Consulta disponibilidad"
--    (no retrocede a quien ya está en "Cita agendada" o "Calificado")
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_sync_on_scheduling_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_stage uuid;
    v_digits text;
BEGIN
    IF NEW.status NOT IN ('pending', 'authorized') THEN
        RETURN NEW;
    END IF;
    v_digits := public.phone_digits(NEW.tutor_phone);
    IF length(v_digits) < 7 THEN
        RETURN NEW;
    END IF;

    SELECT s.id INTO v_stage
    FROM public.crm_pipeline_stages s
    WHERE s.clinic_id = NEW.clinic_id AND s.name ILIKE '%disponibilidad%'
    ORDER BY s.position ASC
    LIMIT 1;
    IF v_stage IS NULL THEN
        RETURN NEW;
    END IF;

    UPDATE public.crm_prospects p
    SET stage_id = v_stage, updated_at = NOW()
    WHERE p.clinic_id = NEW.clinic_id
      AND public.phone_digits(p.phone) = v_digits
      AND p.stage_id IS DISTINCT FROM v_stage
      AND NOT EXISTS (
          SELECT 1 FROM public.crm_pipeline_stages cur
          WHERE cur.id = p.stage_id
            AND (cur.name ILIKE '%cita%' OR cur.name ILIKE '%calificado%')
      );

    RETURN NEW;
EXCEPTION WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_crm_sync_on_scheduling_request ON public.scheduling_requests;
CREATE TRIGGER tr_crm_sync_on_scheduling_request
    AFTER INSERT OR UPDATE OF status ON public.scheduling_requests
    FOR EACH ROW EXECUTE FUNCTION public.crm_sync_on_scheduling_request();

-- ---------------------------------------------------------------------------
-- 5. Cierre automático (cron diario 06:00 UTC, ya agendado): a "Cerrado" pasan
--    (a) clientes ya atendidos (cita completada) sin cita futura ni solicitud abierta, y
--    (b) los que están en "Cita agendada" cuya cita ya pasó y no tienen otra por delante.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_close_crm_prospects()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    -- (a) Clientes atendidos
    UPDATE public.crm_prospects cp
    SET stage_id = cl.id, updated_at = NOW()
    FROM (
        SELECT DISTINCT ON (s.clinic_id) s.clinic_id, s.id
        FROM public.crm_pipeline_stages s
        WHERE s.name ILIKE '%cerrado%'
        ORDER BY s.clinic_id, s.position DESC
    ) cl
    WHERE cl.clinic_id = cp.clinic_id
      AND cp.stage_id IS DISTINCT FROM cl.id
      AND length(public.phone_digits(cp.phone)) >= 7
      AND EXISTS (
          SELECT 1 FROM public.appointments a
          WHERE a.clinic_id = cp.clinic_id
            AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
            AND a.status = 'completed'
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.appointments a
          WHERE a.clinic_id = cp.clinic_id
            AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
            AND a.status IN ('pending', 'confirmed') AND a.appointment_date >= NOW()
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.scheduling_requests sr
          WHERE sr.clinic_id = cp.clinic_id
            AND public.phone_digits(sr.tutor_phone) = public.phone_digits(cp.phone)
            AND sr.status IN ('pending', 'authorized')
      );

    -- (b) "Cita agendada" con la cita ya pasada
    UPDATE public.crm_prospects cp
    SET stage_id = cl.id, updated_at = NOW()
    FROM (
        SELECT DISTINCT ON (s.clinic_id) s.clinic_id, s.id
        FROM public.crm_pipeline_stages s
        WHERE s.name ILIKE '%cerrado%'
        ORDER BY s.clinic_id, s.position DESC
    ) cl
    WHERE cl.clinic_id = cp.clinic_id
      AND cp.stage_id IN (SELECT id FROM public.crm_pipeline_stages WHERE name ILIKE '%cita%')
      AND EXISTS (
          SELECT 1 FROM public.appointments a
          WHERE a.clinic_id = cp.clinic_id
            AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
            AND a.appointment_date < NOW() AND a.status <> 'cancelled'
      )
      AND NOT EXISTS (
          SELECT 1 FROM public.appointments a
          WHERE a.clinic_id = cp.clinic_id
            AND public.phone_digits(a.phone_number) = public.phone_digits(cp.phone)
            AND a.status IN ('pending', 'confirmed') AND a.appointment_date >= NOW()
      );
END;
$$;
REVOKE ALL ON FUNCTION public.auto_close_crm_prospects() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Conteos por etapa (una sola consulta; el tablero ya no descarga todos los prospectos)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_crm_stage_counts(p_clinic_id uuid)
RETURNS TABLE (stage_id uuid, n bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    RETURN QUERY
    SELECT COALESCE(p.stage_id,
                    (SELECT s.id FROM public.crm_pipeline_stages s
                     WHERE s.clinic_id = p_clinic_id ORDER BY s.position ASC LIMIT 1)) AS sid,
           count(*)::bigint
    FROM public.crm_prospects p
    WHERE p.clinic_id = p_clinic_id
    GROUP BY 1;
END;
$$;
REVOKE ALL ON FUNCTION public.get_crm_stage_counts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_crm_stage_counts(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Etiquetado en una sola llamada (webhook): crea la etiqueta si no existe y la asigna al
--    tutor (tutor_tags, lo que leen Tutores/Campañas) Y al prospecto del CRM (crm_prospect_tags,
--    lo que muestra el tablero). Idempotente. Solo service_role.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.crm_apply_tags(
    p_clinic_id uuid, p_phone text, p_tags text[], p_service_interest text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_digits text := public.phone_digits(p_phone);
    v_name text;
    v_tag uuid;
    v_ctag uuid;
    v_tutor uuid;
    v_pros uuid[];
    v_applied text[] := '{}';
BEGIN
    IF length(v_digits) < 7 OR p_tags IS NULL OR array_length(p_tags, 1) IS NULL THEN
        RETURN jsonb_build_object('applied', '[]'::jsonb, 'tutor', false, 'prospect', false);
    END IF;

    SELECT t.id INTO v_tutor FROM public.tutors t
    WHERE t.clinic_id = p_clinic_id AND public.phone_digits(t.phone_number) = v_digits LIMIT 1;
    SELECT array_agg(p.id) INTO v_pros FROM public.crm_prospects p
    WHERE p.clinic_id = p_clinic_id AND public.phone_digits(p.phone) = v_digits;

    IF v_tutor IS NULL AND v_pros IS NULL THEN
        RETURN jsonb_build_object('applied', '[]'::jsonb, 'tutor', false, 'prospect', false);
    END IF;

    FOREACH v_name IN ARRAY p_tags LOOP
        v_name := btrim(COALESCE(v_name, ''));
        CONTINUE WHEN v_name = '' OR length(v_name) > 60;
        PERFORM pg_advisory_xact_lock(hashtext(p_clinic_id::text || lower(v_name)));

        IF v_tutor IS NOT NULL THEN
            SELECT t.id INTO v_tag FROM public.tags t
            WHERE t.clinic_id = p_clinic_id AND lower(t.name) = lower(v_name) LIMIT 1;
            IF v_tag IS NULL THEN
                INSERT INTO public.tags (clinic_id, name, color) VALUES (p_clinic_id, v_name, '#3B82F6')
                RETURNING id INTO v_tag;
            END IF;
            INSERT INTO public.tutor_tags (tutor_id, tag_id) VALUES (v_tutor, v_tag) ON CONFLICT DO NOTHING;
        END IF;

        IF v_pros IS NOT NULL THEN
            SELECT t.id INTO v_ctag FROM public.crm_tags t
            WHERE t.clinic_id = p_clinic_id AND lower(t.name) = lower(v_name) LIMIT 1;
            IF v_ctag IS NULL THEN
                INSERT INTO public.crm_tags (clinic_id, name, color) VALUES (p_clinic_id, v_name, '#3B82F6')
                RETURNING id INTO v_ctag;
            END IF;
            INSERT INTO public.crm_prospect_tags (prospect_id, tag_id)
            SELECT unnest(v_pros), v_ctag ON CONFLICT DO NOTHING;
        END IF;

        v_applied := v_applied || v_name;
    END LOOP;

    IF p_service_interest IS NOT NULL AND v_pros IS NOT NULL THEN
        UPDATE public.crm_prospects SET service_interest = left(p_service_interest, 80)
        WHERE id = ANY (v_pros) AND service_interest IS NULL;
    END IF;

    RETURN jsonb_build_object('applied', to_jsonb(v_applied), 'tutor', v_tutor IS NOT NULL, 'prospect', v_pros IS NOT NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.crm_apply_tags(uuid, text, text[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.crm_apply_tags(uuid, text, text[], text) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. get_unified_contacts: los prospectos pasan a ser opcionales (default: solo tutores).
--    Las 3 pantallas que lo usan (Tutores, Citas, Estética) descartaban los prospectos en el
--    cliente, pero el RPC los enviaba igual: ~2.700 filas inútiles por carga, con el tope de
--    1.000 de PostgREST cortando la respuesta.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_unified_contacts(uuid);
CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id uuid, p_include_prospects boolean DEFAULT false)
RETURNS TABLE(id uuid, clinic_id uuid, name text, phone_number text, email text, address text, notes text,
              total_appointments integer, type text, created_at timestamp with time zone, tags jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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
    FROM public.crm_prospects pr WHERE pr.clinic_id = p_clinic_id AND p_include_prospects;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_unified_contacts(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_unified_contacts(uuid, boolean) TO authenticated, service_role;
