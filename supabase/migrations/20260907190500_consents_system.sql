-- ============================================================================
-- Consentimientos digitales
--
-- Hasta ahora no existía ninguna función de consentimiento (lo más cercano era
-- el textarea libre medical_history.procedure_notes). Este sistema:
--   * biblioteca de plantillas editable por clínica (Vetly precarga 10)
--   * emisión desde la ficha del paciente (o el ingreso de estética)
--   * firma remota "de un clic" / nombre escrito / dibujada, vía enlace público
--     /consentimiento/:public_token (sin login), y también modo tablet presencial
--   * guardado automático en la ficha + rastro de auditoría (IP, user agent, hora)
--
-- Clona el patrón del sistema de recetas (migración 20260831120001/120002):
-- token hex de 128 bits como DEFAULT de columna, RPC pública SECURITY DEFINER
-- que devuelve el documento snapshoteado + branding en vivo de la clínica,
-- RLS por is_clinic_member, envío del enlace por edge function.
-- ============================================================================

-- ── consent_templates ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consent_templates (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id      UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    template_key   TEXT NOT NULL,                       -- estable, para el seed idempotente y "restaurar texto"
    category       TEXT NOT NULL DEFAULT 'general',
    title          TEXT NOT NULL,
    body           TEXT NOT NULL,                       -- placeholders: {tutor} {paciente} {clinica} {servicio} {fecha}
    signature_mode TEXT NOT NULL DEFAULT 'typed',       -- 'one_click' | 'typed' | 'drawn'
    checkboxes     JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{key,label,required}]
    validity_days  INTEGER,                             -- NULL = no expira (solo se re-pide si cambia la plantilla)
    is_active      BOOLEAN NOT NULL DEFAULT true,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clinic_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_consent_templates_clinic
    ON public.consent_templates (clinic_id) WHERE is_active;

-- ── consent_records ─────────────────────────────────────────────────────────
-- Instancia emitida. El texto de la plantilla se CONGELA al emitir
-- (template_title/body/checkboxes) — un documento firmado no puede mutar si el
-- admin edita la plantilla después.
CREATE TABLE IF NOT EXISTS public.consent_records (
    id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id                UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    patient_id               UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
    tutor_id                 UUID REFERENCES public.tutors(id) ON DELETE SET NULL,
    appointment_id           UUID REFERENCES public.appointments(id) ON DELETE SET NULL,
    template_key             TEXT NOT NULL,
    template_title           TEXT NOT NULL,
    template_body            TEXT NOT NULL,             -- placeholders ya resueltos al emitir
    template_version_at      TIMESTAMPTZ,               -- consent_templates.updated_at al emitir
    checkboxes               JSONB NOT NULL DEFAULT '[]'::jsonb,
    patient_snapshot         JSONB NOT NULL DEFAULT '{}'::jsonb,
    tutor_name               TEXT,
    public_token             TEXT NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(16), 'hex'),
    status                   TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'signed' | 'declined'
    required_signature_mode  TEXT NOT NULL DEFAULT 'typed',
    signed_at                TIMESTAMPTZ,
    signer_name              TEXT,
    signer_relationship      TEXT,                      -- 'tutor' | 'familiar' | 'otro'
    signer_ip                TEXT,                      -- INTERNO — nunca en la RPC pública
    signer_user_agent        TEXT,                      -- INTERNO
    acceptance_method        TEXT,                      -- 'one_click' | 'typed' | 'drawn'
    signature_url            TEXT,                      -- PNG en clinic-branding si drawn
    checkbox_responses       JSONB NOT NULL DEFAULT '{}'::jsonb,
    declined_reason          TEXT,                      -- INTERNO
    created_by               UUID,                      -- INTERNO
    created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consent_records_patient
    ON public.consent_records (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consent_records_clinic
    ON public.consent_records (clinic_id);

-- ── RLS (idéntico a prescriptions) ──────────────────────────────────────────
ALTER TABLE public.consent_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consent_records   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consent_templates_members ON public.consent_templates;
CREATE POLICY consent_templates_members ON public.consent_templates
    FOR ALL TO authenticated
    USING (public.is_clinic_member(clinic_id))
    WITH CHECK (public.is_clinic_member(clinic_id));
DROP POLICY IF EXISTS consent_templates_service_role ON public.consent_templates;
CREATE POLICY consent_templates_service_role ON public.consent_templates
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS consent_records_members ON public.consent_records;
CREATE POLICY consent_records_members ON public.consent_records
    FOR ALL TO authenticated
    USING (public.is_clinic_member(clinic_id))
    WITH CHECK (public.is_clinic_member(clinic_id));
DROP POLICY IF EXISTS consent_records_service_role ON public.consent_records;
CREATE POLICY consent_records_service_role ON public.consent_records
    FOR ALL TO service_role USING (true) WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consent_records   TO authenticated;

-- public.set_updated_at() ya existe (20260529000001_inventory_system.sql).
DROP TRIGGER IF EXISTS tr_consent_templates_updated_at ON public.consent_templates;
CREATE TRIGGER tr_consent_templates_updated_at
    BEFORE UPDATE ON public.consent_templates
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS tr_consent_records_updated_at ON public.consent_records;
CREATE TRIGGER tr_consent_records_updated_at
    BEFORE UPDATE ON public.consent_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Biblioteca de plantillas — única fuente de verdad ───────────────────────
-- La usan seed_consent_templates() (al crear una clínica) y
-- get_consent_template_library() (botón "Restaurar texto recomendado").
CREATE OR REPLACE FUNCTION public._consent_template_library()
RETURNS TABLE (
    template_key   TEXT,
    category       TEXT,
    title          TEXT,
    body           TEXT,
    signature_mode TEXT,
    checkboxes     JSONB,
    validity_days  INTEGER
)
LANGUAGE sql IMMUTABLE
AS $$
VALUES
(
 'general', 'general', 'Consentimiento informado general',
 E'Yo, {tutor}, en calidad de responsable de {paciente}, declaro que he sido informado(a) de forma clara y comprensible por el equipo de {clinica} sobre el estado de salud de mi mascota, los procedimientos propuestos, sus alternativas, los beneficios esperados y los riesgos asociados.\n\nAutorizo al equipo profesional de {clinica} a realizar la atención, exámenes y procedimientos que sean necesarios para el diagnóstico y tratamiento de {paciente}. Entiendo que la medicina veterinaria no es una ciencia exacta y que no se me ha garantizado un resultado determinado.\n\nMe comprometo a entregar información veraz sobre los antecedentes de mi mascota y a seguir las indicaciones post-atención. Autorizo la atención veterinaria de urgencia que el equipo estime necesaria si la vida de {paciente} corre riesgo y no es posible contactarme.\n\nFecha: {fecha}',
 'typed', '[]'::jsonb, NULL
),
(
 'quirurgico', 'quirurgico', 'Consentimiento quirúrgico',
 E'Yo, {tutor}, responsable de {paciente}, autorizo al equipo veterinario de {clinica} a realizar el procedimiento quirúrgico indicado: {servicio}.\n\nHe sido informado(a) de:\n- La naturaleza y el objetivo de la cirugía, y sus alternativas.\n- Que toda cirugía y toda anestesia conllevan riesgos, incluyendo reacciones adversas, hemorragia, infección, complicaciones cardiorrespiratorias y, en casos poco frecuentes, la muerte del paciente.\n- Que pueden surgir hallazgos durante la cirugía que obliguen a ampliar o modificar el procedimiento planificado; autorizo al equipo a tomar las decisiones que resulten necesarias en beneficio de {paciente}.\n- Las indicaciones de ayuno y preparación previa, que declaro haber cumplido.\n\nAutorizo la administración de anestesia y de los medicamentos analgésicos y de soporte que el equipo estime necesarios, así como la atención de urgencia que se requiera durante o después del procedimiento.\n\nEntiendo que no se me ha garantizado un resultado y que los costos informados son una estimación que puede variar según la evolución del caso.\n\nFecha: {fecha}',
 'drawn', '[]'::jsonb, NULL
),
(
 'anestesico', 'anestesico', 'Consentimiento anestésico',
 E'Yo, {tutor}, responsable de {paciente}, autorizo al equipo de {clinica} a administrar sedación y/o anestesia a mi mascota para el procedimiento {servicio}.\n\nHe sido informado(a) de que la anestesia conlleva riesgos que dependen de la edad, el peso, la raza y el estado de salud del paciente, incluyendo reacciones alérgicas, alteraciones cardíacas o respiratorias, hipotermia y, en casos poco frecuentes, la muerte.\n\nDeclaro haber informado al equipo sobre enfermedades previas, medicamentos y episodios anestésicos anteriores de {paciente}, y haber cumplido las indicaciones de ayuno.\n\nEntiendo que se recomienda la realización de exámenes preanestésicos y que la decisión de no realizarlos es de mi exclusiva responsabilidad. Autorizo las maniobras de reanimación y la atención de urgencia que el equipo estime necesarias.\n\nFecha: {fecha}',
 'drawn', '[]'::jsonb, NULL
),
(
 'hospitalizacion', 'hospitalizacion', 'Consentimiento de hospitalización',
 E'Yo, {tutor}, responsable de {paciente}, autorizo la hospitalización de mi mascota en {clinica} por el tiempo que el equipo veterinario estime necesario para su tratamiento y observación.\n\nAutorizo la administración de medicamentos, fluidos, alimentación asistida, toma de muestras y los procedimientos de soporte que la evolución del caso requiera. Entiendo que el equipo me mantendrá informado(a) y que, ante una urgencia en que no sea posible contactarme, autorizo la atención necesaria para preservar la vida de {paciente}.\n\nComprendo que el pronóstico puede cambiar durante la hospitalización y que los costos informados son una estimación sujeta a la evolución clínica. Me comprometo a mantener un teléfono de contacto disponible.\n\nFecha: {fecha}',
 'typed', '[]'::jsonb, NULL
),
(
 'eutanasia', 'eutanasia', 'Consentimiento de eutanasia',
 E'Yo, {tutor}, declaro ser el(la) responsable legal de {paciente} y solicitar de forma libre e informada la eutanasia humanitaria de mi mascota, tras haber sido informado(a) por el equipo de {clinica} de su condición y pronóstico.\n\nEntiendo que la eutanasia es un procedimiento irreversible que provoca la muerte del animal de manera indolora, mediante la administración de fármacos por vía intravenosa u otra vía apropiada. Autorizo al médico veterinario a realizar este procedimiento y a administrar previamente sedación.\n\nDeclaro que {paciente} no ha mordido a ninguna persona ni animal en los últimos 10 días, o que he informado al equipo si así ha ocurrido.\n\nHe sido informado(a) de las opciones para el manejo del cuerpo y he indicado mi decisión al equipo.\n\nFecha: {fecha}',
 'drawn', '[]'::jsonb, NULL
),
(
 'tratamiento', 'tratamiento', 'Autorización de tratamiento médico',
 E'Yo, {tutor}, responsable de {paciente}, autorizo al equipo de {clinica} a realizar el tratamiento indicado: {servicio}.\n\nHe sido informado(a) del diagnóstico, del objetivo del tratamiento, de sus alternativas y de los posibles efectos adversos de los medicamentos y procedimientos involucrados.\n\nMe comprometo a administrar los medicamentos según las indicaciones entregadas, a respetar los controles programados y a informar al equipo ante cualquier reacción o empeoramiento. Entiendo que la interrupción del tratamiento sin indicación profesional puede perjudicar a mi mascota.\n\nFecha: {fecha}',
 'typed', '[]'::jsonb, NULL
),
(
 'estetica', 'estetica', 'Consentimiento de estética / peluquería',
 E'Yo, {tutor}, responsable de {paciente}, autorizo al equipo de estética de {clinica} a realizar el servicio de peluquería y/o higiene solicitado.\n\nDeclaro y acepto lo siguiente:\n\n1. NUDOS Y ENREDOS. Si mi mascota presenta pelo muy enredado o apelmazado, autorizo al peluquero(a) a usar su criterio profesional, incluido el rapado a máquina, para retirar los nudos de forma segura y sin dolor. Entiendo que bajo los nudos pueden existir heridas, irritaciones, hongos o lesiones de piel previas que solo se hacen visibles al retirar el pelo, y libero a {clinica} de responsabilidad por pequeñas rozaduras, cortes o irritación asociados a este proceso.\n\n2. COMPORTAMIENTO. Si mi mascota se muestra nerviosa o agresiva, autorizo el uso de bozal y sujeción adicional, y entiendo que el servicio puede suspenderse por su seguridad y la del personal.\n\n3. MASCOTAS SENIOR O CON PROBLEMAS DE SALUD. Entiendo que las mascotas de edad avanzada o con condiciones de salud (cardíacas, respiratorias, epilepsia, entre otras) tienen mayor riesgo de estrés o descompensación durante el baño y el secado. El servicio se realiza bajo mi responsabilidad y me comprometo a informar estas condiciones.\n\n4. URGENCIAS. Autorizo al equipo a brindar la atención veterinaria de urgencia que sea necesaria si mi mascota se descompensa durante el servicio.\n\n5. HALLAZGOS. Autorizo que se me informe de cualquier hallazgo (pulgas, garrapatas, otitis, bultos, problemas de piel o uñas) para su seguimiento.\n\nFecha: {fecha}',
 'typed',
 '[{"key":"nudos_severos","label":"Entiendo que si hay nudos severos se puede requerir rapado","required":false}]'::jsonb,
 365
),
(
 'diagnostico', 'diagnostico', 'Autorización de procedimientos diagnósticos',
 E'Yo, {tutor}, responsable de {paciente}, autorizo al equipo de {clinica} a realizar los procedimientos diagnósticos indicados: {servicio} (que pueden incluir exámenes de sangre, imágenes, toma de muestras, punciones u otros).\n\nHe sido informado(a) del objetivo de estos procedimientos y de que algunos requieren sedación o contención, con los riesgos que ello implica. Entiendo que los resultados pueden requerir estudios adicionales y que su interpretación se realiza en el contexto clínico del paciente.\n\nFecha: {fecha}',
 'typed', '[]'::jsonb, NULL
),
(
 'imagenes', 'imagenes', 'Cesión de imágenes para redes sociales',
 E'Yo, {tutor}, autorizo a {clinica} a tomar fotografías y/o videos de {paciente} durante su atención y a utilizarlos con fines de difusión y educación en sus redes sociales, sitio web y material informativo, sin fines de lucro directo sobre la imagen y sin límite de tiempo.\n\nEsta autorización es voluntaria y puedo revocarla en cualquier momento comunicándome con la clínica, sin que ello afecte la atención de mi mascota.\n\nFecha: {fecha}',
 'one_click',
 '[{"key":"con_nombre","label":"Autorizo que se publique junto al nombre de mi mascota","required":false}]'::jsonb,
 NULL
),
(
 'no_show', 'no_show', 'Política de reservas, atrasos y cancelaciones',
 E'Como responsable de {paciente}, declaro conocer y aceptar la política de reservas de {clinica}:\n\n- Si no puedo asistir a una hora reservada, me comprometo a avisar con anticipación para liberar el cupo.\n- Entiendo que las inasistencias sin aviso y los atrasos significativos pueden implicar la reprogramación de la atención y, según la política de la clínica, un cargo por la hora reservada.\n- Entiendo que el equipo puede solicitar un abono para confirmar ciertas reservas.\n\nFecha: {fecha}',
 'one_click', '[]'::jsonb, NULL
);
$$;

-- Biblioteca en JSON para el frontend (botón "Restaurar texto recomendado").
CREATE OR REPLACE FUNCTION public.get_consent_template_library()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
    FROM public._consent_template_library() l;
$$;
REVOKE ALL ON FUNCTION public.get_consent_template_library() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_consent_template_library() TO authenticated, service_role;

-- Seed idempotente para una clínica. La llama la migración (todas las clínicas)
-- y signup-handler (clínicas nuevas). Guard: un usuario autenticado solo puede
-- re-seedear su propia clínica (inofensivo); service_role, cualquiera.
CREATE OR REPLACE FUNCTION public.seed_consent_templates(p_clinic_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_count INTEGER;
BEGIN
    IF COALESCE(auth.role(), 'service_role') <> 'service_role'
       AND NOT public.is_clinic_member(p_clinic_id) THEN
        RAISE EXCEPTION 'Acceso denegado';
    END IF;

    INSERT INTO public.consent_templates
        (clinic_id, template_key, category, title, body, signature_mode, checkboxes, validity_days)
    SELECT p_clinic_id, l.template_key, l.category, l.title, l.body,
           l.signature_mode, l.checkboxes, l.validity_days
    FROM public._consent_template_library() l
    ON CONFLICT (clinic_id, template_key) DO NOTHING;

    GET DIAGNOSTICS v_count = ROW_COUNT;
    RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.seed_consent_templates(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_consent_templates(UUID) TO authenticated, service_role;

-- ── RPC pública de la página /consentimiento/:token ─────────────────────────
-- Mismo patrón que get_prescription_public: SECURITY DEFINER STABLE, match
-- exacto del token, NUNCA devuelve signer_ip / signer_user_agent / created_by /
-- declined_reason. El branding de la clínica se resuelve en vivo.
CREATE OR REPLACE FUNCTION public.get_consent_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_row  public.consent_records%ROWTYPE;
    result JSONB;
BEGIN
    SELECT * INTO v_row FROM public.consent_records WHERE public_token = p_token LIMIT 1;
    IF v_row.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'consent', jsonb_build_object(
            'template_key',            v_row.template_key,
            'template_title',          v_row.template_title,
            'template_body',           v_row.template_body,
            'checkboxes',              v_row.checkboxes,
            'checkbox_responses',      v_row.checkbox_responses,
            'patient_snapshot',        v_row.patient_snapshot,
            'tutor_name',              v_row.tutor_name,
            'status',                  v_row.status,
            'required_signature_mode', v_row.required_signature_mode,
            'signed_at',               v_row.signed_at,
            'signer_name',             v_row.signer_name,
            'signer_relationship',     v_row.signer_relationship,
            'acceptance_method',       v_row.acceptance_method,
            'signature_url',           v_row.signature_url,
            'short_id',                left(v_row.id::text, 8),
            'issued_at',               v_row.created_at
        ),
        'clinic', jsonb_build_object(
            'clinic_name',           cs.clinic_name,
            'clinic_address',        COALESCE(cs.clinic_address, cs.address),
            'address_references',    cs.address_references,
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
    FROM public.clinic_settings cs
    WHERE cs.id = v_row.clinic_id;

    RETURN result;
END;
$$;

-- Cierre igual que get_prescription_public / las 3 RPCs whitelisted en
-- 20260817170215. Si esa migración de revoke-loop se re-ejecuta, agregar
-- get_consent_public a su whitelist (proname NOT IN (...)).
REVOKE ALL ON FUNCTION public.get_consent_public(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_consent_public(TEXT) TO anon, authenticated;

-- ── Seed a todas las clínicas existentes ────────────────────────────────────
DO $$
DECLARE c RECORD;
BEGIN
    FOR c IN SELECT id FROM public.clinic_settings LOOP
        PERFORM public.seed_consent_templates(c.id);
    END LOOP;
END $$;
