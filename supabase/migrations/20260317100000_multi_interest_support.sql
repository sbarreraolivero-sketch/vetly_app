-- =============================================
-- Enhance Unified Contacts with Interests
-- =============================================

DROP FUNCTION IF EXISTS public.get_unified_contacts(UUID);

CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone_number TEXT,
    email TEXT,
    type TEXT, -- 'patient' or 'prospect'
    service TEXT, -- service interest or registered service
    notes TEXT,
    created_at TIMESTAMPTZ,
    tags JSONB
) AS $$
BEGIN
    RETURN QUERY
    -- Patients
    SELECT 
        p.id,
        p.name,
        p.phone_number,
        p.email,
        'patient' as type,
        COALESCE(p.service, p.service_interest) as service,
        p.notes,
        p.created_at,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM public.patient_tags pt
             JOIN public.tags t ON pt.tag_id = t.id
             WHERE pt.patient_id = p.id),
            '[]'::jsonb
        ) as tags
    FROM public.patients p
    WHERE p.clinic_id = p_clinic_id

    UNION ALL

    -- CRM Prospects
    SELECT 
        pr.id,
        pr.name,
        pr.phone as phone_number,
        pr.email,
        'prospect' as type,
        pr.service_interest as service,
        pr.notes,
        pr.created_at,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM public.crm_prospect_tags cpt
             JOIN public.crm_tags t ON cpt.tag_id = t.id
             WHERE cpt.prospect_id = pr.id),
            '[]'::jsonb
        ) as tags
    FROM public.crm_prospects pr
    WHERE pr.clinic_id = p_clinic_id
    AND NOT EXISTS (
        SELECT 1 FROM public.patients p 
        WHERE p.clinic_id = p_clinic_id 
        AND (
            p.phone_number = pr.phone 
            OR regexp_replace(p.phone_number, '\D', '', 'g') = regexp_replace(pr.phone, '\D', '', 'g')
        )
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
