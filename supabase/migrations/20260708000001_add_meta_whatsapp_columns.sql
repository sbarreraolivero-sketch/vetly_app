-- Migration: add_meta_whatsapp_columns
-- Adds Meta Cloud API integration fields to clinic_settings.
-- DB already has these columns applied via MCP in prior session;
-- this file ensures the migration is tracked in version control.

ALTER TABLE public.clinic_settings
  ADD COLUMN IF NOT EXISTS meta_phone_number_id TEXT,
  ADD COLUMN IF NOT EXISTS meta_access_token    TEXT,
  ADD COLUMN IF NOT EXISTS meta_waba_id         TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_provider    TEXT DEFAULT 'ycloud';

COMMENT ON COLUMN public.clinic_settings.meta_phone_number_id IS 'Meta Cloud API Phone Number ID (e.g. 1199762829882743)';
COMMENT ON COLUMN public.clinic_settings.meta_access_token    IS 'Meta System User Token — permanent, never expires';
COMMENT ON COLUMN public.clinic_settings.meta_waba_id         IS 'WhatsApp Business Account ID';
COMMENT ON COLUMN public.clinic_settings.whatsapp_provider    IS 'ycloud | meta — transport layer used for outbound messages';
