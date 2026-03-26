
-- =============================================================
-- VETLY AI: RESTORE CRM MODULE TABLES
-- Recreates missing CRM tables needed for Tutors & Prospects view.
-- =============================================================

-- 1. crm_pipeline_stages
CREATE TABLE IF NOT EXISTS public.crm_pipeline_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    position INTEGER DEFAULT 0,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. crm_prospects
CREATE TABLE IF NOT EXISTS public.crm_prospects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    stage_id UUID REFERENCES public.crm_pipeline_stages(id) ON DELETE SET NULL,
    name TEXT,
    phone TEXT,
    email TEXT,
    address TEXT,
    service_interest TEXT,
    source TEXT DEFAULT 'whatsapp',
    notes TEXT,
    score INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. crm_tags
CREATE TABLE IF NOT EXISTS public.crm_tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clinic_id UUID REFERENCES public.clinic_settings(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#3B82F6',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. crm_prospect_tags
CREATE TABLE IF NOT EXISTS public.crm_prospect_tags (
    prospect_id UUID REFERENCES public.crm_prospects(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES public.crm_tags(id) ON DELETE CASCADE,
    PRIMARY KEY (prospect_id, tag_id)
);

-- 5. RLS Policies
ALTER TABLE public.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospect_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all for authenticated users on crm_pipeline_stages" ON public.crm_pipeline_stages FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users on crm_prospects" ON public.crm_prospects FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users on crm_tags" ON public.crm_tags FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Allow all for authenticated users on crm_prospect_tags" ON public.crm_prospect_tags FOR ALL USING (auth.role() = 'authenticated');

-- Service role access
CREATE POLICY "Service role access crm_pipeline_stages" ON public.crm_pipeline_stages FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access crm_prospects" ON public.crm_prospects FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access crm_tags" ON public.crm_tags FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role access crm_prospect_tags" ON public.crm_prospect_tags FOR ALL USING (auth.role() = 'service_role');

-- 6. Indices
CREATE INDEX IF NOT EXISTS idx_crm_prospects_clinic ON public.crm_prospects(clinic_id);
CREATE INDEX IF NOT EXISTS idx_crm_prospects_phone ON public.crm_prospects(phone);
CREATE INDEX IF NOT EXISTS idx_crm_tags_clinic ON public.crm_tags(clinic_id);

-- 7. Triggers for updated_at
DROP TRIGGER IF EXISTS update_crm_pipeline_stages_updated_at ON public.crm_pipeline_stages;
CREATE TRIGGER update_crm_pipeline_stages_updated_at BEFORE UPDATE ON public.crm_pipeline_stages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

DROP TRIGGER IF EXISTS update_crm_prospects_updated_at ON public.crm_prospects;
CREATE TRIGGER update_crm_prospects_updated_at BEFORE UPDATE ON public.crm_prospects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
