-- Migration: Multi-currency support for payments
-- Description: Adds a currency field to clinic_settings and updates relevant tables.

ALTER TABLE clinic_settings ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'CLP';
COMMENT ON COLUMN clinic_settings.currency IS 'Default currency for the clinic (USD, ARS, CLP, MXN, COP, PEN)';

-- Update existing clinics to CLP or ARS based on some logic or just leave default
-- For now we just add the column.
