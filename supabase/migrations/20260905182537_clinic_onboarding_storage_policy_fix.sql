-- La política de storage anterior tenía un subquery a public.clinic_onboarding que
-- corre bajo el rol anon (sujeto a RLS) → anon no ve ninguna fila → el IN siempre
-- daba falso y todo INSERT fallaba. Se reemplaza por un helper SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.onboarding_folder_is_recent(p_folder text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clinic_onboarding
    WHERE id::text = p_folder
      AND created_at > now() - interval '2 hours'
  );
$$;
REVOKE ALL ON FUNCTION public.onboarding_folder_is_recent(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.onboarding_folder_is_recent(text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS clinic_onboarding_anon_upload ON storage.objects;
CREATE POLICY clinic_onboarding_anon_upload ON storage.objects
  FOR INSERT TO public
  WITH CHECK (
    bucket_id = 'clinic-onboarding'
    AND public.onboarding_folder_is_recent((storage.foldername(name))[1])
  );
