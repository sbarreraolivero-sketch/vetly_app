
-- ============================================================
-- vaccines (active table with 57 rows, no RLS)
-- ============================================================
ALTER TABLE vaccines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select_vaccines"
    ON vaccines FOR SELECT
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_insert_vaccines"
    ON vaccines FOR INSERT
    WITH CHECK (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_update_vaccines"
    ON vaccines FOR UPDATE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_delete_vaccines"
    ON vaccines FOR DELETE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "service_role_all_vaccines"
    ON vaccines FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- deworming (active table with 29 rows, no RLS)
-- ============================================================
ALTER TABLE deworming ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select_deworming"
    ON deworming FOR SELECT
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_insert_deworming"
    ON deworming FOR INSERT
    WITH CHECK (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_update_deworming"
    ON deworming FOR UPDATE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_delete_deworming"
    ON deworming FOR DELETE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "service_role_all_deworming"
    ON deworming FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- patient_files (archivos médicos, clinic_id presente)
-- ============================================================
ALTER TABLE patient_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select_patient_files"
    ON patient_files FOR SELECT
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_insert_patient_files"
    ON patient_files FOR INSERT
    WITH CHECK (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_update_patient_files"
    ON patient_files FOR UPDATE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_delete_patient_files"
    ON patient_files FOR DELETE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "service_role_all_patient_files"
    ON patient_files FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- notifications (alertas de la app, clinic_id presente)
-- ============================================================
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "clinic_members_select_notifications"
    ON notifications FOR SELECT
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_insert_notifications"
    ON notifications FOR INSERT
    WITH CHECK (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "clinic_members_update_notifications"
    ON notifications FOR UPDATE
    USING (clinic_id IN (
        SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid() AND status = 'active'
    ));

CREATE POLICY "service_role_all_notifications"
    ON notifications FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- user_profiles (perfiles de usuario, id = auth.uid())
-- ============================================================
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_select_own_profile"
    ON user_profiles FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "users_update_own_profile"
    ON user_profiles FOR UPDATE
    USING (id = auth.uid());

CREATE POLICY "users_insert_own_profile"
    ON user_profiles FOR INSERT
    WITH CHECK (id = auth.uid());

CREATE POLICY "service_role_all_user_profiles"
    ON user_profiles FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');


-- ============================================================
-- platform_admins (tabla de control interno)
-- ============================================================
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins_select_own_row"
    ON platform_admins FOR SELECT
    USING (id = auth.uid());

CREATE POLICY "service_role_all_platform_admins"
    ON platform_admins FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');
