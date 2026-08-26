-- clinic_settings no tiene NINGUNA fila visible para anon bajo su propia RLS
-- (correcto en general -- nadie externo debe poder leer la config de una
-- clínica). Eso significa que un EXISTS(SELECT ... FROM clinic_settings ...)
-- dentro de un WITH CHECK, al ser una subconsulta de tabla plana, hereda esa
-- misma RLS y siempre da 0 filas para anon, aunque public_booking_enabled
-- sea true. Se necesita un helper SECURITY DEFINER (como ya usan
-- is_clinic_member/is_platform_admin) que evite la RLS de clinic_settings,
-- igual que ya hacían las RPCs get_public_booking_*.
CREATE OR REPLACE FUNCTION public.clinic_has_public_booking(p_clinic_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.clinic_settings
        WHERE id = p_clinic_id AND public_booking_enabled = true
    );
$$;

REVOKE ALL ON FUNCTION public.clinic_has_public_booking(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.clinic_has_public_booking(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "public_booking_anon_insert" ON public.appointments;
CREATE POLICY "public_booking_anon_insert" ON public.appointments
    FOR INSERT TO anon
    WITH CHECK (
        booking_source = 'online'
        AND status = 'confirmed'
        AND appointment_date > NOW()
        AND public.clinic_has_public_booking(clinic_id)
    );

DROP POLICY IF EXISTS "public_booking_anon_insert_tutor" ON public.tutors;
CREATE POLICY "public_booking_anon_insert_tutor" ON public.tutors
    FOR INSERT TO anon
    WITH CHECK (public.clinic_has_public_booking(clinic_id));
