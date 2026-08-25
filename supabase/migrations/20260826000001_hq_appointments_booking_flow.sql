-- Reemplaza el flujo roto de agendamiento HQ (HQBookingForm.tsx -> hq_appointments,
-- tabla que nunca llegó a crearse en producción pese a tener migración local desde
-- 2026-03-01, y send-booking-email, función que nunca existió).
--
-- Sesión 2026-08-25: nuevo formulario público /agendar, conectado directo al panel
-- HQ (AdminCalendar.tsx ya sabía leer esta tabla, solo nunca existió).

CREATE TABLE IF NOT EXISTS public.hq_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE SET NULL,
    contact_name TEXT NOT NULL,
    contact_email TEXT NOT NULL,
    contact_phone TEXT,
    plan TEXT,
    scheduled_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'welcome_email',
    reminder_sent_at TIMESTAMPTZ,
    client_notified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hq_appointments_scheduled_pending
    ON public.hq_appointments (scheduled_at)
    WHERE status = 'scheduled';

CREATE INDEX IF NOT EXISTS idx_hq_appointments_clinic
    ON public.hq_appointments (clinic_id);

ALTER TABLE public.hq_appointments ENABLE ROW LEVEL SECURITY;

-- El formulario público de /agendar no requiere sesión: cualquiera con el link
-- del correo puede reservar. Acotado a filas nuevas en estado 'scheduled' y con
-- fecha futura, para que un insert malicioso no pueda marcar citas como
-- 'completed' ni backdatear el calendario del HQ.
CREATE POLICY "hq_appointments_public_insert" ON public.hq_appointments
    FOR INSERT TO anon, authenticated
    WITH CHECK (status = 'scheduled' AND scheduled_at > NOW());

-- Lectura/gestión solo para el equipo de Vetly (mismo helper que el resto del
-- panel HQ, sesión 74).
CREATE POLICY "hq_appointments_admin_select" ON public.hq_appointments
    FOR SELECT TO authenticated
    USING (public.is_platform_admin());

CREATE POLICY "hq_appointments_admin_update" ON public.hq_appointments
    FOR UPDATE TO authenticated
    USING (public.is_platform_admin())
    WITH CHECK (public.is_platform_admin());

CREATE POLICY "hq_appointments_admin_delete" ON public.hq_appointments
    FOR DELETE TO authenticated
    USING (public.is_platform_admin());

CREATE POLICY "hq_appointments_service_role" ON public.hq_appointments
    FOR ALL TO service_role
    USING (true) WITH CHECK (true);

REVOKE ALL ON public.hq_appointments FROM PUBLIC, anon, authenticated;
GRANT INSERT ON public.hq_appointments TO anon, authenticated;
GRANT SELECT, UPDATE, DELETE ON public.hq_appointments TO authenticated;
GRANT ALL ON public.hq_appointments TO service_role;

-- RPC de solo lectura, sin PII, para que el formulario público pueda apagar
-- horarios ya tomados sin exponer nombre/email/teléfono de otros que reservaron
-- (la fuga que la sesión 74/77 encontró y cerró en otras tablas; acá se evita
-- de raíz no dando SELECT de la tabla completa a anon).
CREATE OR REPLACE FUNCTION public.get_hq_booked_slots(p_days INTEGER DEFAULT 21)
RETURNS TABLE (scheduled_at TIMESTAMPTZ)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT ha.scheduled_at
    FROM public.hq_appointments ha
    WHERE ha.status = 'scheduled'
      AND ha.scheduled_at BETWEEN NOW() AND NOW() + (p_days || ' days')::INTERVAL;
$$;

REVOKE ALL ON FUNCTION public.get_hq_booked_slots(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_hq_booked_slots(INTEGER) TO anon, authenticated;

COMMENT ON TABLE public.hq_appointments IS
    'Videollamadas de activación/onboarding agendadas por clientes vía /agendar. Gestionadas desde AdminCalendar.tsx (panel HQ).';
