-- Starter: 5 usuarios / 3 agendas -> 3 usuarios / 2 agendas.
-- Objetivo: que el salto a Pro (10 usuarios) sea más atractivo por cantidad de
-- usuarios. invite_member_v2 lee max_users de plan_limits por plan_id, así que
-- toma el nuevo valor solo con este UPDATE. No hay clínicas Starter reales
-- (0 filas), así que no hay riesgo de romper a un cliente existente.
UPDATE public.plan_limits SET max_users = 3, max_agendas = 2, updated_at = NOW()
WHERE plan_id IN ('starter', 'essence');
