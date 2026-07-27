-- Plan de ruta por fecha (overrides esporádicos de sectorización).
--
-- Permite decir "el martes 28 solo atendemos Linares, el miércoles 29 solo Talca"
-- sin tocar código ni el prompt. Una fecha SIN fila se comporta exactamente como
-- hoy (sin restricción) — esto es un override puntual, no un régimen nuevo.
--
-- `allowed_sectors` guarda los sectores habilitados ese día, con los mismos
-- nombres que devuelve getSectorAG() en ycloud-whatsapp-webhook: 'Linares' | 'Talca'.
-- Un array vacío se trata como "sin restricción" (equivale a no tener fila).

CREATE TABLE IF NOT EXISTS public.clinic_route_plan (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id       UUID NOT NULL REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    date            DATE NOT NULL,
    allowed_sectors TEXT[] NOT NULL DEFAULT '{}',
    note            TEXT,
    created_by      UUID,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (clinic_id, date)
);

CREATE INDEX IF NOT EXISTS idx_clinic_route_plan_clinic_date
    ON public.clinic_route_plan (clinic_id, date);

ALTER TABLE public.clinic_route_plan ENABLE ROW LEVEL SECURITY;

-- RLS estándar del proyecto: clinic_members (soporta usuarios multi-sucursal).
DROP POLICY IF EXISTS "route_plan_select" ON public.clinic_route_plan;
CREATE POLICY "route_plan_select" ON public.clinic_route_plan
    FOR SELECT TO authenticated
    USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "route_plan_insert" ON public.clinic_route_plan;
CREATE POLICY "route_plan_insert" ON public.clinic_route_plan
    FOR INSERT TO authenticated
    WITH CHECK (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "route_plan_update" ON public.clinic_route_plan;
CREATE POLICY "route_plan_update" ON public.clinic_route_plan
    FOR UPDATE TO authenticated
    USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ))
    WITH CHECK (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "route_plan_delete" ON public.clinic_route_plan;
CREATE POLICY "route_plan_delete" ON public.clinic_route_plan
    FOR DELETE TO authenticated
    USING (clinic_id IN (
        SELECT cm.clinic_id FROM public.clinic_members cm
        WHERE cm.user_id = auth.uid() AND cm.status = 'active'
    ));

DROP POLICY IF EXISTS "route_plan_service_role" ON public.clinic_route_plan;
CREATE POLICY "route_plan_service_role" ON public.clinic_route_plan
    FOR ALL TO service_role USING (true) WITH CHECK (true);
