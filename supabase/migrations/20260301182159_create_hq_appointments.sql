-- Supabase migration to create hq_appointments table

CREATE TABLE IF NOT EXISTS public.hq_appointments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    scheduled_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 15,
    status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'no_show', 'cancelled')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS Policies
ALTER TABLE public.hq_appointments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert appointments" ON public.hq_appointments
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Platform admins can view appointments" ON public.hq_appointments
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.platform_admins WHERE id = auth.uid()
        )
    );

CREATE POLICY "Platform admins can update appointments" ON public.hq_appointments
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.platform_admins WHERE id = auth.uid()
        )
    );

CREATE POLICY "Platform admins can delete appointments" ON public.hq_appointments
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.platform_admins WHERE id = auth.uid()
        )
    );
