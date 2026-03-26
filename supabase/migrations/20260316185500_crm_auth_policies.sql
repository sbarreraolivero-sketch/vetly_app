-- =============================================
-- RLS Policies for Authenticated Users (CRM)
-- Enables the dashboard to manage prospects, tags, and notes
-- =============================================

-- Ensure RLS is enabled
ALTER TABLE public.crm_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospect_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_pipeline_stages ENABLE ROW LEVEL SECURITY;

-- crm_prospects: Authenticated users can read and update
DROP POLICY IF EXISTS "Authenticated users can read crm_prospects" ON public.crm_prospects;
CREATE POLICY "Authenticated users can read crm_prospects"
  ON public.crm_prospects FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can update crm_prospects" ON public.crm_prospects;
CREATE POLICY "Authenticated users can update crm_prospects"
  ON public.crm_prospects FOR UPDATE
  USING (auth.role() = 'authenticated');

-- crm_tags: Authenticated users can read and manage
DROP POLICY IF EXISTS "Authenticated users can read crm_tags" ON public.crm_tags;
CREATE POLICY "Authenticated users can read crm_tags"
  ON public.crm_tags FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage crm_tags" ON public.crm_tags;
CREATE POLICY "Authenticated users can manage crm_tags"
  ON public.crm_tags FOR ALL
  USING (auth.role() = 'authenticated');

-- crm_prospect_tags: Authenticated users can read and manage
DROP POLICY IF EXISTS "Authenticated users can read crm_prospect_tags" ON public.crm_prospect_tags;
CREATE POLICY "Authenticated users can read crm_prospect_tags"
  ON public.crm_prospect_tags FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated users can manage crm_prospect_tags" ON public.crm_prospect_tags;
CREATE POLICY "Authenticated users can manage crm_prospect_tags"
  ON public.crm_prospect_tags FOR ALL
  USING (auth.role() = 'authenticated');

-- crm_pipeline_stages: Authenticated users can read
DROP POLICY IF EXISTS "Authenticated users can read crm_pipeline_stages" ON public.crm_pipeline_stages;
CREATE POLICY "Authenticated users can read crm_pipeline_stages"
  ON public.crm_pipeline_stages FOR SELECT
  USING (auth.role() = 'authenticated');
