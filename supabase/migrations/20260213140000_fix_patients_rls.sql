-- Allow authenticated users to manage patients (INSERT, UPDATE, DELETE)
-- The initial schema only had a SELECT policy

CREATE POLICY "Authenticated users can manage patients"
ON public.patients
FOR ALL
USING (auth.role() = 'authenticated');
