-- =============================================
-- Service Role policies for CRM + knowledge_base + services
-- So the webhook edge function can insert prospects and read knowledge
-- =============================================

-- crm_pipeline_stages: service_role full access
CREATE POLICY "Service role full access to crm_pipeline_stages"
  ON public.crm_pipeline_stages FOR ALL
  USING (auth.role() = 'service_role');

-- crm_prospects: service_role full access
CREATE POLICY "Service role full access to crm_prospects"
  ON public.crm_prospects FOR ALL
  USING (auth.role() = 'service_role');

-- crm_tags: service_role full access
CREATE POLICY "Service role full access to crm_tags"
  ON public.crm_tags FOR ALL
  USING (auth.role() = 'service_role');

-- crm_prospect_tags: service_role full access
CREATE POLICY "Service role full access to crm_prospect_tags"
  ON public.crm_prospect_tags FOR ALL
  USING (auth.role() = 'service_role');

-- services table: service_role full access (for agent get_services)
CREATE POLICY "Service role full access to services"
  ON public.services FOR ALL
  USING (auth.role() = 'service_role');

-- knowledge_base table: service_role full access (for agent knowledge search)
CREATE POLICY "Service role full access to knowledge_base"
  ON public.knowledge_base FOR ALL
  USING (auth.role() = 'service_role');

-- =============================================
-- Delete test messages for a clean start
-- =============================================
DELETE FROM public.messages;
