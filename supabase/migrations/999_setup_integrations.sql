
-- =============================================
-- 1. SETUP STORAGE (Idempotent)
-- =============================================

-- Create the bucket if it doesn't exist
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinical-photos', 'clinical-photos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for 'clinical-photos' bucket

-- Helper policy to check if user belongs to the clinic folder they are accessing
-- Paths are expected to be: {clinic_id}/{patient_id}/{filename}

-- ALLOW SELECT (Read)
DROP POLICY IF EXISTS "Authenticated users can view photos from their clinic" ON storage.objects;
CREATE POLICY "Authenticated users can view photos from their clinic"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'clinical-photos' 
  AND auth.role() = 'authenticated'
  AND (
    -- Allow if the first part of the path (clinic_id) matches the user's clinic_id
    (storage.foldername(name))[1]::uuid = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
);

-- ALLOW INSERT (Upload)
DROP POLICY IF EXISTS "Authenticated users can upload photos to their clinic folder" ON storage.objects;
CREATE POLICY "Authenticated users can upload photos to their clinic folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'clinical-photos'
  AND auth.role() = 'authenticated'
  AND (
    (storage.foldername(name))[1]::uuid = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
);

-- ALLOW UPDATE (Create/Modify)
DROP POLICY IF EXISTS "Authenticated users can update photos in their clinic folder" ON storage.objects;
CREATE POLICY "Authenticated users can update photos in their clinic folder"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'clinical-photos'
  AND auth.role() = 'authenticated'
  AND (
    (storage.foldername(name))[1]::uuid = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
);

-- ALLOW DELETE
DROP POLICY IF EXISTS "Authenticated users can delete photos from their clinic folder" ON storage.objects;
CREATE POLICY "Authenticated users can delete photos from their clinic folder"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'clinical-photos'
  AND auth.role() = 'authenticated'
  AND (
    (storage.foldername(name))[1]::uuid = (
      SELECT clinic_id FROM public.user_profiles WHERE id = auth.uid()
    )
  )
);

-- =============================================
-- 2. ENSURE MESSAGES TABLE EXISTS (For logs)
-- =============================================
-- Already in 001_initial_schema.sql but good to verify logging capability
-- No action needed if table exists.

-- =============================================
-- 3. INSTRUCTIONS FOR USER
-- =============================================
-- Go to Settings -> Integrations to enter your YCloud API Key.
