
-- Campaigns table (main)
CREATE TABLE IF NOT EXISTS campaigns (
    id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    clinic_id      UUID NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    segment_tag    TEXT,                                  -- legacy single-tag field (kept for compat)
    inclusion_tags JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of tag UUIDs to include
    exclusion_tags JSONB NOT NULL DEFAULT '[]'::jsonb,   -- array of tag UUIDs to exclude
    template_name  TEXT NOT NULL,
    status         TEXT NOT NULL DEFAULT 'draft'
                       CHECK (status IN ('draft','scheduled','sending','completed','partial','failed')),
    scheduled_at   TIMESTAMPTZ,
    sent_count     INTEGER NOT NULL DEFAULT 0,
    total_target   INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_clinic_id ON campaigns(clinic_id);

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;

-- RLS via clinic_members (multi-clinic safe)
CREATE POLICY "clinic_members_select_campaigns"
    ON campaigns FOR SELECT
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_insert_campaigns"
    ON campaigns FOR INSERT
    WITH CHECK (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_update_campaigns"
    ON campaigns FOR UPDATE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_delete_campaigns"
    ON campaigns FOR DELETE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "service_role_all_campaigns"
    ON campaigns FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- campaign_id FK on messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS campaign_id UUID REFERENCES campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_messages_campaign_id ON messages(campaign_id);

-- get_estimated_audience: counts distinct tutors (phone owners) whose active pets match the tag filters
CREATE OR REPLACE FUNCTION get_estimated_audience(
    p_clinic_id      UUID,
    p_inclusion_tags UUID[],
    p_exclusion_tags UUID[]
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_count BIGINT;
BEGIN
    SELECT COUNT(DISTINCT t.id) INTO v_count
    FROM tutors t
    INNER JOIN patients p
        ON p.tutor_id = t.id
        AND p.clinic_id = p_clinic_id
        AND p.death_date IS NULL
    WHERE t.phone_number IS NOT NULL
      AND (
          -- inclusion: no filter means all tutors
          p_inclusion_tags IS NULL
          OR ARRAY_LENGTH(p_inclusion_tags, 1) IS NULL
          OR EXISTS (
              SELECT 1 FROM patient_tags pt
              WHERE pt.patient_id = p.id
                AND pt.tag_id = ANY(p_inclusion_tags)
          )
      )
      AND (
          -- exclusion: skip tutors whose pets have any excluded tag
          p_exclusion_tags IS NULL
          OR ARRAY_LENGTH(p_exclusion_tags, 1) IS NULL
          OR NOT EXISTS (
              SELECT 1 FROM patient_tags pt
              WHERE pt.patient_id = p.id
                AND pt.tag_id = ANY(p_exclusion_tags)
          )
      );

    RETURN COALESCE(v_count, 0);
END;
$$;
