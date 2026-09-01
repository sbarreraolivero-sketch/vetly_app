-- Decisión de negocio (2026-09-01): subir el tope de usuarios del plan Core
-- de 3 a 10 para no dejar afuera a prospectos con más de 3 usuarios en su
-- equipo — cambio permanente, aplica de inmediato a las clínicas Core
-- existentes (invite_member_v2 lee plan_limits en vivo, no lo congela por
-- clínica al momento del alta) y a todas las nuevas.
--
-- Solo se toca max_users. ai_credits, max_agendas, monthly_reminders y
-- allows_2h_reminder de Core quedan intactos — Core sigue siendo el plan de
-- gestión sin agente de IA, solo se relaja el techo de usuarios.
UPDATE public.plan_limits
SET max_users = 10,
    updated_at = now()
WHERE plan_id = 'core';
