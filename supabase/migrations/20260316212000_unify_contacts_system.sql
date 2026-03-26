-- =============================================
-- Unify Contacts and Tag System
-- =============================================

-- 1. Improved Tag Counts RPC
-- Deduplicates tags by name and counts unique contacts from both Patients and CRM
OR REPLACE FUNCTION public.get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (
    tag_name TEXT,
    tag_color TEXT,
    contact_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH all_tags AS (
        -- Tags from Patients system
        (SELECT t.name, t.color, pt.patient_id as contact_id
         FROM public.tags t
         JOIN public.patient_tags pt ON t.id = pt.tag_id
         WHERE t.clinic_id = p_clinic_id)
        UNION ALL
        -- Tags from CRM system
        (SELECT ct.name, ct.color, cpt.prospect_id as contact_id
         FROM public.crm_tags ct
         JOIN public.crm_prospect_tags cpt ON ct.id = cpt.tag_id
         WHERE ct.clinic_id = p_clinic_id)
    )
    SELECT 
        name as tag_name,
        MAX(color) as tag_color, -- Pick one color if different
        COUNT(DISTINCT contact_id)::BIGINT as contact_count
    FROM all_tags
    GROUP BY name
    ORDER BY contact_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Unified Contacts RPC
-- Returns everyone (Patients + Prospects) with a consistent schema
CREATE OR REPLACE FUNCTION public.get_unified_contacts(p_clinic_id UUID)
RETURNS TABLE (
    id UUID,
    name TEXT,
    phone_number TEXT,
    email TEXT,
    type TEXT, -- 'patient' or 'prospect'
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
        pr.created_at,
        COALESCE(
            (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color))
             FROM public.crm_prospect_tags cpt
             JOIN public.crm_tags t ON cpt.tag_id = t.id
             WHERE cpt.prospect_id = pr.id),
            '[]'::jsonb
        ) as tags
    FROM public.crm_prospects pr
    WHERE pr.clinic_id = p_clinic_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
