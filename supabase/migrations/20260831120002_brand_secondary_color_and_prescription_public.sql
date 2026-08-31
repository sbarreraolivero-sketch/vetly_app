-- ============================================================================
-- 1. Segundo color de marca
--
-- "Diseño de marca" (antes "Reservas Online") pasa a tener DOS colores:
-- principal + secundario opcional. El sistema arma un gradiente entre ambos
-- para los documentos descargables (recetas) y para el encabezado de la
-- página pública /reservar/:slug. Si el secundario es NULL, el gradiente usa
-- solo el principal (comportamiento actual).
-- ============================================================================

ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS booking_brand_color_secondary TEXT;

COMMENT ON COLUMN public.clinic_settings.booking_brand_color_secondary IS
    'Segundo color de marca (opcional). Con el principal forma un gradiente para recetas y la página de reservas. El prefijo booking_ es histórico.';

-- get_public_booking_clinic: agregar el color secundario. Cambiar el
-- RETURNS TABLE (agregar una columna OUT) exige DROP + CREATE — un
-- CREATE OR REPLACE con distinto tipo de retorno falla con
-- "cannot change return type of existing function". No hay dependencias en
-- DB (solo se llama por RPC desde el frontend).
--
-- ⚠️ La versión en vivo ya devuelve `timezone` (agregada vía MCP, no está en
-- el archivo 20260826000004). PublicBooking.tsx lo usa para calcular los
-- horarios en la zona real de la clínica — hay que PRESERVARLO al recrear.
DROP FUNCTION IF EXISTS public.get_public_booking_clinic(TEXT);
CREATE FUNCTION public.get_public_booking_clinic(p_slug TEXT)
RETURNS TABLE (
    clinic_id UUID,
    clinic_name TEXT,
    logo_url TEXT,
    brand_color TEXT,
    brand_color_secondary TEXT,
    currency TEXT,
    timezone TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, clinic_name, booking_logo_url, booking_brand_color,
           booking_brand_color_secondary, COALESCE(currency, 'CLP'),
           COALESCE(timezone, 'America/Santiago')
    FROM public.clinic_settings
    WHERE public_booking_slug = p_slug AND public_booking_enabled = true;
$$;

REVOKE ALL ON FUNCTION public.get_public_booking_clinic(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_clinic(TEXT) TO anon, authenticated;

-- ============================================================================
-- 2. get_prescription_public — arma la página /receta/:token sin sesión
--
-- Patrón de get_pet_owner_portal: SECURITY DEFINER, RETURNS JSONB, comparación
-- exacta y sensible a mayúsculas del token (no es dictable, no se normaliza).
-- NUNCA devuelve `notes` (campo interno). El encabezado de la clínica se
-- resuelve en vivo acá; los datos de la receta ya vienen snapshoteados en la
-- fila.
-- ============================================================================

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

-- Cierre igual que las 3 RPCs públicas whitelisted en 20260817170215
-- (get_pet_owner_portal, get_referral_link_data, mark_diagnostic_wa_clicked).
-- Si esa migración de revoke-loop se re-ejecuta, agregar get_prescription_public
-- a su whitelist (proname NOT IN (...)).
REVOKE ALL ON FUNCTION public.get_prescription_public(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_prescription_public(TEXT) TO anon, authenticated;
