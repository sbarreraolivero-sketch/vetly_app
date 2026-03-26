-- =============================================
-- Unify Campaign Audience Counting (Name Based)
-- =============================================

DROP FUNCTION IF EXISTS get_estimated_audience(UUID, UUID[], UUID[]);

CREATE OR REPLACE FUNCTION get_estimated_audience(
    p_clinic_id UUID,
    p_inclusion_tags TEXT[], -- Now uses names for easier unification
    p_exclusion_tags TEXT[]
)
RETURNS BIGINT AS $$
DECLARE
    v_count BIGINT;
BEGIN
    WITH unified_tagged_contacts AS (
        -- Patients
        SELECT 
            p.id as contact_id,
            regexp_replace(p.phone_number, '\D', '', 'g') as norm_phone,
            COALESCE(
                (SELECT array_agg(t.name) 
                 FROM patient_tags pt 
                 JOIN tags t ON pt.tag_id = t.id 
                 WHERE pt.patient_id = p.id), 
                '{}'::text[]
            ) as tag_names
        FROM patients p
        WHERE p.clinic_id = p_clinic_id
        
        UNION ALL
        
        -- Prospects (only if not a patient)
        SELECT 
            pr.id as contact_id,
            regexp_replace(pr.phone, '\D', '', 'g') as norm_phone,
            COALESCE(
                (SELECT array_agg(t.name) 
                 FROM crm_prospect_tags cpt 
                 JOIN crm_tags t ON cpt.tag_id = t.id 
                 WHERE cpt.prospect_id = pr.id), 
                '{}'::text[]
            ) as tag_names
        FROM crm_prospects pr
        WHERE pr.clinic_id = p_clinic_id
        AND NOT EXISTS (
            SELECT 1 FROM patients p2 
            WHERE p2.clinic_id = p_clinic_id 
            AND regexp_replace(p2.phone_number, '\D', '', 'g') = regexp_replace(pr.phone, '\D', '', 'g')
        )
    )
    SELECT COUNT(DISTINCT contact_id) INTO v_count
    FROM unified_tagged_contacts utc
    WHERE (
        p_inclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL OR
        tag_names && p_inclusion_tags
    )
    AND (
        p_exclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL OR
        NOT (tag_names && p_exclusion_tags)
    );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
