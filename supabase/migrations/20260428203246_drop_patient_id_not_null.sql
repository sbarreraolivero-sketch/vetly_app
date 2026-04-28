-- Drop NOT NULL constraint on patient_id in appointments table
-- This is necessary because appointments are created via webhook with status 'pending'
-- and patient_id is only assigned later via trigger when status becomes 'completed' or 'confirmed'

ALTER TABLE public.appointments ALTER COLUMN patient_id DROP NOT NULL;
