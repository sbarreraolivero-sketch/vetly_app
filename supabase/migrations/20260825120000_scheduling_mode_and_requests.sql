-- Modo de agendamiento configurable por clínica + cola de solicitudes de coordinación.
--
-- Hay clínicas donde la IA puede agendar sola (comportamiento histórico, default) y
-- clínicas móviles donde un espacio libre en la agenda NO significa que sea viable:
-- la ruta del día depende de distancias, comuna y de las otras citas ya agendadas.
-- En esas, la IA recopila datos + disponibilidad amplia del tutor y una persona
-- coordinadora decide qué alternativas ofrecer.
--
-- `scheduling_mode` default 'ai_autonomous' → cero cambios para las clínicas existentes.

ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS scheduling_mode TEXT NOT NULL DEFAULT 'ai_autonomous',
    ADD COLUMN IF NOT EXISTS coordinator_phone TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'clinic_settings_scheduling_mode_check'
    ) THEN
        ALTER TABLE public.clinic_settings
            ADD CONSTRAINT clinic_settings_scheduling_mode_check
            CHECK (scheduling_mode IN ('ai_autonomous', 'coordinator_approval'));
    END IF;
END $$;

-- Cola de solicitudes esperando que la coordinadora defina horarios.
CREATE TABLE IF NOT EXISTS public.scheduling_requests (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id          UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    tutor_id           UUID REFERENCES public.tutors(id) ON DELETE SET NULL,
    -- Normalizado (solo dígitos), mismo formato que tutors.phone_number.
    tutor_phone        TEXT NOT NULL,
    tutor_name         TEXT NOT NULL,
    pet_name           TEXT,
    pet_details        TEXT,
    service_requested  TEXT NOT NULL,
    comuna             TEXT,
    sector             TEXT,
    address            TEXT,
    is_urgent          BOOLEAN NOT NULL DEFAULT false,
    -- Texto libre: "martes después de 15:00, miércoles todo el día o viernes AM".
    availability_text  TEXT NOT NULL,
    additional_notes   TEXT,
    status             TEXT NOT NULL DEFAULT 'pending',
    -- Texto libre escrito por la coordinadora con las alternativas que sí puede ofrecer.
    authorized_options TEXT,
    -- Se incrementa cada vez que vuelve a 'pending' (al tutor no le sirvió ninguna opción).
    round              INT NOT NULL DEFAULT 1,
    reviewed_by        UUID,
    reviewed_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT scheduling_requests_status_check
        CHECK (status IN ('pending', 'authorized', 'fulfilled', 'dismissed'))
);

-- Un tutor no puede tener dos solicitudes abiertas a la vez: fuerza que el webhook
-- actualice la fila existente en vez de insertar duplicados en cada ronda.
CREATE UNIQUE INDEX IF NOT EXISTS scheduling_requests_open_unique
    ON public.scheduling_requests (clinic_id, tutor_phone)
    WHERE status IN ('pending', 'authorized');

CREATE INDEX IF NOT EXISTS idx_scheduling_requests_clinic_status
    ON public.scheduling_requests (clinic_id, status, created_at);

ALTER TABLE public.scheduling_requests ENABLE ROW LEVEL SECURITY;

-- RLS estándar del proyecto: clinic_members (soporta usuarios multi-sucursal).
-- Sin policy de INSERT/DELETE para authenticated: las filas las crea siempre el
-- webhook con service_role; el dashboard solo autoriza o descarta (UPDATE).
DROP POLICY IF EXISTS "scheduling_requests_select" ON public.scheduling_requests;
CREATE POLICY "scheduling_requests_select" ON public.scheduling_requests
    FOR SELECT TO authenticated
    USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "scheduling_requests_update" ON public.scheduling_requests;
CREATE POLICY "scheduling_requests_update" ON public.scheduling_requests
    FOR UPDATE TO authenticated
    USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ))
    WITH CHECK (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "scheduling_requests_service_role" ON public.scheduling_requests;
CREATE POLICY "scheduling_requests_service_role" ON public.scheduling_requests
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP TRIGGER IF EXISTS scheduling_requests_updated_at ON public.scheduling_requests;
CREATE TRIGGER scheduling_requests_updated_at
    BEFORE UPDATE ON public.scheduling_requests
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
