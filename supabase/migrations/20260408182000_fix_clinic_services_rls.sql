-- Fix RLS policies for clinic_services using clinic_members relationship

DROP POLICY IF EXISTS "Users can view services of their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can insert services for their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can update services of their clinic" ON public.clinic_services;
DROP POLICY IF EXISTS "Users can delete services of their clinic" ON public.clinic_services;

-- 1. View policy
CREATE POLICY "Users can view services of their clinic" 
ON public.clinic_services FOR SELECT 
USING (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
);

-- 2. Insert policy
CREATE POLICY "Users can insert services for their clinic" 
ON public.clinic_services FOR INSERT 
WITH CHECK (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
);

-- 3. Update policy
CREATE POLICY "Users can update services of their clinic" 
ON public.clinic_services FOR UPDATE 
USING (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
)
WITH CHECK (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
);

-- 4. Delete policy
CREATE POLICY "Users can delete services of their clinic" 
ON public.clinic_services FOR DELETE 
USING (
    clinic_id IN (
        SELECT clinic_id FROM public.clinic_members WHERE user_id = auth.uid()
    )
);
