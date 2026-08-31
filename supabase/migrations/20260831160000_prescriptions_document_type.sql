-- Una "receta" no siempre lleva medicamentos: a veces es una orden para
-- exámenes de imagen (RX, eco), una orden de laboratorio, o una derivación a
-- otro profesional. `document_type` define el título y hace que la lista de
-- medicamentos sea opcional.
--   receta      → Receta médica (default, retrocompatible)
--   orden       → Orden médica (exámenes, procedimientos)
--   derivacion  → Derivación / interconsulta

ALTER TABLE public.prescriptions
    ADD COLUMN IF NOT EXISTS document_type TEXT NOT NULL DEFAULT 'receta';

COMMENT ON COLUMN public.prescriptions.document_type IS
    'receta | orden | derivacion — define el título del documento y si los medicamentos son obligatorios.';

-- get_prescription_public: exponer el tipo de documento.
CREATE OR REPLACE FUNCTION public.get_prescription_public(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row   public.prescriptions%ROWTYPE;
    result  JSONB;
BEGIN
    SELECT * INTO v_row FROM public.prescriptions WHERE public_token = p_token LIMIT 1;
    IF v_row.id IS NULL THEN
        RETURN NULL;
    END IF;

    SELECT jsonb_build_object(
        'prescription', jsonb_build_object(
            'document_type',        v_row.document_type,
            'issued_date',          v_row.issued_date,
            'diagnosis',            v_row.diagnosis,
            'items',                v_row.items,
            'general_instructions', v_row.general_instructions,
            'patient_snapshot',     v_row.patient_snapshot,
            'patient_weight',       v_row.patient_weight,
            'tutor_name',           v_row.tutor_name,
            'prescriber_name',      v_row.prescriber_name,
            'prescriber_license',   v_row.prescriber_license,
            'prescriber_title',     v_row.prescriber_title,
            'prescriber_signature_url', v_row.prescriber_signature_url,
            'folio',                v_row.folio,
            'short_id',             left(v_row.id::text, 8)
        ),
        'clinic', jsonb_build_object(
            'clinic_name',    cs.clinic_name,
            'clinic_address', COALESCE(cs.clinic_address, cs.address),
            'address_references', cs.address_references,
            'country',        cs.country,
            'contact_phone',  cs.contact_phone,
            'logo_url',       cs.booking_logo_url,
            'brand_color',    cs.booking_brand_color,
            'brand_color_secondary', cs.booking_brand_color_secondary,
            'website_url',    cs.website_url,
            'instagram_url',  cs.instagram_url,
            'facebook_url',   cs.facebook_url,
            'tiktok_url',     cs.tiktok_url
        )
    ) INTO result
    FROM public.clinic_settings cs
    WHERE cs.id = v_row.clinic_id;

    RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_prescription_public(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_prescription_public(TEXT) TO anon, authenticated;
