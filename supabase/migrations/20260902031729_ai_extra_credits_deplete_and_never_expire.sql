-- ════════════════════════════════════════════════════════════════════════════
-- Créditos IA — el pack extra se descuenta y se arrastra (no expira)
-- ════════════════════════════════════════════════════════════════════════════
--
-- Modelo acordado (sesión 2026-09-01):
--   · Plan mensual (ai_credits_monthly_limit): 30.000 fijos, use-it-or-lose-it.
--     El reset del día 1 (reset_monthly_ai_usage) pone los contadores en 0 y
--     NO toca el límite ni el pack.
--   · Pack comprado (ai_credits_extra_balance / _4o): NUNCA expira. Solo se
--     descuenta cuando el consumo del mes supera el plan. Lo que sobra queda y
--     se arrastra al mes siguiente automáticamente (el reset no lo toca).
--
-- Antes: nada descontaba de ai_credits_extra_balance, así que un pack quedaba
-- como techo permanente que reaparecía intacto cada mes. Bug reportado por
-- Animalgrace: "este mes me volvió a sumar los 20.000 del pack".
--
-- Estos dos RPC son el único punto donde el webbook contabiliza consumo
-- (los llama saveMsg en meta-whatsapp-webhook y ycloud-whatsapp-webhook).

CREATE OR REPLACE FUNCTION public.increment_clinic_4o_usage(p_clinic_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_target    UUID;
    v_cost      CONSTANT INTEGER := 15;  -- CREDIT_COST_4O — mantener sincronizado con _shared/aiCredits.ts
    v_mini      INTEGER;
    v_4o        INTEGER;
    v_limit     INTEGER;
    v_unlimited BOOLEAN;
    v_extra_bal INTEGER;
    v_extra_4o  INTEGER;
    v_prev_used INTEGER;
    v_new_used  INTEGER;
    v_overage   INTEGER;
    v_from_bal  INTEGER;
    v_from_4o   INTEGER;
BEGIN
    SELECT COALESCE(parent_clinic_id, id) INTO v_target
    FROM public.clinic_settings WHERE id = p_clinic_id;
    IF v_target IS NULL THEN RETURN; END IF;

    SELECT COALESCE(ai_credits_monthly_mini_used, 0),
           COALESCE(ai_credits_monthly_4o_used, 0),
           COALESCE(ai_credits_monthly_limit, 0),
           COALESCE(ai_credits_unlimited, false),
           COALESCE(ai_credits_extra_balance, 0),
           COALESCE(ai_credits_extra_4o, 0)
      INTO v_mini, v_4o, v_limit, v_unlimited, v_extra_bal, v_extra_4o
    FROM public.clinic_settings WHERE id = v_target
    FOR UPDATE;

    -- Consumo del ciclo, en créditos, antes y después de este mensaje.
    v_prev_used := v_mini + v_4o * v_cost;
    v_new_used  := v_prev_used + v_cost;

    -- Parte de ESTE mensaje que cae por encima del plan mensual.
    v_overage := GREATEST(0, v_new_used - GREATEST(v_prev_used, v_limit));

    -- El excedente sale del pack: primero del balance genérico, luego del 4o.
    v_from_bal := LEAST(v_overage, v_extra_bal);
    v_from_4o  := LEAST(v_overage - v_from_bal, v_extra_4o);

    UPDATE public.clinic_settings
    SET ai_credits_monthly_4o_used = v_4o + 1,
        ai_credits_extra_balance   = CASE WHEN v_unlimited THEN ai_credits_extra_balance
                                          ELSE v_extra_bal - v_from_bal END,
        ai_credits_extra_4o        = CASE WHEN v_unlimited THEN ai_credits_extra_4o
                                          ELSE v_extra_4o - v_from_4o END
    WHERE id = v_target;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_clinic_mini_usage(p_clinic_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
    v_target    UUID;
    v_cost      CONSTANT INTEGER := 1;  -- un mensaje mini cuesta 1 crédito
    v_4o_cost   CONSTANT INTEGER := 15;
    v_mini      INTEGER;
    v_4o        INTEGER;
    v_limit     INTEGER;
    v_unlimited BOOLEAN;
    v_extra_bal INTEGER;
    v_extra_4o  INTEGER;
    v_prev_used INTEGER;
    v_new_used  INTEGER;
    v_overage   INTEGER;
    v_from_bal  INTEGER;
    v_from_4o   INTEGER;
BEGIN
    SELECT COALESCE(parent_clinic_id, id) INTO v_target
    FROM public.clinic_settings WHERE id = p_clinic_id;
    IF v_target IS NULL THEN RETURN; END IF;

    SELECT COALESCE(ai_credits_monthly_mini_used, 0),
           COALESCE(ai_credits_monthly_4o_used, 0),
           COALESCE(ai_credits_monthly_limit, 0),
           COALESCE(ai_credits_unlimited, false),
           COALESCE(ai_credits_extra_balance, 0),
           COALESCE(ai_credits_extra_4o, 0)
      INTO v_mini, v_4o, v_limit, v_unlimited, v_extra_bal, v_extra_4o
    FROM public.clinic_settings WHERE id = v_target
    FOR UPDATE;

    v_prev_used := v_mini + v_4o * v_4o_cost;
    v_new_used  := v_prev_used + v_cost;
    v_overage   := GREATEST(0, v_new_used - GREATEST(v_prev_used, v_limit));

    v_from_bal := LEAST(v_overage, v_extra_bal);
    v_from_4o  := LEAST(v_overage - v_from_bal, v_extra_4o);

    UPDATE public.clinic_settings
    SET ai_credits_monthly_mini_used = v_mini + 1,
        ai_credits_extra_balance     = CASE WHEN v_unlimited THEN ai_credits_extra_balance
                                            ELSE v_extra_bal - v_from_bal END,
        ai_credits_extra_4o          = CASE WHEN v_unlimited THEN ai_credits_extra_4o
                                            ELSE v_extra_4o - v_from_4o END
    WHERE id = v_target;
END;
$function$;

-- ── Corrección retroactiva del pack de Animalgrace (pool = Linares) ──────────
-- Pack de 20.000 comprado el 25-ago (MercadoPago) que nunca se descontó.
-- Consumo real sobre el plan del 25-ago al 31-ago (ledger ai_credit_transactions)
-- = 12.421. Saldo real que arrastra a septiembre = 20.000 - 12.421 = 7.579.
UPDATE public.clinic_settings
SET ai_credits_extra_balance = 7579,
    ai_credits_extra_4o = 0,
    ai_credits_extra_expires_at = NULL,
    updated_at = NOW()
WHERE id = 'fd11b7e4-7d96-461c-a292-2caa5e2592ce'
  AND ai_credits_extra_balance = 20000;   -- idempotente: solo si sigue sin corregir

INSERT INTO public.ai_credit_transactions
    (clinic_id, type, amount, balance_after, description, metadata)
SELECT
    'fd11b7e4-7d96-461c-a292-2caa5e2592ce',
    'adjustment',
    -12421,
    37579,
    'Ajuste: el pack de 20.000 (25-ago) nunca se descontó. Consumo real sobre el plan 25-ago->31-ago = 12.421. Pack que arrastra a septiembre = 7.579. Plan mensual sigue en 30.000.',
    jsonb_build_object('reason', 'pack_never_decremented_backfill', 'pack_original', 20000,
                       'consumed_over_plan', 12421, 'corrected_balance', 7579)
WHERE NOT EXISTS (
    SELECT 1 FROM public.ai_credit_transactions
    WHERE clinic_id = 'fd11b7e4-7d96-461c-a292-2caa5e2592ce'
      AND type = 'adjustment'
      AND metadata->>'reason' = 'pack_never_decremented_backfill'
);
