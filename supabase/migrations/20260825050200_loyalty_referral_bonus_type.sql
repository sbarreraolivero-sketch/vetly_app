-- El bono al referidor solo soportaba monto fijo. Se agrega el mismo tipo
-- fijo/porcentaje que ya tiene el bono de bienvenida, para que el preset
-- "Recomendado" pueda expresarse 100% en porcentaje (funciona en cualquier
-- país/moneda sin configurar nada por clínica).
ALTER TABLE public.clinic_settings
    ADD COLUMN IF NOT EXISTS loyalty_referral_bonus_type TEXT NOT NULL DEFAULT 'fixed';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.clinic_settings'::regclass
          AND conname = 'clinic_settings_loyalty_referral_bonus_type_check'
    ) THEN
        ALTER TABLE public.clinic_settings
            ADD CONSTRAINT clinic_settings_loyalty_referral_bonus_type_check
            CHECK (loyalty_referral_bonus_type IN ('fixed', 'percentage'));
    END IF;
END $$;

COMMENT ON COLUMN public.clinic_settings.loyalty_referral_bonus_type IS
    'fixed = loyalty_referral_bonus es un monto en la moneda de la clínica; percentage = es un % de la primera compra del referido. Default fixed preserva el efecto de toda fila existente (todas las clínicas hoy son fijas).';

-- Defensa en profundidad: además de que signup-handler seteará
-- loyalty_enabled=false explícitamente para clínicas nuevas, el propio
-- default de columna deja de ser "true" — así cualquier otro camino de
-- inserción que no lo especifique tampoco activa el programa sin querer.
ALTER TABLE public.clinic_settings
    ALTER COLUMN loyalty_enabled SET DEFAULT false;

-- Motor extendido: el bono al referidor ahora calcula igual que el de
-- bienvenida (CASE fijo/porcentaje), en vez de usar el monto crudo de
-- configuración directamente. Único cambio funcional respecto a la versión
-- vigente (verificada con pg_get_functiondef antes de escribir esto).
CREATE OR REPLACE FUNCTION public.sync_income_loyalty(p_income_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_income      RECORD;
    v_cfg         RECORD;
    v_tx          RECORD;
    v_base        NUMERIC;
    v_redeemed    INTEGER;
    v_amount      INTEGER;
    v_ref_amount  INTEGER;
    v_referrer    UUID;
    v_is_first    BOOLEAN;
    v_had_welcome BOOLEAN;
BEGIN
    SELECT * INTO v_income FROM incomes WHERE id = p_income_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- auth.role() distingue anon de service_role; auth.uid() es NULL para ambos.
    IF COALESCE(auth.role(), 'service_role') <> 'service_role' AND NOT EXISTS (
        SELECT 1 FROM clinic_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.clinic_id = v_income.clinic_id
          AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'No autorizado para operar sobre esta clínica';
    END IF;

    -- ── 1. REVERSIÓN ───────────────────────────────────────────────────────
    FOR v_tx IN SELECT * FROM loyalty_transactions WHERE income_id = p_income_id LOOP
        UPDATE tutors
        SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) - v_tx.points),
            referral_count = CASE WHEN v_tx.type = 'referral_reward'
                                  THEN GREATEST(0, COALESCE(referral_count, 0) - 1)
                                  ELSE referral_count END,
            last_loyalty_update = NOW()
        WHERE id = v_tx.tutor_id;
    END LOOP;

    DELETE FROM loyalty_transactions WHERE income_id = p_income_id;

    IF v_income.tutor_id IS NULL THEN RETURN; END IF;

    SELECT loyalty_enabled, loyalty_points_percentage, loyalty_referral_bonus,
           loyalty_referral_bonus_type, loyalty_welcome_bonus, loyalty_welcome_bonus_type
    INTO v_cfg
    FROM clinic_settings WHERE id = v_income.clinic_id;

    IF NOT COALESCE(v_cfg.loyalty_enabled, false) THEN RETURN; END IF;

    -- ── 2. Canje ───────────────────────────────────────────────────────────
    v_redeemed := ROUND(COALESCE(v_income.loyalty_redeemed, 0))::INTEGER;
    IF v_redeemed > 0 THEN
        INSERT INTO loyalty_transactions (clinic_id, tutor_id, income_id, type, points, description)
        VALUES (v_income.clinic_id, v_income.tutor_id, p_income_id, 'redeem', -v_redeemed,
                'Canje en venta del ' || to_char(v_income.date, 'DD/MM/YYYY'));

        UPDATE tutors
        SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) - v_redeemed),
            last_loyalty_update = NOW()
        WHERE id = v_income.tutor_id;
    END IF;

    -- ── 3. Base: lo efectivamente pagado en dinero ─────────────────────────
    v_base := GREATEST(0, COALESCE(v_income.amount, 0) - COALESCE(v_income.loyalty_redeemed, 0));
    IF v_base <= 0 THEN RETURN; END IF;

    -- ── 4. ¿Primera compra? ────────────────────────────────────────────────
    SELECT NOT EXISTS (
        SELECT 1 FROM incomes i
        WHERE i.clinic_id = v_income.clinic_id
          AND i.tutor_id  = v_income.tutor_id
          AND i.id       <> p_income_id
          AND (i.date < v_income.date
               OR (i.date = v_income.date AND i.created_at < v_income.created_at))
    ) INTO v_is_first;

    SELECT EXISTS (
        SELECT 1 FROM loyalty_transactions lt
        WHERE lt.tutor_id = v_income.tutor_id
          AND lt.type = 'welcome_bonus'
          AND lt.income_id IS DISTINCT FROM p_income_id
    ) INTO v_had_welcome;

    IF v_is_first AND NOT v_had_welcome THEN
        SELECT referred_by INTO v_referrer FROM tutors WHERE id = v_income.tutor_id;

        -- El referidor debe pertenecer a la MISMA clínica. `referred_by` lo
        -- escribe el frontend y el webhook; sin esta validación un UUID de otra
        -- clínica cobraría el bono. Una atribución inválida no paga nada.
        IF v_referrer IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM tutors r
            WHERE r.id = v_referrer AND r.clinic_id = v_income.clinic_id
        ) THEN
            v_referrer := NULL;
        END IF;

        IF v_referrer IS NULL THEN RETURN; END IF;

        v_amount := CASE
            WHEN v_cfg.loyalty_welcome_bonus_type = 'percentage'
                THEN ROUND(v_base * COALESCE(v_cfg.loyalty_welcome_bonus, 0) / 100.0)
            ELSE COALESCE(v_cfg.loyalty_welcome_bonus, 0)
        END;

        IF v_amount > 0 THEN
            INSERT INTO loyalty_transactions (clinic_id, tutor_id, income_id, type, points, description)
            VALUES (v_income.clinic_id, v_income.tutor_id, p_income_id, 'welcome_bonus', v_amount,
                    'Bono de bienvenida por referido — primera compra');

            UPDATE tutors
            SET loyalty_points = COALESCE(loyalty_points, 0) + v_amount,
                last_loyalty_update = NOW()
            WHERE id = v_income.tutor_id;
        END IF;

        -- ── NUEVO: bono al referidor simétrico al de bienvenida ─────────────
        v_ref_amount := CASE
            WHEN v_cfg.loyalty_referral_bonus_type = 'percentage'
                THEN ROUND(v_base * COALESCE(v_cfg.loyalty_referral_bonus, 0) / 100.0)
            ELSE COALESCE(v_cfg.loyalty_referral_bonus, 0)
        END;

        IF v_ref_amount > 0 AND v_referrer <> v_income.tutor_id THEN
            INSERT INTO loyalty_transactions (clinic_id, tutor_id, income_id, type, points, description)
            VALUES (v_income.clinic_id, v_referrer, p_income_id, 'referral_reward',
                    v_ref_amount,
                    'Bono por referido — tu recomendado hizo su primera compra');

            UPDATE tutors
            SET loyalty_points = COALESCE(loyalty_points, 0) + v_ref_amount,
                referral_count = COALESCE(referral_count, 0) + 1,
                last_loyalty_update = NOW()
            WHERE id = v_referrer;
        END IF;
    ELSE
        v_amount := ROUND(v_base * COALESCE(v_cfg.loyalty_points_percentage, 0) / 100.0);
        IF v_amount > 0 THEN
            INSERT INTO loyalty_transactions (clinic_id, tutor_id, income_id, type, points, description)
            VALUES (v_income.clinic_id, v_income.tutor_id, p_income_id, 'earn', v_amount,
                    'Acumulación por visita del ' || to_char(v_income.date, 'DD/MM/YYYY'));

            UPDATE tutors
            SET loyalty_points = COALESCE(loyalty_points, 0) + v_amount,
                last_loyalty_update = NOW()
            WHERE id = v_income.tutor_id;
        END IF;
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.sync_income_loyalty(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sync_income_loyalty(UUID) TO authenticated, service_role;
