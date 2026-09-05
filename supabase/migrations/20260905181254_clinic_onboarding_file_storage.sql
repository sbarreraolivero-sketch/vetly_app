-- Bucket privado para los archivos adjuntos del formulario de alta de clínica (/alta-clinica).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'clinic-onboarding', 'clinic-onboarding', false, 15728640,
  ARRAY[
    'application/pdf','image/jpeg','image/png','image/webp','image/heic','image/heif',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel','text/csv','text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword','application/zip','application/x-zip-compressed'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- anon puede SUBIR (solo INSERT) y únicamente dentro de la carpeta de una respuesta
-- real del formulario enviada en las últimas 2 horas. No puede leer, listar ni borrar.
-- Las políticas de Storage deben crearse TO public (no TO authenticated): el servicio
-- de Storage no evalúa las políticas bajo el rol authenticated (regla sesión 86).
DROP POLICY IF EXISTS clinic_onboarding_anon_upload ON storage.objects;
CREATE POLICY clinic_onboarding_anon_upload ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'clinic-onboarding'
    AND (storage.foldername(name))[1] IN (
      SELECT id::text FROM public.clinic_onboarding
      WHERE created_at > now() - interval '2 hours'
    )
  );

-- Solo platform admins leen/descargan (para el panel de HQ).
DROP POLICY IF EXISTS clinic_onboarding_admin_read ON storage.objects;
CREATE POLICY clinic_onboarding_admin_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'clinic-onboarding' AND public.is_platform_admin());

DROP POLICY IF EXISTS clinic_onboarding_service_role_all ON storage.objects;
CREATE POLICY clinic_onboarding_service_role_all ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'clinic-onboarding')
  WITH CHECK (bucket_id = 'clinic-onboarding');
