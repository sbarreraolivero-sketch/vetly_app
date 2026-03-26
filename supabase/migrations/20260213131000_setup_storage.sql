-- =============================================
-- STORAGE: Custom Bucket for Clinical Photos
-- =============================================

-- Create the bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('clinical-photos', 'clinical-photos', false)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for 'clinical-photos' bucket

-- 1. Helper policy to check if user belongs to the clinic folder they are accessing
-- Paths are expected to be: {clinic_id}/{patient_id}/{filename}

-- ALLOW SELECT (Read)
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
-- Needed for some operations, essentially same as insert
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
