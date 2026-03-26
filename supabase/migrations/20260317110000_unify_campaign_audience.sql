-- =============================================
-- Unify Campaign Audience Counting
-- =============================================

CREATE OR REPLACE FUNCTION get_estimated_audience(
    p_clinic_id UUID,
    p_inclusion_tags UUID[],
    p_exclusion_tags UUID[]
)
RETURNS BIGINT AS $$
DECLARE
    v_count BIGINT;
BEGIN
    -- We use a CTE to unify contacts with normalized phone numbers to avoid double counting
    -- if a contact exists in both tables (prioritizing patients).
    WITH unified_tagged_contacts AS (
        -- Patients with their tags
        SELECT 
            p.id as contact_id,
            regexp_replace(p.phone_number, '\D', '', 'g') as norm_phone,
            array_agg(pt.tag_id) as tag_ids
        FROM patients p
        LEFT JOIN patient_tags pt ON p.id = pt.patient_id
        WHERE p.clinic_id = p_clinic_id
        GROUP BY p.id, p.phone_number
        
        UNION ALL
        
        -- Prospects with their tags, only if they don't exist as patients (by normalized phone)
        SELECT 
            pr.id as contact_id,
            regexp_replace(pr.phone, '\D', '', 'g') as norm_phone,
            array_agg(cpt.tag_id) as tag_ids
        FROM crm_prospects pr
        LEFT JOIN crm_prospect_tags cpt ON pr.id = cpt.prospect_id
        WHERE pr.clinic_id = p_clinic_id
        AND NOT EXISTS (
            SELECT 1 FROM patients p2 
            WHERE p2.clinic_id = p_clinic_id 
            AND regexp_replace(p2.phone_number, '\D', '', 'g') = regexp_replace(pr.phone, '\D', '', 'g')
        )
        GROUP BY pr.id, pr.phone
    )
    SELECT COUNT(DISTINCT contact_id) INTO v_count
    FROM unified_tagged_contacts utc
    WHERE (
        -- Inclusion logic: Has at least one of the inclusion tags
        p_inclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL OR
        tag_ids && p_inclusion_tags -- Overlap operator
    )
    AND (
        -- Exclusion logic: Does NOT have any of the exclusion tags
        p_exclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL OR
        NOT (tag_ids && p_exclusion_tags)
    );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
