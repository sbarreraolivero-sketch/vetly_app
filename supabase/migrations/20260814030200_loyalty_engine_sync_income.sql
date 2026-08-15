-- ============================================================================
-- Motor de fidelización — parte 2: cálculo sobre la venta
--
-- Reglas:
--   1ª compra CON referidor  → comprador: % de bienvenida | referidor: bono fijo
--   1ª compra SIN referidor  → nada (la bienvenida es exclusiva de referidos)
--   2ª compra en adelante    → comprador: % de acumulación
--   Canje                    → descuenta del saldo
--
-- Idempotente por reversión + recálculo (mismo patrón que
-- inventoryService.syncIncomeProductMovements): editar o borrar una venta
-- corrige el saldo solo, sin lógica de compensación.
-- ============================================================================

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
    v_referrer    UUID;
    v_is_first    BOOLEAN;
    v_had_welcome BOOLEAN;
BEGIN
    SELECT * INTO v_income FROM incomes WHERE id = p_income_id;
    IF NOT FOUND THEN RETURN; END IF;

    -- Acceso: miembro activo de la clínica. auth.uid() NULL = service_role o
    -- llamada interna desde un trigger de mantenimiento.
    IF auth.uid() IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM clinic_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.clinic_id = v_income.clinic_id
          AND cm.status = 'active'
    ) THEN
        RAISE EXCEPTION 'No autorizado para operar sobre esta clínica';
    END IF;

    -- ── 1. REVERSIÓN: deshacer todo lo que esta venta generó antes ──────────
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

    -- ── 2. Sin tutor vinculado no hay a quién acreditar ─────────────────────
    IF v_income.tutor_id IS NULL THEN RETURN; END IF;

    SELECT loyalty_enabled, loyalty_points_percentage, loyalty_referral_bonus,
           loyalty_welcome_bonus, loyalty_welcome_bonus_type
    INTO v_cfg
    FROM clinic_settings WHERE id = v_income.clinic_id;

    IF NOT COALESCE(v_cfg.loyalty_enabled, false) THEN RETURN; END IF;

    -- ── 3. Canje ───────────────────────────────────────────────────────────
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

    -- ── 4. Base de acumulación: lo efectivamente pagado en dinero ──────────
    -- `amount` ya viene neto de descuento. Se resta el canje para que los
    -- puntos no se reciclen a sí mismos.
    v_base := GREATEST(0, COALESCE(v_income.amount, 0) - COALESCE(v_income.loyalty_redeemed, 0));
    IF v_base <= 0 THEN RETURN; END IF;

    -- ── 5. ¿Primera compra? ────────────────────────────────────────────────
    -- Doble guarda: por fecha, y por la existencia de un bono de bienvenida ya
    -- otorgado en otra venta. Sin la segunda, registrar una venta con fecha
    -- retroactiva volvería a pagar bienvenida y premio al referidor.
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
        -- El bono de bienvenida es EXCLUSIVO de clientes que llegaron referidos.
        SELECT referred_by INTO v_referrer FROM tutors WHERE id = v_income.tutor_id;
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

        -- Premio al referidor: se paga recién cuando el referido compra de verdad.
        IF COALESCE(v_cfg.loyalty_referral_bonus, 0) > 0 AND v_referrer <> v_income.tutor_id THEN
            INSERT INTO loyalty_transactions (clinic_id, tutor_id, income_id, type, points, description)
            VALUES (v_income.clinic_id, v_referrer, p_income_id, 'referral_reward',
                    v_cfg.loyalty_referral_bonus,
                    'Bono por referido — tu recomendado hizo su primera compra');

            UPDATE tutors
            SET loyalty_points = COALESCE(loyalty_points, 0) + v_cfg.loyalty_referral_bonus,
                referral_count = COALESCE(referral_count, 0) + 1,
                last_loyalty_update = NOW()
            WHERE id = v_referrer;
        END IF;
    ELSE
        -- ── Recompra ───────────────────────────────────────────────────────
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

-- ── Reversión al borrar la venta ───────────────────────────────────────────
-- BEFORE DELETE: las filas de loyalty_transactions aún existen y el saldo puede
-- revertirse antes de que el FK las deje huérfanas.
CREATE OR REPLACE FUNCTION public.revert_income_loyalty_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tx RECORD;
BEGIN
    FOR v_tx IN SELECT * FROM loyalty_transactions WHERE income_id = OLD.id LOOP
        UPDATE tutors
        SET loyalty_points = GREATEST(0, COALESCE(loyalty_points, 0) - v_tx.points),
            referral_count = CASE WHEN v_tx.type = 'referral_reward'
                                  THEN GREATEST(0, COALESCE(referral_count, 0) - 1)
                                  ELSE referral_count END,
            last_loyalty_update = NOW()
        WHERE id = v_tx.tutor_id;
    END LOOP;

    DELETE FROM loyalty_transactions WHERE income_id = OLD.id;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS tr_revert_loyalty_on_income_delete ON public.incomes;
CREATE TRIGGER tr_revert_loyalty_on_income_delete
    BEFORE DELETE ON public.incomes
    FOR EACH ROW EXECUTE FUNCTION public.revert_income_loyalty_on_delete();
