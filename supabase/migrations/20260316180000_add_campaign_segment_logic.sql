-- Add inclusion and exclusion tags to campaigns
ALTER TABLE campaigns 
ADD COLUMN IF NOT EXISTS inclusion_tags JSONB DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS exclusion_tags JSONB DEFAULT '[]'::jsonb;

-- Function to get tag counts for a clinic
CREATE OR REPLACE FUNCTION get_tag_counts(p_clinic_id UUID)
RETURNS TABLE (
    tag_id UUID,
    tag_name TEXT,
    tag_color TEXT,
    contact_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        t.id as tag_id,
        t.name as tag_name,
        t.color as tag_color,
        COUNT(pt.patient_id)::BIGINT as contact_count
    FROM tags t
    LEFT JOIN patient_tags pt ON t.id = pt.tag_id
    WHERE t.clinic_id = p_clinic_id
    GROUP BY t.id, t.name, t.color
    ORDER BY contact_count DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get estimated audience based on inclusion/exclusion tags
CREATE OR REPLACE FUNCTION get_estimated_audience(
    p_clinic_id UUID,
    p_inclusion_tags UUID[],
    p_exclusion_tags UUID[]
)
RETURNS BIGINT AS $$
DECLARE
    v_count BIGINT;
BEGIN
    SELECT COUNT(DISTINCT p.id) INTO v_count
    FROM patients p
    WHERE p.clinic_id = p_clinic_id
    AND (
        -- Inclusion: Has at least one of the tags (if any provided)
        p_inclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL OR
        EXISTS (
            SELECT 1 FROM patient_tags pt 
            WHERE pt.patient_id = p.id 
            AND pt.tag_id = ANY(p_inclusion_tags)
        )
    )
    AND (
        -- Exclusion: Does NOT have any of the tags
        p_exclusion_tags IS NULL OR 
        ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL OR
        NOT EXISTS (
            SELECT 1 FROM patient_tags pt 
            WHERE pt.patient_id = p.id 
            AND pt.tag_id = ANY(p_exclusion_tags)
        )
    );
    
    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
