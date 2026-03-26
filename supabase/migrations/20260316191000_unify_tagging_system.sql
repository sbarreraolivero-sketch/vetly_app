-- =============================================
-- Unify Tagging System RPCs
-- Unifies 'tags' and 'crm_tags' for a cohesive experience
-- =============================================

-- 1. Unified Tag Counts (Patients + Prospects)
CREATE OR REPLACE FUNCTION public.get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (
    tag_id UUID,
    tag_name TEXT,
    tag_color TEXT,
    contact_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    WITH all_tags AS (
        SELECT tags.id, tags.name, tags.color, tags.clinic_id FROM public.tags
        UNION ALL
        SELECT crm_tags.id, crm_tags.name, crm_tags.color, crm_tags.clinic_id FROM public.crm_tags
    ),
    all_links AS (
        SELECT patient_tags.tag_id, patient_tags.patient_id as contact_id FROM public.patient_tags
        UNION ALL
        SELECT crm_prospect_tags.tag_id, crm_prospect_tags.prospect_id as contact_id FROM public.crm_prospect_tags
    )
    SELECT 
        at.id as tag_id,
        at.name as tag_name,
        at.color as tag_color,
        COUNT(al.contact_id)::BIGINT as contact_count
    FROM all_tags at
    LEFT JOIN all_links al ON at.id = al.tag_id
    WHERE at.clinic_id = p_clinic_id
    GROUP BY at.id, at.name, at.color
    ORDER BY contact_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Unified Audience Estimation (Patients + Prospects)
-- Counts unique phone numbers that match the tag criteria
CREATE OR REPLACE FUNCTION public.get_estimated_audience(
    p_clinic_id UUID,
    p_inclusion_tags UUID[],
    p_exclusion_tags UUID[]
)
RETURNS BIGINT AS $$
DECLARE
    v_count BIGINT;
BEGIN
    WITH all_contacts AS (
        SELECT id, clinic_id, regexp_replace(phone_number, '\D', '', 'g') as clean_phone FROM public.patients
        UNION ALL
        SELECT id, clinic_id, regexp_replace(phone, '\D', '', 'g') as clean_phone FROM public.crm_prospects
    ),
    all_links AS (
        SELECT patient_id as contact_id, tag_id FROM public.patient_tags
        UNION ALL
        SELECT prospect_id as contact_id, tag_id FROM public.crm_prospect_tags
    ),
    phones_to_exclude AS (
        -- Find all clean_phones that HAVE at least one excluded tag assigned to ANY of their records
        SELECT DISTINCT c.clean_phone
        FROM all_contacts c
        JOIN all_links l ON c.id = l.contact_id
        WHERE l.tag_id = ANY(p_exclusion_tags)
    )
    SELECT COUNT(DISTINCT c.clean_phone) INTO v_count
    FROM all_contacts c
    WHERE c.clinic_id = p_clinic_id
    AND (
        -- Inclusion: Has at least one of the tags (if any provided)
        p_inclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL OR
        EXISTS (
            SELECT 1 FROM all_links l 
            WHERE l.contact_id = c.id 
            AND l.tag_id = ANY(p_inclusion_tags)
        )
    )
    -- Global Exclusion: Phone number must not be in the exclusion list
    AND (
        p_exclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL OR
        c.clean_phone NOT IN (SELECT clean_phone FROM phones_to_exclude)
    );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
