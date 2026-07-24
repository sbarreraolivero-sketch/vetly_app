-- Mismo problema que en reminder_logs (ver migración 20260723000001), pero para
-- la tabla `reminders` (recordatorios médicos: vacunas/desparasitación/checkup,
-- PART 4 del cron). El webhook necesita este ID para correlacionar el evento de
-- estado real (whatsapp.message.updated) con el recordatorio que lo originó.
ALTER TABLE public.reminders
    ADD COLUMN IF NOT EXISTS ycloud_message_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_reminders_ycloud_message_id
    ON public.reminders (ycloud_message_id);
