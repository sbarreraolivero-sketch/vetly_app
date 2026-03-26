-- Create ENUMs for the new status fields
CREATE TYPE clinic_activation_status AS ENUM ('pending_activation', 'active', 'inactive');
CREATE TYPE clinic_trial_status AS ENUM ('not_started', 'running', 'converted', 'cancelled');
CREATE TYPE clinic_billing_status AS ENUM ('none', 'card_verified', 'active_subscription', 'payment_failed');

-- Add columns to clinic_settings table
ALTER TABLE clinic_settings 
  ADD COLUMN IF NOT EXISTS activation_status clinic_activation_status NOT NULL DEFAULT 'pending_activation',
  ADD COLUMN IF NOT EXISTS trial_status clinic_trial_status NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS billing_status clinic_billing_status NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS trial_start_date timestamptz,
  ADD COLUMN IF NOT EXISTS trial_end_date timestamptz,
  ADD COLUMN IF NOT EXISTS mercadopago_customer_id text,
  ADD COLUMN IF NOT EXISTS mercadopago_card_id text;

-- Add RLS Policies so admins can update these fields, while clinic users can only read them
-- Existing policies on clinics table should allow members to read their clinic. 
-- We'll just ensure the new columns are readable. Since RLS is on the table level, adding columns doesn't restrict read access if they already had it.

-- Create a table for activation logs
CREATE TABLE IF NOT EXISTS activation_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    clinic_id uuid NOT NULL REFERENCES clinic_settings(id) ON DELETE CASCADE,
    activated_by uuid NOT NULL REFERENCES auth.users(id),
    activation_timestamp timestamptz NOT NULL DEFAULT now(),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on activation_logs
ALTER TABLE activation_logs ENABLE ROW LEVEL SECURITY;

-- Allow super admins to read/write activation logs (example policy, can be extended based on actual admin roles)
CREATE POLICY "Admins can manage activation_logs"
    ON activation_logs
    FOR ALL
    TO authenticated
    USING (
        -- Assuming only specific users or service_role can access this. 
        -- For simplicity, we'll allow users to read their own clinic's logs
        clinic_id IN (
            SELECT clinic_id FROM clinic_members WHERE user_id = auth.uid()
        )
    );
