-- Formulario público de reservas por clínica (plan Core, sin agente de IA):
-- vetly.pro/reservar/:slug -- el cliente ve los servicios marcados como
-- reservables, elige horario y queda confirmado al instante, sin
-- aprobación de nadie (decisión de negocio 2026-08-26: es la vía de
-- agendamiento reemplazo del agente de IA para clínicas Core).

-- 1. Configuración de la página pública, por clínica.
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS public_booking_enabled BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS public_booking_slug TEXT UNIQUE,
    ADD COLUMN IF NOT EXISTS booking_logo_url TEXT,
    ADD COLUMN IF NOT EXISTS booking_brand_color TEXT NOT NULL DEFAULT '#0d9488';

-- 2. Qué servicios expone la clínica en su página pública. Apagado por
-- defecto -- ningún servicio existente queda reservable online sin que la
-- clínica lo elija explícitamente desde Configuración.
ALTER TABLE public.clinic_services
    ADD COLUMN IF NOT EXISTS is_public_bookable BOOLEAN NOT NULL DEFAULT false;

-- 3. booking_source amplía su CHECK para incluir 'online' (antes solo
-- 'manual'/'ai_agent' -- ver sesión 2026-08-25, booking_source ya existe).
ALTER TABLE public.appointments DROP CONSTRAINT IF EXISTS appointments_booking_source_check;
ALTER TABLE public.appointments ADD CONSTRAINT appointments_booking_source_check
    CHECK (booking_source = ANY (ARRAY['manual'::text, 'ai_agent'::text, 'online'::text]));

-- 4. RPCs públicas, sin PII, para armar la página sin necesitar sesión.
-- Todas fallan silenciosamente (devuelven vacío) si la clínica no tiene la
-- página activada -- doble candado además del flag que ya filtra en el
-- frontend, para que no sea posible enumerar clínicas apagadas por slug.

CREATE OR REPLACE FUNCTION public.get_public_booking_clinic(p_slug TEXT)
RETURNS TABLE (
    clinic_id UUID,
    clinic_name TEXT,
    logo_url TEXT,
    brand_color TEXT,
    currency TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id, clinic_name, booking_logo_url, booking_brand_color, COALESCE(currency, 'CLP')
    FROM public.clinic_settings
    WHERE public_booking_slug = p_slug AND public_booking_enabled = true;
$$;

CREATE OR REPLACE FUNCTION public.get_public_booking_services(p_clinic_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    duration INTEGER,
    price NUMERIC
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT cs.id, cs.name, cs.duration, cs.price
    FROM public.clinic_services cs
    JOIN public.clinic_settings c ON c.id = cs.clinic_id
    WHERE cs.clinic_id = p_clinic_id
      AND cs.is_public_bookable = true
      AND c.public_booking_enabled = true
    ORDER BY cs.name;
$$;

CREATE OR REPLACE FUNCTION public.get_public_booking_slots(p_clinic_id UUID, p_date DATE, p_duration INTEGER)
RETURNS TABLE (slot_time TIME, is_available BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.clinic_settings
        WHERE id = p_clinic_id AND public_booking_enabled = true
    ) THEN
        RETURN;
    END IF;

    RETURN QUERY SELECT * FROM public.get_available_slots(p_clinic_id, p_date, p_duration);
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_booking_clinic(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_booking_services(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_public_booking_slots(UUID, DATE, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_clinic(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_services(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_booking_slots(UUID, DATE, INTEGER) TO anon, authenticated;

-- 5. Insert público de citas -- acotado a "online" + confirmada + la
-- clínica debe tener la página activada. No se toca ninguna policy
-- existente (todas son por clinic_members/user_profiles, ninguna afecta a
-- anon); esta es una policy nueva, exclusiva del rol anon.
CREATE POLICY "public_booking_anon_insert" ON public.appointments
    FOR INSERT TO anon
    WITH CHECK (
        booking_source = 'online'
        AND status = 'confirmed'
        AND appointment_date > NOW()
        AND EXISTS (
            SELECT 1 FROM public.clinic_settings cs
            WHERE cs.id = appointments.clinic_id AND cs.public_booking_enabled = true
        )
    );

GRANT INSERT ON public.appointments TO anon;

-- 6. Tutores: el formulario público también crea/reutiliza tutores por
-- teléfono (mismo patrón que el importador CSV). anon ya no tenía ningún
-- acceso a esta tabla -- se acota igual de estricto que hq_appointments:
-- solo INSERT, nunca SELECT completo (evita fuga de contactos de otros
-- tutores vía anon).
CREATE POLICY "public_booking_anon_insert_tutor" ON public.tutors
    FOR INSERT TO anon
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.clinic_settings cs
            WHERE cs.id = tutors.clinic_id AND cs.public_booking_enabled = true
        )
    );

GRANT INSERT ON public.tutors TO anon;

-- RPC para que el formulario público pueda encontrar un tutor existente por
-- teléfono SIN necesitar SELECT de la tabla completa (evita exponer el
-- resto de los tutores de la clínica). Devuelve solo el id -- ni nombre ni
-- email de nadie más.
CREATE OR REPLACE FUNCTION public.find_tutor_by_phone_public(p_clinic_id UUID, p_phone TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT id FROM public.tutors
    WHERE clinic_id = p_clinic_id AND phone_number = p_phone
    LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.find_tutor_by_phone_public(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_tutor_by_phone_public(UUID, TEXT) TO anon, authenticated;

COMMENT ON COLUMN public.clinic_settings.public_booking_slug IS
    'Slug único para la URL pública vetly.pro/reservar/:slug. NULL = la clínica nunca configuró su página.';
