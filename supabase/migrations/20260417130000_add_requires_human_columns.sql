-- Add requires_human column to tutors and crm_prospects tables to support pausing the AI
ALTER TABLE public.tutors ADD COLUMN IF NOT EXISTS requires_human BOOLEAN DEFAULT false;
ALTER TABLE public.crm_prospects ADD COLUMN IF NOT EXISTS requires_human BOOLEAN DEFAULT false;
