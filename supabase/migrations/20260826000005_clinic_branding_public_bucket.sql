-- Bucket público para logos de la página de reservas online -- distinto de
-- los buckets privados existentes (patient-documents, expense-receipts):
-- un logo está pensado para verse sin login, en la página pública de la
-- clínica. Solo logos van acá, nada de datos de pacientes.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('clinic-branding', 'clinic-branding', true, 2097152, ARRAY['image/png','image/jpeg','image/webp','image/svg+xml'])
ON CONFLICT (id) DO NOTHING;

-- Escritura solo para miembros activos de la clínica dueña de la carpeta
-- (primer segmento del path = clinic_id, mismo patrón que expense-receipts).
-- Lectura: el bucket ya es público, no requiere policy de SELECT.
CREATE POLICY "clinic_branding_members_write" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'clinic-branding'
        AND (storage.foldername(name))[1]::uuid IN (
            SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "clinic_branding_members_update" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'clinic-branding'
        AND (storage.foldername(name))[1]::uuid IN (
            SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'
        )
    );

CREATE POLICY "clinic_branding_members_delete" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'clinic-branding'
        AND (storage.foldername(name))[1]::uuid IN (
            SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid() AND status = 'active'
        )
    );
