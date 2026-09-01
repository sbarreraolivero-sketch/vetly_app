-- Cierra 3 huecos reales detectados en el flujo de /agendar (2026-09-01):
-- 1) Sebastián solo recibía confirmación de reserva por WhatsApp, nunca por
--    correo (hq-booking-notify solo mandaba email al prospecto).
-- 2) Mismo problema en el recordatorio de 1 día antes (cron-hq-appointment-
--    reminders): solo WhatsApp al founder, sin correo.
-- 3) No existía NINGÚN recordatorio de 2 horas antes -- ni al prospecto ni
--    al founder, ni por correo ni por WhatsApp. Solo había un recordatorio
--    de "1 día antes".

-- Email de escalación del founder, configurable igual que hq_escalation_phone
-- (en vez de hardcodear la dirección en el código de cada función).
ALTER TABLE public.clinic_settings ADD COLUMN IF NOT EXISTS hq_escalation_email TEXT;
UPDATE public.clinic_settings
SET hq_escalation_email = 'sbarrera.olivero@gmail.com'
WHERE id = '00000000-0000-0000-0000-000000000000' AND hq_escalation_email IS NULL;

-- Idempotencia del recordatorio de 2h, mismo patrón que reminder_sent_at
-- (1 día antes) -- columna separada para no pisar ni depender de la otra.
ALTER TABLE public.hq_appointments ADD COLUMN IF NOT EXISTS reminder_2h_sent_at TIMESTAMPTZ;
