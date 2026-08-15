-- ============================================================================
-- AISLAMIENTO MULTI-TENANT — tablas centrales
--
-- Problema: la RLS de estas tablas concedía acceso por el simple hecho de estar
-- autenticado, sin filtrar por clínica:
--     ALL · USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
-- Cualquier usuario de cualquier clínica podía leer, modificar y borrar los
-- datos de todas las demás. No había ninguna policy RESTRICTIVE que lo acotara.
--
-- Se reemplaza por is_clinic_member(clinic_id), que ya existe, es SECURITY
-- DEFINER (no recursa sobre la RLS de clinic_members) y ya devuelve TRUE para
-- los platform admins — con lo que el panel HQ conserva su acceso global sin
-- tratamiento especial.
--
-- REVERSIÓN: cada bloque documenta la policy original en su comentario.
-- ============================================================================

-- ── GRUPO 1: tablas con clinic_id propio ───────────────────────────────────

-- tutors — original: "Tutors access" ALL USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
DROP POLICY IF EXISTS "Tutors access" ON public.tutors;
CREATE POLICY tutors_members ON public.tutors FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));
CREATE POLICY tutors_service_role ON public.tutors FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- patients — original: "Patients access" ALL USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
DROP POLICY IF EXISTS "Patients access" ON public.patients;
CREATE POLICY patients_members ON public.patients FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));
CREATE POLICY patients_service_role ON public.patients FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- incomes — original: "Authenticated users can manage incomes" ALL USING (auth.role() = 'authenticated')
DROP POLICY IF EXISTS "Authenticated users can manage incomes" ON public.incomes;
CREATE POLICY incomes_members ON public.incomes FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));

-- reminders — original: "manage_reminders" ALL USING (auth.role() = 'authenticated')
DROP POLICY IF EXISTS manage_reminders ON public.reminders;
CREATE POLICY reminders_members ON public.reminders FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));
CREATE POLICY reminders_service_role ON public.reminders FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- satisfaction_surveys — originales: read/update ALL USING (auth.role() = 'authenticated'), insert sin check
DROP POLICY IF EXISTS "Authenticated users can read surveys"   ON public.satisfaction_surveys;
DROP POLICY IF EXISTS "Authenticated users can update surveys" ON public.satisfaction_surveys;
DROP POLICY IF EXISTS "Authenticated users can insert surveys" ON public.satisfaction_surveys;
CREATE POLICY surveys_members ON public.satisfaction_surveys FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));

-- blocked_dates — original: "manage_blocked_dates" ALL USING (auth.role() = 'authenticated')
DROP POLICY IF EXISTS manage_blocked_dates ON public.blocked_dates;
CREATE POLICY blocked_dates_members ON public.blocked_dates FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));
CREATE POLICY blocked_dates_service_role ON public.blocked_dates FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- crm_pipeline_stages — original: "Allow all for authenticated users on crm_pipeline_stages"
DROP POLICY IF EXISTS "Allow all for authenticated users on crm_pipeline_stages" ON public.crm_pipeline_stages;
CREATE POLICY crm_stages_members ON public.crm_pipeline_stages FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));

-- crm_tags — original: "Allow all for authenticated users on crm_tags"
DROP POLICY IF EXISTS "Allow all for authenticated users on crm_tags" ON public.crm_tags;
CREATE POLICY crm_tags_members ON public.crm_tags FOR ALL TO authenticated
    USING (is_clinic_member(clinic_id)) WITH CHECK (is_clinic_member(clinic_id));

-- ── GRUPO 2: sin clinic_id — se resuelve por el padre ──────────────────────
-- El WITH CHECK valida contra `patients` porque estas tablas NO tienen columna
-- clinic_id: el frontend las inserta solo con patient_id.

-- medical_history — original: "Medical access" ALL USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
DROP POLICY IF EXISTS "Medical access" ON public.medical_history;
CREATE POLICY medical_history_members ON public.medical_history FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM patients p WHERE p.id = medical_history.patient_id AND is_clinic_member(p.clinic_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM patients p WHERE p.id = medical_history.patient_id AND is_clinic_member(p.clinic_id)));
CREATE POLICY medical_history_service_role ON public.medical_history FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- clinical_records — original: "Clinical access" ALL USING (auth.role() = ANY (ARRAY['authenticated','service_role']))
DROP POLICY IF EXISTS "Clinical access" ON public.clinical_records;
CREATE POLICY clinical_records_members ON public.clinical_records FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM patients p WHERE p.id = clinical_records.patient_id AND is_clinic_member(p.clinic_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM patients p WHERE p.id = clinical_records.patient_id AND is_clinic_member(p.clinic_id)));
CREATE POLICY clinical_records_service_role ON public.clinical_records FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- dewormings (0 filas) — original: "Deworming access"
DROP POLICY IF EXISTS "Deworming access" ON public.dewormings;
CREATE POLICY dewormings_members ON public.dewormings FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM patients p WHERE p.id = dewormings.patient_id AND is_clinic_member(p.clinic_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM patients p WHERE p.id = dewormings.patient_id AND is_clinic_member(p.clinic_id)));
CREATE POLICY dewormings_service_role ON public.dewormings FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- vaccinations (0 filas) — original: "Vaccine access"
DROP POLICY IF EXISTS "Vaccine access" ON public.vaccinations;
CREATE POLICY vaccinations_members ON public.vaccinations FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM patients p WHERE p.id = vaccinations.patient_id AND is_clinic_member(p.clinic_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM patients p WHERE p.id = vaccinations.patient_id AND is_clinic_member(p.clinic_id)));
CREATE POLICY vaccinations_service_role ON public.vaccinations FOR ALL TO service_role
    USING (true) WITH CHECK (true);

-- crm_prospect_tags (0 filas) — original: "Allow all for authenticated users on crm_prospect_tags"
DROP POLICY IF EXISTS "Allow all for authenticated users on crm_prospect_tags" ON public.crm_prospect_tags;
CREATE POLICY crm_prospect_tags_members ON public.crm_prospect_tags FOR ALL TO authenticated
    USING      (EXISTS (SELECT 1 FROM crm_prospects cp WHERE cp.id = crm_prospect_tags.prospect_id AND is_clinic_member(cp.clinic_id)))
    WITH CHECK (EXISTS (SELECT 1 FROM crm_prospects cp WHERE cp.id = crm_prospect_tags.prospect_id AND is_clinic_member(cp.clinic_id)));

-- ── GRUPO 3: casos puntuales ───────────────────────────────────────────────

-- clinic_settings: `final_update` permitía a CUALQUIER usuario autenticado
-- modificar la configuración de CUALQUIER clínica — incluidos los prompts de la
-- IA y los tokens de WhatsApp. Las policies "Allow Admins to update" y
-- "Allow Members to update", que sí filtran por clinic_members + rol, se conservan.
-- original: "final_update" UPDATE USING (auth.uid() IS NOT NULL)
DROP POLICY IF EXISTS final_update ON public.clinic_settings;

-- demo_requests / diagnostic_leads: leads comerciales de Vetly, no de las
-- clínicas. Solo el admin de plataforma debe verlos.
-- originales: SELECT TO authenticated USING (true)
DROP POLICY IF EXISTS authenticated_select_demo_requests   ON public.demo_requests;
CREATE POLICY hq_admin_select_demo_requests ON public.demo_requests FOR SELECT TO authenticated
    USING (is_platform_admin());

DROP POLICY IF EXISTS authenticated_select_diagnostic_leads ON public.diagnostic_leads;
CREATE POLICY hq_admin_select_diagnostic_leads ON public.diagnostic_leads FOR SELECT TO authenticated
    USING (is_platform_admin());
