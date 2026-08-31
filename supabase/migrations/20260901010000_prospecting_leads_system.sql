-- ════════════════════════════════════════════════════════════════════════════
-- Prospección automatizada de clínicas veterinarias (HQ) — tabla + RLS + RPCs
-- ════════════════════════════════════════════════════════════════════════════
--
-- Tabla dedicada, deliberadamente separada de `crm_prospects` (que alimenta el
-- Kanban de /hq/crm) — mismo criterio que Nexflow separa `prospecting_leads`
-- de `pipeline_prospects`: mantiene el CRM real limpio de leads nunca
-- contactados. Un lead se "gradúa" a `crm_prospects` solo cuando responde o
-- agenda algo (ver `promote_prospecting_lead_to_crm`).
--
-- Regla del score: a diferencia de Nexflow (que vende posicionamiento en
-- Google y premia "sin presencia digital"), el ICP real de Vetly es la
-- clínica YA establecida con caos de WhatsApp — el score que carga cada lead
-- lo calcula quien hace el descubrimiento (Claude / la función de Places),
-- no esta migración; acá solo se define el rango/columna.

CREATE TABLE public.prospecting_leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    name TEXT NOT NULL,
    website TEXT,
    email TEXT,
    phone TEXT,
    address TEXT,
    country TEXT NOT NULL,
    city TEXT NOT NULL,

    prospect_type TEXT,  -- misma taxonomía que crm_prospects.prospect_type:
                          -- 'Móvil Individual' | 'Móvil Equipo' | 'Física Pequeña' |
                          -- 'Física Mediana' | 'Especialista'

    score INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 100),
    problems JSONB,

    has_google_ads BOOLEAN,
    has_meta_ads BOOLEAN,
    has_analytics BOOLEAN,
    has_https BOOLEAN,
    has_seo BOOLEAN,

    instagram TEXT,
    facebook TEXT,
    linkedin TEXT,
    twitter TEXT,

    google_place_id TEXT,  -- si vino de Places API — evita re-descubrir el mismo negocio

    contact_status TEXT NOT NULL DEFAULT 'sin_contactar'
        CHECK (contact_status IN (
            'sin_contactar', 'en_revision', 'listo_para_enviar',
            'email_enviado', 'respondio', 'descartado', 'en_pipeline'
        )),

    email_subject TEXT,
    email_body TEXT,
    email_sent_at TIMESTAMPTZ,
    email_opened_at TIMESTAMPTZ,
    resend_id TEXT,

    crm_prospect_id UUID REFERENCES public.crm_prospects(id) ON DELETE SET NULL,

    notes TEXT,
    source TEXT NOT NULL DEFAULT 'Prospección Digital - Scraper Automatizado'
    -- Deliberadamente distinto del literal 'Prospección Digital' que ya usa
    -- AdminDashboard.tsx para filtrar los 15 prospectos de mayo 2026 — no
    -- tocar ese valor (regla permanente ya documentada en CLAUDE.md).
);

CREATE INDEX idx_prospecting_leads_country_status_created
    ON public.prospecting_leads (country, contact_status, created_at);
CREATE UNIQUE INDEX idx_prospecting_leads_place_id
    ON public.prospecting_leads (google_place_id) WHERE google_place_id IS NOT NULL;

CREATE TRIGGER trg_prospecting_leads_updated_at
    BEFORE UPDATE ON public.prospecting_leads
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────
-- Sin policies para `authenticated`/`anon` — todo el acceso pasa por RPCs
-- SECURITY DEFINER gated por is_platform_admin(), o por service_role desde
-- las edge functions (que usan la service role key y por lo tanto ya
-- bypasean RLS). Este es el patrón correcto: crm_prospects tuvo dos rondas
-- de bypass multi-tenant documentadas en CLAUDE.md por exponer la tabla
-- cruda a `authenticated` — no se repite ese error acá.
ALTER TABLE public.prospecting_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_prospecting_leads"
    ON public.prospecting_leads FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- ── Trigger de reversión — mismo patrón que Nexflow ────────────────────────
-- Si se borra un crm_prospects que estaba vinculado a un lead promovido, el
-- lead vuelve a 'respondio' (conserva el historial, no se pierde el hecho de
-- que sí contestó) y se limpia el FK, en vez de quedar huérfano marcado
-- 'en_pipeline' apuntando a una fila que ya no existe.
CREATE OR REPLACE FUNCTION public.revert_prospecting_lead_on_crm_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    UPDATE public.prospecting_leads
    SET contact_status = 'respondio', crm_prospect_id = NULL
    WHERE crm_prospect_id = OLD.id;
    RETURN OLD;
END;
$function$;

CREATE TRIGGER trg_revert_prospecting_lead_on_crm_delete
    AFTER DELETE ON public.crm_prospects
    FOR EACH ROW EXECUTE FUNCTION public.revert_prospecting_lead_on_crm_delete();

-- ── RPCs para el panel HQ (AdminProspecting.tsx) ──────────────────────────

CREATE OR REPLACE FUNCTION public.get_prospecting_leads()
RETURNS SETOF public.prospecting_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;
    RETURN QUERY SELECT * FROM public.prospecting_leads ORDER BY score DESC, created_at DESC;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_prospecting_stats()
RETURNS TABLE (
    total BIGINT,
    sin_contactar BIGINT,
    en_revision BIGINT,
    listo_para_enviar BIGINT,
    email_enviado BIGINT,
    respondio BIGINT,
    en_pipeline BIGINT,
    descartado BIGINT,
    con_apertura BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        count(*) FILTER (WHERE contact_status = 'respondio'),
        count(*) FILTER (WHERE contact_status = 'en_pipeline'),
        count(*) FILTER (WHERE contact_status = 'descartado'),
        count(*) FILTER (WHERE email_opened_at IS NOT NULL)
    FROM public.prospecting_leads;
END;
$function$;

-- Update genérico y acotado: solo los campos que el panel necesita editar
-- (estado, contenido del correo generado, notas). Nunca permite tocar
-- country/city/score/contact_status='en_pipeline' directo (esa transición
-- específica vive en promote_prospecting_lead_to_crm, con su propio INSERT).
CREATE OR REPLACE FUNCTION public.update_prospecting_lead(
    p_id UUID,
    p_contact_status TEXT DEFAULT NULL,
    p_email_subject TEXT DEFAULT NULL,
    p_email_body TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS public.prospecting_leads
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
        contact_status = COALESCE(p_contact_status, contact_status),
        email_subject  = COALESCE(p_email_subject, email_subject),
        email_body     = COALESCE(p_email_body, email_body),
        notes          = COALESCE(p_notes, notes)
    WHERE id = p_id
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN
        RAISE EXCEPTION 'Lead no encontrado';
    END IF;
    RETURN v_row;
END;
$function$;

-- Gradúa un lead a crm_prospects (mismo patrón que promoteToPipeline() en
-- Nexflow) — crea el prospecto real en el CRM del HQ, lo liga, y marca el
-- lead como en_pipeline.
CREATE OR REPLACE FUNCTION public.promote_prospecting_lead_to_crm(p_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_lead public.prospecting_leads;
    v_stage_id UUID;
    v_new_crm_id UUID;
    HQ_ID CONSTANT UUID := '00000000-0000-0000-0000-000000000000';
BEGIN
    IF NOT public.is_platform_admin() THEN
        RAISE EXCEPTION 'Unauthorized: platform admin access required';
    END IF;

    SELECT * INTO v_lead FROM public.prospecting_leads WHERE id = p_id;
    IF v_lead.id IS NULL THEN
        RAISE EXCEPTION 'Lead no encontrado';
    END IF;
    IF v_lead.crm_prospect_id IS NOT NULL THEN
        RETURN v_lead.crm_prospect_id;  -- idempotente: ya estaba promovido
    END IF;

    -- Primer stage por posición (mismo criterio que DEFAULT_STAGES en AdminCRM.tsx)
    SELECT id INTO v_stage_id FROM public.crm_pipeline_stages
    WHERE clinic_id = HQ_ID ORDER BY position ASC LIMIT 1;

    INSERT INTO public.crm_prospects (
        clinic_id, stage_id, name, phone, email, address,
        source, score, notes, website, prospect_type
    ) VALUES (
        HQ_ID, v_stage_id, v_lead.name, v_lead.phone, v_lead.email, v_lead.address,
        v_lead.source, v_lead.score,
        concat_ws(E'\n',
            CASE WHEN v_lead.website IS NOT NULL THEN 'Web: ' || v_lead.website END,
            'País/Ciudad: ' || v_lead.country || ' / ' || v_lead.city,
            CASE WHEN v_lead.problems IS NOT NULL THEN 'Problemas detectados: ' || v_lead.problems::text END
        ),
        v_lead.website, v_lead.prospect_type
    )
    RETURNING id INTO v_new_crm_id;

    UPDATE public.prospecting_leads
    SET contact_status = 'en_pipeline', crm_prospect_id = v_new_crm_id
    WHERE id = p_id;

    RETURN v_new_crm_id;
END;
$function$;

-- ── Endurecimiento de permisos (patrón establecido: revocar PUBLIC/anon,
-- conceder explícito a authenticated/service_role) ────────────────────────
REVOKE EXECUTE ON FUNCTION public.get_prospecting_leads() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_prospecting_stats() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_prospecting_lead(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.promote_prospecting_lead_to_crm(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.revert_prospecting_lead_on_crm_delete() FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_prospecting_leads() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_prospecting_stats() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_prospecting_lead(UUID, TEXT, TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.promote_prospecting_lead_to_crm(UUID) TO authenticated, service_role;
