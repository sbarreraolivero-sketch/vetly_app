-- Reminders should be OFF by default for new clinics.
-- Before this migration, reminder_24h_before, reminder_2h_before, and
-- request_confirmation defaulted to true, which caused new clinics to
-- start sending reminders before their WhatsApp templates were configured.
ALTER TABLE public.reminder_settings
    ALTER COLUMN reminder_24h_before SET DEFAULT false,
    ALTER COLUMN reminder_2h_before  SET DEFAULT false,
    ALTER COLUMN request_confirmation SET DEFAULT false;
