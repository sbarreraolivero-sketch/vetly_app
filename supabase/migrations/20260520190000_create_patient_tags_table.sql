-- Create patient_tags junction table for AI agent segmentation
-- Fixes: tag_patient tool was failing because this table didn't exist

CREATE TABLE IF NOT EXISTS patient_tags (
    patient_id UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
    tag_id     UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (patient_id, tag_id)
);

CREATE INDEX IF NOT EXISTS patient_tags_tag_id_idx ON patient_tags(tag_id);
CREATE INDEX IF NOT EXISTS patient_tags_patient_id_idx ON patient_tags(patient_id);

ALTER TABLE patient_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select_patient_tags"
    ON patient_tags FOR SELECT
    USING (
        patient_id IN (
            SELECT p.id FROM patients p
            WHERE p.clinic_id IN (
                SELECT clinic_id FROM clinic_members
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
    );

CREATE POLICY "clinic_members_insert_patient_tags"
    ON patient_tags FOR INSERT
    WITH CHECK (
        patient_id IN (
            SELECT p.id FROM patients p
            WHERE p.clinic_id IN (
                SELECT clinic_id FROM clinic_members
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
    );

CREATE POLICY "clinic_members_delete_patient_tags"
    ON patient_tags FOR DELETE
    USING (
        patient_id IN (
            SELECT p.id FROM patients p
            WHERE p.clinic_id IN (
                SELECT clinic_id FROM clinic_members
                WHERE user_id = auth.uid() AND status = 'active'
            )
        )
    );

CREATE POLICY "service_role_all_patient_tags"
    ON patient_tags FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
