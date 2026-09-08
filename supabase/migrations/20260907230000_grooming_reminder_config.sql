-- Recordatorio automático "toca baño" (Fase 2 estética).
-- Al cerrar una sesión con próxima visita sugerida, groomingService crea una
-- fila en `reminders` (type='grooming') que cron-process-reminders PART 4
-- recoge y envía, resolviendo la plantilla desde grooming_reminder_template.

ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS grooming_reminder_template TEXT,
    ADD COLUMN IF NOT EXISTS grooming_reminder_lead_days INTEGER NOT NULL DEFAULT 3;

COMMENT ON COLUMN public.clinic_settings.grooming_reminder_template IS
    'Nombre de la plantilla WhatsApp aprobada para el recordatorio de próximo baño. NULL = no se crean recordatorios de estética.';
COMMENT ON COLUMN public.clinic_settings.grooming_reminder_lead_days IS
    'Cuántos días antes de la próxima visita sugerida se envía el recordatorio de baño.';
