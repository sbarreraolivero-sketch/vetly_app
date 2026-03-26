-- Migration: fix_appointments_delete_policy
-- Description: Enables clinic members to delete appointments and improves logging/robustness.

-- 1. Add DELETE policy for appointments (needed for the "reappearing" issue)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE tablename = 'appointments' AND policyname = 'Members can delete appointments'
    ) THEN
        CREATE POLICY "Members can delete appointments"
          ON public.appointments FOR DELETE
          USING (public.is_clinic_member(clinic_id));
    END IF;
END $$;

-- 2. Ensure professional_id exists (Paranoia check)
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS professional_id UUID REFERENCES public.clinic_members(id) ON DELETE SET NULL;

-- 3. Add index for professional_id to improve scheduling performance
CREATE INDEX IF NOT EXISTS idx_appointments_professional ON public.appointments(professional_id);
