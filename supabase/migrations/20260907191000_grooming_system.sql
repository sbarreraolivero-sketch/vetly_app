-- ============================================================================
-- Área de Estética Canina (MVP)
--
-- Línea de servicio con workflow propio, disponible en todos los planes
-- (incluido Core). Se apoya en lo existente (agenda, servicios, fichas,
-- finanzas, fidelización) y agrega:
--   * clinic_services.category — marca los servicios de estética
--   * appointments.appointment_type — separa la agenda de estética de la médica
--   * grooming_profiles — ficha de estética acumulativa por mascota
--   * grooming_sessions — cada sesión (report card) con fotos antes/después
--   * grooming_price_rules — precio por talla / pelaje / peso / raza
--   * get_grooming_report_public — página pública /estetica/:token
--
-- El rol `groomer` se agregó al enum user_role en 20260907190315.
-- ============================================================================

-- ── Columnas nuevas en tablas existentes ────────────────────────────────────
ALTER TABLE public.clinic_services
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'medical';   -- 'medical' | 'grooming'

ALTER TABLE public.appointments
    ADD COLUMN IF NOT EXISTS appointment_type TEXT NOT NULL DEFAULT 'medical';  -- 'medical' | 'grooming'

CREATE INDEX IF NOT EXISTS idx_appointments_type_clinic
    ON public.appointments (clinic_id, appointment_type, appointment_date);

-- ── grooming_profiles ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grooming_profiles (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id             UUID NOT NULL UNIQUE REFERENCES public.patients(id) ON DELETE CASCADE,
    clinic_id              UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    coat_type              TEXT,   -- corto | medio | largo | doble | rizado | sin_pelo
    coat_length            TEXT,
    size_category          TEXT,   -- xs | s | m | l | xl
    preferred_cut          TEXT,
    cut_reference_photo_url TEXT,
    products_notes         TEXT,
    product_allergies      TEXT,
    temperament            TEXT,   -- tranquilo | nervioso | agresivo | requiere_bozal | requiere_2_personas
    handling_notes         TEXT,
    matting_policy_ack     BOOLEAN NOT NULL DEFAULT false,
    medical_alerts         TEXT,
    updated_by             UUID,
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── grooming_sessions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grooming_sessions (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id         UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    patient_id        UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    appointment_id    UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    groomer_member_id UUID REFERENCES public.clinic_members(id) ON DELETE SET NULL,
    session_date      DATE NOT NULL DEFAULT CURRENT_DATE,
    services          JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{name, price, add_on}]
    findings          TEXT,
    before_photos     JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [url]
    after_photos      JSONB NOT NULL DEFAULT '[]'::jsonb,
    products_used     TEXT,
    next_visit_weeks  INTEGER,
    next_visit_date   DATE,
    notes             TEXT,                                 -- INTERNO — no va al reporte público
    public_token      TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
    income_id         UUID,                                 -- vínculo informativo al cobro
    created_by        UUID,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grooming_sessions_patient
    ON public.grooming_sessions (patient_id, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_grooming_sessions_clinic
    ON public.grooming_sessions (clinic_id);

-- ── grooming_price_rules ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.grooming_price_rules (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id     UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    service_id    UUID NOT NULL REFERENCES public.clinic_services(id) ON DELETE CASCADE,
    size_category TEXT,   -- nullable = aplica a todas
    coat_type     TEXT,   -- nullable
    weight_min    NUMERIC,
    weight_max    NUMERIC,
    breed         TEXT,   -- nullable, override exacto (case-insensitive), gana sobre lo demás
    price         NUMERIC NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_grooming_price_rules_service
    ON public.grooming_price_rules (service_id);

-- ── RLS ────────────────────────────────────────────────────────────────────
ALTER TABLE public.grooming_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grooming_sessions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grooming_price_rules ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['grooming_profiles','grooming_sessions','grooming_price_rules'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_members ON public.%I', t, t);
        EXECUTE format(
            'CREATE POLICY %I_members ON public.%I FOR ALL TO authenticated USING (public.is_clinic_member(clinic_id)) WITH CHECK (public.is_clinic_member(clinic_id))', t, t);
        EXECUTE format('DROP POLICY IF EXISTS %I_service_role ON public.%I', t, t);
        EXECUTE format(
            'CREATE POLICY %I_service_role ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t, t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    END LOOP;
END $$;

-- ── Triggers updated_at ────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS tr_grooming_profiles_updated_at ON public.grooming_profiles;
CREATE TRIGGER tr_grooming_profiles_updated_at BEFORE UPDATE ON public.grooming_profiles
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS tr_grooming_sessions_updated_at ON public.grooming_sessions;
CREATE TRIGGER tr_grooming_sessions_updated_at BEFORE UPDATE ON public.grooming_sessions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS tr_grooming_price_rules_updated_at ON public.grooming_price_rules;
CREATE TRIGGER tr_grooming_price_rules_updated_at BEFORE UPDATE ON public.grooming_price_rules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RPC pública del reporte /estetica/:token ───────────────────────────────
CREATE OR REPLACE FUNCTION public.get_grooming_report_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_row public.grooming_sessions%ROWTYPE; result JSONB;
BEGIN
    SELECT * INTO v_row FROM public.grooming_sessions WHERE public_token = p_token LIMIT 1;
    IF v_row.id IS NULL THEN RETURN NULL; END IF;

    SELECT jsonb_build_object(
        'session', jsonb_build_object(
            'session_date',    v_row.session_date,
            'services',        v_row.services,
            'findings',        v_row.findings,
            'before_photos',   v_row.before_photos,
            'after_photos',    v_row.after_photos,
            'next_visit_date', v_row.next_visit_date,
            'groomer_name',    (SELECT NULLIF(TRIM(COALESCE(cm.first_name,'') || ' ' || COALESCE(cm.last_name,'')), '')
                                FROM public.clinic_members cm WHERE cm.id = v_row.groomer_member_id)
        ),
        'patient', jsonb_build_object(
            'name',    pat.name,
            'species', pat.species,
            'breed',   pat.breed
        ),
        'clinic', jsonb_build_object(
            'clinic_name',           cs.clinic_name,
            'clinic_address',        COALESCE(cs.clinic_address, cs.address),
            'country',               cs.country,
            'contact_phone',         cs.contact_phone,
            'logo_url',              cs.booking_logo_url,
            'brand_color',           cs.booking_brand_color,
            'brand_color_secondary', cs.booking_brand_color_secondary,
            'website_url',           cs.website_url,
            'instagram_url',         cs.instagram_url,
            'facebook_url',          cs.facebook_url,
            'tiktok_url',            cs.tiktok_url
        )
    ) INTO result
    FROM public.grooming_sessions gs
    JOIN public.clinic_settings cs ON cs.id = gs.clinic_id
    JOIN public.patients pat       ON pat.id = gs.patient_id
    WHERE gs.id = v_row.id;

    RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.get_grooming_report_public(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_grooming_report_public(TEXT) TO anon, authenticated;

-- ── RPC: precio de un servicio de estética ─────────────────────────────────
-- Resolución de más específico a menos: breed exacto (ci) > size+coat > size
-- > rango de peso > NULL (el llamador cae al price fijo del servicio).
CREATE OR REPLACE FUNCTION public.grooming_price_lookup(
    p_service_id UUID,
    p_size TEXT DEFAULT NULL,
    p_coat TEXT DEFAULT NULL,
    p_weight NUMERIC DEFAULT NULL,
    p_breed TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_clinic UUID; v_price NUMERIC;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.clinic_services WHERE id = p_service_id;
    IF v_clinic IS NULL THEN RETURN NULL; END IF;
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(v_clinic) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    -- Solo filas que EFECTIVAMENTE aplican al caso (cada dimensión de la fila
    -- es NULL "comodín" o coincide con el argumento). De esas, se toma la más
    -- específica: breed > size > coat > rango de peso. Si ninguna aplica,
    -- devuelve NULL y el llamador cae al price fijo del servicio.
    SELECT r.price INTO v_price
    FROM public.grooming_price_rules r
    WHERE r.service_id = p_service_id
      AND (r.breed IS NULL OR (p_breed IS NOT NULL AND lower(r.breed) = lower(p_breed)))
      AND (r.size_category IS NULL OR r.size_category = p_size)
      AND (r.coat_type IS NULL OR r.coat_type = p_coat)
      AND (r.weight_min IS NULL OR (p_weight IS NOT NULL AND p_weight >= r.weight_min))
      AND (r.weight_max IS NULL OR (p_weight IS NOT NULL AND p_weight <= r.weight_max))
    ORDER BY
        (r.breed IS NOT NULL) DESC,
        (r.size_category IS NOT NULL) DESC,
        (r.coat_type IS NOT NULL) DESC,
        (r.weight_min IS NOT NULL OR r.weight_max IS NOT NULL) DESC,
        r.created_at ASC
    LIMIT 1;

    RETURN v_price;
END;
$$;
REVOKE ALL ON FUNCTION public.grooming_price_lookup(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grooming_price_lookup(UUID, TEXT, TEXT, NUMERIC, TEXT) TO authenticated, service_role;

-- ── RPC: reemplazar el set de reglas de precio de un servicio ──────────────
CREATE OR REPLACE FUNCTION public.replace_grooming_price_rules(p_service_id UUID, p_rules JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_clinic UUID;
BEGIN
    SELECT clinic_id INTO v_clinic FROM public.clinic_services WHERE id = p_service_id;
    IF v_clinic IS NULL THEN RAISE EXCEPTION 'Servicio no encontrado'; END IF;
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(v_clinic) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    DELETE FROM public.grooming_price_rules WHERE service_id = p_service_id;

    INSERT INTO public.grooming_price_rules
        (clinic_id, service_id, size_category, coat_type, weight_min, weight_max, breed, price)
    SELECT v_clinic, p_service_id,
        NULLIF(r->>'size_category',''), NULLIF(r->>'coat_type',''),
        (r->>'weight_min')::numeric, (r->>'weight_max')::numeric,
        NULLIF(r->>'breed',''), (r->>'price')::numeric
    FROM jsonb_array_elements(p_rules) AS r
    WHERE (r->>'price') IS NOT NULL AND (r->>'price') <> '';
END;
$$;
REVOKE ALL ON FUNCTION public.replace_grooming_price_rules(UUID, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_grooming_price_rules(UUID, JSONB) TO authenticated, service_role;
