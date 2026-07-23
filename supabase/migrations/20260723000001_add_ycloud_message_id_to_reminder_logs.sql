-- Correlación de eventos de estado de YCloud (whatsapp.message.updated) con el
-- recordatorio que los originó. El cron guarda aquí el ID que devuelve YCloud al
-- enviar; el webhook busca por esta columna para actualizar el estado real de
-- entrega (delivered/read/failed) en vez de dejar todo fijo en 'sent'.
ALTER TABLE public.reminder_logs
    ADD COLUMN IF NOT EXISTS ycloud_message_id TEXT DEFAULT NULL;

CREATE INDEX IF NOT EXISTS idx_reminder_logs_ycloud_message_id
    ON public.reminder_logs (ycloud_message_id);
