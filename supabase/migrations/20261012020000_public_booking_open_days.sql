-- Días en que la clínica atiende (según working_hours y días bloqueados), para que la
-- página de reservas no oculte sábados/domingos abiertos ni ofrezca días cerrados.
CREATE OR REPLACE FUNCTION public.get_public_booking_open_days(p_clinic_id uuid, p_from date, p_days integer DEFAULT 30)
 RETURNS TABLE(open_date date)
 LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_wh JSONB;
    d date;
    v_day JSONB;
    v_name TEXT;
BEGIN
    SELECT working_hours INTO v_wh FROM public.clinic_settings
    WHERE id = p_clinic_id AND public_booking_enabled = true;
    IF v_wh IS NULL THEN RETURN; END IF;

    FOR d IN SELECT generate_series(p_from, p_from + LEAST(GREATEST(p_days,1), 60) - 1, interval '1 day')::date LOOP
        v_name := (ARRAY['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[EXTRACT(DOW FROM d)::int + 1];
        v_day := v_wh -> v_name;
        CONTINUE WHEN v_day IS NULL OR v_day = 'null'::jsonb OR (v_day->>'enabled')::BOOLEAN IS FALSE;
        CONTINUE WHEN EXISTS (SELECT 1 FROM public.clinic_blocked_dates WHERE clinic_id = p_clinic_id AND blocked_date = d);
        open_date := d;
        RETURN NEXT;
    END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_public_booking_open_days(uuid, date, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_booking_open_days(uuid, date, integer) TO anon, authenticated, service_role;
