-- El plan Pro pasa a "Automatización de recordatorios vía WhatsApp" (sin número).
-- Se levanta el tope de 250/mes a ilimitado para que la copia sin número no mienta.
-- cron-process-reminders ya trata monthly_reminders NULL como ilimitado (igual que Enterprise).
UPDATE public.plan_limits SET monthly_reminders = NULL, updated_at = NOW()
WHERE plan_id IN ('pro', 'radiance');
