-- Plan Pro: 10.000 -> 20.000 créditos IA/mes.
-- 20.000 créditos ≈ 2.300 mensajes del agente/mes — techo de seguridad contra
-- abuso, pero muy por encima de lo que consume cualquier clínica física real
-- (~1.050/mes típico), así que la copia "Conversaciones IA ilimitadas" sigue
-- siendo cierta en la práctica.
UPDATE public.plan_limits SET ai_credits = 20000, updated_at = NOW()
WHERE plan_id IN ('pro', 'radiance');

-- Clínicas Pro existentes: el webhook solo resincroniza ai_credits_monthly_limit
-- en el próximo pago/cambio de plan, así que se actualiza a mano.
UPDATE public.clinic_settings SET ai_credits_monthly_limit = 20000, updated_at = NOW()
WHERE subscription_plan IN ('pro', 'radiance')
  AND ai_credits_monthly_limit = 10000
  AND NOT ai_credits_unlimited;
