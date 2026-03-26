-- Create platform_admins table
CREATE TABLE IF NOT EXISTS platform_admins (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email text NOT NULL,
    role text NOT NULL DEFAULT 'super_admin',
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE platform_admins ENABLE ROW LEVEL SECURITY;

-- Policies for platform_admins
CREATE POLICY "Platform admins can view their own record"
    ON platform_admins FOR SELECT
    USING (auth.uid() = id);

-- Grant access to platform admins on clinic_settings
CREATE POLICY "Platform admins can view all clinic settings"
    ON clinic_settings FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM platform_admins WHERE platform_admins.id = auth.uid()
    ));

CREATE POLICY "Platform admins can update clinic settings"
    ON clinic_settings FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM platform_admins WHERE platform_admins.id = auth.uid()
    ));
